# Vitrine

A viewer for live previews of web pages, named after the glass case you look into but cannot reach inside: a pannable, zoomable board of cross-origin iframes, with hover and selection outlines drawn by the host, a layers panel and an inspector.

The brief is in [ASSIGNMENT.md](ASSIGNMENT.md).

## Run it

```
npm start
```

Node 22.12 or later (tested on Node 24; `.nvmrc` says 24). The mock backend alone runs on Node 18, but the build tools need 22.12. This installs dependencies, builds the page agent, starts the mock backend (`:4000` API, `:4001` pages) and serves the app at **http://localhost:4002**.

```
npm test          # unit tests for element identity
npm run typecheck
```

The **Failures** button in the toolbar (dev builds only) triggers each failure in R6 on demand and lists every call to `report()`.

## The three decisions everything else follows from

**1. In Select mode, the host takes the pointer, not the page.**
A transparent hit layer sits over each iframe. Clicks land on the host and the page is only *asked* what lies under a point (`document.elementFromPoint`). So "clicks never reach the page" is true by construction rather than by cancelling events one type at a time, and disabled controls, SVG and elements under a sticky header need no special cases, because hit-testing does not depend on which elements receive events. The cost is that the wheel lands on the host too, so scrolling is replayed inside the page (see "Where this breaks").

**2. An element's identity is its DOM node, and a re-match when the node is replaced.**
The agent gives a numeric id to each element it reports. The id stays with the node for as long as the node is in the document. When a page rebuilds its nodes, ids of removed nodes are re-bound to their replacements using, in order: the same `data-key`; the same `id`; content similarity, aligned in order against the siblings around it. If two candidates cannot be told apart, the id is retired. A selection can be lost; it is not allowed to move.

**3. Every failure goes through one object.**
A `Scope` is one attempt at one region. Anything that goes wrong for that attempt (a render, a click handler, a timer, a message, a response) is passed to `scope.fail`, the only caller of `report()`. It fails at most once, ignores everything after it is closed, and treats cancellation as not-a-failure. A retry is a new scope.

## Beyond the brief

Small things a design tool is expected to do, all built on data the host already has:

- **The inspector says what an element's identity rests on**: "Tracked by data-key", "by id", or "by content". The last one warns that if the page rebuilds, this selection is matched by content and may be dropped. The identity rules below are otherwise invisible to the user.
- **Hold Alt** with something selected to see the distances, in page pixels, to the element under the pointer (as in Figma).
- A single selection shows its **width × height** under it.
- **Shift+1** fits the board, **Shift+2** zooms to the preview being worked on, **double-click** a preview's name to zoom to it. Camera moves are animated and any pan or zoom interrupts them.
- The inspector **slides in** when there is something to inspect and can be closed; the next selection opens it again. It shows the selected element's parents, and each one selects it on click. **Click any value** to copy it.
- The mode switch sits at the bottom of the board, centred on the part of it the inspector does not cover.

## Layout of the code

```
frontend/src/
  shared/protocol.ts    every message between host and page, typed once for both sides
  agent/                the one <script> each page loads (bundled to backend/pages/figr-agent.js)
    index.ts              messages, frame loop, mutation handling, input forwarding
    identity.ts           ids, and re-matching them after a rebuild
    describe.ts           names, live values, geometry, in-page scrolling
  state/                stores: plain data, no logic
  core/                 everything that changes state
    regions.ts            Scope: containment and reporting
    connection.ts         one channel per preview
    commands.ts           mode, selection, hover, keyboard
    layers.ts             tree loading, updates, search
    api.ts, chaos.ts      HTTP client; failure injection for the dev menu
  ui/                   React components
```

The one script tag is `<script src="figr-agent.js"></script>`, first in each page's `<head>`, so it runs before the page's own scripts. Nothing else in the pages is changed.

## How state is organised

