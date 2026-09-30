import { beforeEach, describe, expect, it } from "vitest";
import { Registry } from "./identity";

// The feed from page 4: every item is rebuilt from a string on each render,
// and only every other item carries a data-key.
interface Item {
  id: number;
  text: string;
}
const li = (it: Item, age: number) =>
  `<li${it.id % 2 ? ` data-key="activity-${it.id}"` : ""}>` +
  `<span class="avatar" style="background:#${it.id}${it.id}${it.id}">${it.text.slice(0, 2)}</span>` +
  `<span class="text"><b>${it.text}</b> did thing ${it.id}</span>` +
  `<span class="time">${age}s ago</span></li>`;

let feed: HTMLElement;
let reg: Registry;
let observer: MutationObserver;

/** Applies a DOM change and lets the registry see the mutation records. */
function mutate(change: () => void) {
  change();
  return reg.reconcile(observer.takeRecords());
}

const render = (items: Item[], age: number) => mutate(() => (feed.innerHTML = items.map((it) => li(it, age)).join("")));
const item = (n: number) => feed.children[n];
const textOf = (el: Element | null) => el?.querySelector("b")?.textContent;

beforeEach(() => {
  document.body.innerHTML = `<ul id="feed"></ul>`;
  feed = document.getElementById("feed")!;
  reg = new Registry();
  observer = new MutationObserver(() => {});
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
});

const items: Item[] = [
  { id: 4, text: "Dora" },
  { id: 3, text: "Cleo" },
  { id: 2, text: "Basil" },
  { id: 1, text: "Ada" },
];

describe("identity across a rebuild", () => {
  it("keeps keyed and unkeyed items when a sibling is inserted before them", () => {
    render(items, 2);
    const keyed = reg.idFor(item(1)); // Cleo, data-key
    const unkeyed = reg.idFor(item(2)); // Basil, no key
    const oldNode = item(2);

    const { dead } = render([{ id: 5, text: "Edith" }, ...items], 4);

    expect(dead).toEqual([]);
    expect(reg.get(unkeyed)).not.toBe(oldNode);
    expect(textOf(reg.get(keyed))).toBe("Cleo");
    expect(textOf(reg.get(unkeyed))).toBe("Basil");
  });

  it("follows an element nested inside a rebuilt item, even when its own text changed", () => {
    render(items, 2);
    const time = reg.idFor(item(2).querySelector(".time")!);
    render([{ id: 5, text: "Edith" }, ...items], 4);
    const now = reg.get(time)!;
    expect(now.textContent).toBe("4s ago");
    expect(textOf(now.parentElement)).toBe("Basil");
  });

  it("retires an item that is no longer rendered", () => {
    render(items, 2);
    const last = reg.idFor(item(3));
    const kept = reg.idFor(item(0));
    const { dead } = render(items.slice(0, 3), 4);
    expect(dead).toEqual([last]);
    expect(reg.get(last)).toBeNull();
    expect(textOf(reg.get(kept))).toBe("Dora");
  });

  it("never hands an identity to a different item that took its place", () => {
    render(items, 2);
    const basil = reg.idFor(item(2));
    // Basil is replaced, in the same position, by an unrelated unkeyed item.
    const next = [items[0], items[1], { id: 8, text: "Hugo" }, items[3]];
    const { dead } = render(next, 4);
    expect(dead).toEqual([basil]);
  });

  it("keeps the id on a node that was only moved", () => {
    render(items, 2);
    const node = item(3);
    const id = reg.idFor(node);
    const { dead } = mutate(() => feed.prepend(node));
    expect(dead).toEqual([]);
    expect(reg.get(id)).toBe(node);
  });
});

describe("reordered rebuilds", () => {
  it("keeps an element with a unique id when its siblings are rebuilt in another order", () => {
    mutate(() => (feed.innerHTML = `<li id="a">Alpha</li><li id="b">Beta</li>`));
    const a = reg.idFor(feed.querySelector("#a")!);
    const b = reg.idFor(feed.querySelector("#b")!);
    const { dead } = mutate(() => (feed.innerHTML = `<li id="b">Beta</li><li id="a">Alpha</li>`));
    expect(dead).toEqual([]);
    expect(reg.get(a)?.textContent).toBe("Alpha");
    expect(reg.get(b)?.textContent).toBe("Beta");
  });

  it("keeps keyed elements when they are rebuilt in reverse order", () => {
    mutate(() => (feed.innerHTML = `<li data-key="x">X</li><li data-key="y">Y</li><li data-key="z">Z</li>`));
    const ids = ["x", "y", "z"].map((k) => reg.idFor(feed.querySelector(`[data-key="${k}"]`)!));
    const { dead } = mutate(() => (feed.innerHTML = `<li data-key="z">Z</li><li data-key="y">Y</li><li data-key="x">X</li>`));
    expect(dead).toEqual([]);
    expect(ids.map((id) => reg.get(id)?.textContent)).toEqual(["X", "Y", "Z"]);
  });
});

describe("look-alikes", () => {
  const twins = (n: number) => mutate(() => (feed.innerHTML = "<li>same</li>".repeat(n)));

  it("pairs identical siblings in order when their number is unchanged", () => {
    twins(3);
    const ids = [0, 1, 2].map((n) => reg.idFor(item(n)));
    const { dead } = twins(3);
    expect(dead).toEqual([]);
    expect(ids.map((id) => reg.get(id))).toEqual([item(0), item(1), item(2)]);
  });

  it("lets go rather than guess when their number changed", () => {
    twins(3);
    const id = reg.idFor(item(1));
    const { dead } = twins(4);
    expect(dead).toEqual([id]);
  });
});