| Store | Holds | Written by |
|---|---|---|
| `camera` | pan offset and zoom | board gestures, toolbar zoom buttons |
| `session` | mode, active preview, selection, hover, the "no longer exists" flag | `core/commands.ts` only |
| `board` | the screens, each preview's connection status and page errors | the board loader; each preview's connection |
| `page` | geometry and live values of watched elements, per preview | the preview's connection, on a message |
| `layers` | each preview's tree rows, expanded rows, search | `core/layers.ts` only |

Two rules sit on top of that.

**Page facts and user intent never mix.** What the page looks like (tree rows, rectangles, computed styles) is written only when its agent says so; the host never edits it. What the user is doing (selection, hover, expanded rows, camera) is written only by a command run from user input.

**A page can take away, never add.** The only ways a page changes intent state are removal: an element that stops existing is dropped from the selection (`gone`), and a document that navigates has its selection, tree and remembered panel state cleared.

Two things are deliberately not in a store. The camera is applied to the DOM directly (one `transform`, one CSS variable), so panning and zooming re-render none of the 24 previews. Details for the inspector live in the component that shows them, keyed on the element, so they cannot outlive the selection they belong to.

Layers state is kept per preview, which is what makes "switch to B and back to A" restore A's expanded rows; the panel's scroll offset is remembered the same way.

## How the host and the pages talk

Everything is `postMessage`, typed in [`shared/protocol.ts`](frontend/src/shared/protocol.ts). Every message carries `doc`, an id the agent makes up once per document load.

**Page → host**

| Message | Meaning |
|---|---|
| `hello` | a document is ready; repeated every 500ms until the host answers |
| `bye` | this document is unloading |
| `geometry` | rectangles (and visible part) of the watched elements, when they change; also names the element now under the pointer when that changed, so an outline and its rectangle arrive together |
| `live` | inspector values of the selected elements, when they change |
| `tree` | new child lists for rows the host has loaded, after a DOM change |
| `gone` | these elements no longer exist |
| `dirty` | the DOM changed while a search is showing |
| `pageerror` | the page's own uncaught error or rejection |
| `fault` | the agent itself threw |
| `key`, `zoom` | a key press or Ctrl/Cmd+wheel that happened inside the frame |
| `res` | the answer to a request |

**Host → page**

| Message | Meaning |
|---|---|
| `init`, `mode` | handshake; Select or Interact |
| `pointer` | where the pointer is over this preview, or that it left |
| `scroll` | a wheel delta to apply under a point |
| `track` | which elements to stream geometry and live values for |
| `req` | `pick`, `children`, `step`, `search`, `reveal` |

Geometry is measured in the agent once per frame while something is watched and sent only when it differs from the last send. Scroll (of the page or of any scroller in it), resize, layout shifts and animation all show up as a changed rectangle, so none of them needs its own listener. The host draws the outlines in screen pixels in a layer above the scaled board, which is why a line stays 1px or 2px and a label stays the same size at any zoom.

**How much traffic that is.** Messages are sent when something changed, at most once per frame, so traffic follows what the user is doing and not how many previews there are. Measured in Chrome: idle, about zero; one element selected on the page that rebuilds every 2 seconds, 2 messages a second; scrolling a page with a selection, about 6 KB a second. Wheel events are added up and sent once per frame, and element details from the API are cached for five minutes (failures are not cached, and the cache steps aside while the dev menu is injecting failures).

**When one side is slow.** Every request has a timeout: 3 seconds for a row's children and for search, 10 for the rest. A timeout fails the region that asked (that row, the layers panel, that preview) and nothing else. The first `hello` has 10 seconds. The host also fetches the page URL itself, so a missing page fails at once instead of after 10 seconds.

**When one side is gone.** The host routes a message by the window it came from (`event.source`) and checks its origin. A preview that fails stops handling messages until Retry, which replaces the iframe and the connection together.

**When one side is replaced.** A navigation is a new document with a new `doc`. On `bye`, or on a `hello` with a `doc` the host has not seen, the connection rejects its in-flight requests as cancelled, clears that preview's selection, tree and remembered panel state, and sends `init` to the new document. A message stamped with an old `doc` is dropped on arrival, in both directions. Nothing on the board reloads.

**Trust.** The agent only accepts messages from `window.parent`, and after `init` only from that origin. The host only accepts messages from a preview's own `contentWindow` at the origin of its screen URL.

## Identity across re-renders, in detail

`agent/identity.ts`, tested in `identity.test.ts`.

On every mutation batch the agent looks for registered nodes that are no longer connected. For each, it reconstructs the child list its parent had *before* the batch (by undoing the mutation records) and aligns it with the child list the parent has now. The alignment is order-preserving and maximises total evidence:

| Evidence | Weight |
|---|---|
| the same node object (it was only moved) | certain |
| same tag and same `data-key` | strong |
| same tag and same `id` | strong |
| at least half of its words and attribute values in common | 0.5 to 1 |
| the only element of its tag and class in a parent that was itself rebuilt | 0.5 |

Only nodes created in that batch can take over an identity. Nested elements are followed by resolving the parent first and then aligning inside it, so a `span.time` whose text changed from "12s ago" to "14s ago" is still found inside its rebuilt `li`.

After aligning, each match is checked for rivals: other new nodes that match just as well. If there are any, the match stands only when there are exactly as many look-alikes before as after, which leaves pairing them in order as the one consistent reading. Otherwise the id is retired and the host is told the element is gone.

On page 4 this means a keyed item is matched by key, and an unkeyed item is matched by its content and by its position between its keyed neighbours.

## Ambiguities, and what I decided

- **"Every failure reaches `report()`" and page errors.** A page's own uncaught error is shown as the "Page error" badge and is *not* reported. It is a bug in the page, not a failure of a region of the viewer, and it has no Retry.
- **"The wheel over a preview scrolls that page" during a swipe that started on the board.** Taken literally, a two-finger pan stops dead the moment a preview slides under the pointer. A swipe instead stays with whatever it started on until the fingers pause for 160ms, as browsers do for nested scroll areas. Trackpad momentum keeps the swipe going. A new swipe that starts over a preview scrolls that page, as the brief asks, but only once the board has been still for half a second: someone swiping repeatedly across the board is still travelling, and a preview that passes under the pointer between swipes should not catch them. The cost, and a deliberate deviation from the brief's wording: in Select mode, a new swipe over a page within half a second of panning pans instead of scrolling that page. In Interact mode the pages take their own wheel and clicks as soon as the swipe ends, so no click is lost.
- **Shortcuts "right after the user clicked inside a preview", in Interact mode.** Keys pressed inside a page are forwarded to the host unless the user is typing in an input, textarea, select or contenteditable. Typing "v" into a form field does not switch modes.
- **"Rows the user is looking at don't jump. The scroll position holds steady."** These conflict when rows are added above the view. I keep the row at the top of the view where it is and move the scroll offset by the height added or removed above it. At the very top of the panel nothing is adjusted, as with browser scroll anchoring.
- **Selecting while searching.** "Selecting expands every ancestor" conflicts with "clearing the search restores exactly the expanded state from before". While a search is showing, the expanded state is frozen. If the selected row ends up inside a collapsed row afterwards, that row carries a magenta dot.
- **Label with no room above or below.** Above if it fits inside the preview, otherwise below, otherwise inside the element's top edge. If it would run past the right edge it slides left.
- **Nested scroll areas.** "Clipped to the preview's edges" is read as "clipped to what is visible": an element scrolled out of a scroll area inside the page has no outline either, even if it is still within the preview.
- **What counts as an element.** Anything under `<body>`, including `<script>` tags there. They appear in the layers panel and can be selected from it, but have no box and therefore no outline.
- **"Doesn't answer within 3 seconds" when the row was collapsed meanwhile.** Collapsing does not cancel the load. If it fails, it is reported, and the row shows "Couldn't load" when it is next expanded.
- **"Until the next selection."** "This element no longer exists" stays until something is selected again; Escape does not dismiss it.
- **The inspector with nothing selected.** The brief does not say. It is hidden until there is a selection, the "no longer exists" notice, or its own error, and the user can close it; the next change of selection opens it again.
- **Active preview.** A click on a page's background in Select mode makes that preview active and clears the selection.
- **Where the agent file lives.** I added `figr-agent.js` next to the pages. The pages themselves gain one script tag and are otherwise untouched.

## Where this breaks

- **Scrolling in Select mode is replayed, not native.** The wheel delta is applied with `scrollBy` inside the page. Trackpad scrolling is fine; a mouse wheel loses the browser's smooth-scroll animation, and scroll-snap or wheel listeners in the page do not see the gesture.
- **Outlines trail the content by about a frame while it scrolls or animates**, because the rectangle is measured in the page and drawn in the host one message later.
- **Identity is a judgment, not a proof, for elements with no `data-key` and no `id`:**
  - an unkeyed element whose content changes by more than half during a rebuild is treated as gone;
  - an unkeyed element replaced, in the same position, by a different one that shares at least half its content is treated as the same element. This is the one case where a selection can move to a different element;
  - identical siblings whose number changes in a rebuild are all dropped;
  - a page that removes a node and adds its replacement in a *later* task loses the selection, since the two are never seen together;
  - sibling lists over about 400 × 400 fall back to key and id matching only.

  Elements with a `data-key` or a unique `id` are re-found wherever the rebuild puts them, in any order.
- **Elements with `pointer-events: none` cannot be hovered or clicked** in a preview (they can from the layers panel). Shadow DOM and nested iframes are not entered.
- **The visible part of an element ignores two cases:** absolutely positioned elements that escape an `overflow` ancestor, and clipping by `clip-path`.
- **A page that stops responding after it connected** is only noticed when something is asked of it.
- **The page probe needs the pages to allow cross-origin `fetch`.** The kit's server does. Against a server that does not, every preview would fail immediately; the probe would have to go.
- **Off-screen previews update slowly.** Browsers pause `requestAnimationFrame` in frames out of view, so live values there refresh four times a second.
- **Search returns at most 3,000 rows** and says so.
- **Not tested:** Safari and Firefox, touch input, and pinch-zoom inside a page in Safari (which sends gesture events, not Ctrl+wheel).

## With another week

- Native scrolling in Select mode, by letting the wheel through to the page while still taking clicks on the host.
- A grace period before an element is declared gone, to follow rebuilds that span two tasks.
- A heartbeat, so a preview that hangs is noticed without being asked something.
- Browser tests (Playwright) for the full R1–R6 list, driving real iframes. Today the unit tests cover identity, selection ordering and failure scopes, and the failure matrix was run by hand in Chrome.
- **Only keep previews near the viewport live.** The messages already scale with what the user does, not with the number of previews; the previews themselves do not. Each is a full live page with its own memory, CPU and timers (the Activity feed rebuilds every 2 seconds even off screen). At a few hundred screens, previews far from the viewport would be replaced by a still image and brought back to life as they approach, with a small budget of live pages. The cost is that a preview brought back is a fresh page load: its scroll position and anything done in Interact mode are gone, which is why it is not done for the 24 here, where the brief asks for every screen to be a live preview.

## Tests

`npm test` runs two files:

- `frontend/src/agent/identity.test.ts`: the page-4 feed rebuilt from strings, with insertion before the selection, a nested element whose text changes, an item that drops off, a different item taking a position, a moved node, identical siblings with and without a change in number, and keyed and id'd elements rebuilt in reverse order.
- `frontend/src/core/selection.test.ts`: a page answering clicks late and out of order. Escape while a click is waiting; two overlapping Shift+clicks; a newer click cancelling an older one so it cannot time out and fail the preview; a click on the page background; any camera move clearing the hover. Plus the failure scope itself: reported once, cancellation not a failure, nothing after close.
