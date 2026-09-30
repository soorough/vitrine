// A small glyph per kind of element, so the layers tree can be scanned by
// shape. The kinds are the ones a designer tells apart, not every HTML tag.

type Kind = "frame" | "text" | "link" | "button" | "input" | "image" | "vector" | "list" | "table" | "form" | "code";

const KINDS: Record<string, Kind> = {};
const put = (kind: Kind, tags: string) => tags.split(" ").forEach((t) => (KINDS[t] = kind));
put("text", "h1 h2 h3 h4 h5 h6 p span label b strong em i small code blockquote pre q abbr time mark sub sup");
put("link", "a");
put("button", "button");
put("input", "input textarea select option");
put("image", "img picture video canvas iframe");
put("vector", "svg path circle rect line polyline polygon ellipse g use");
put("list", "ul ol li dl dt dd");
put("table", "table thead tbody tfoot tr td th caption");
put("form", "form fieldset");
put("code", "script style noscript template link meta");

const PATHS: Record<Kind, string> = {
  frame: "M5.5 2.5v11M10.5 2.5v11M2.5 5.5h11M2.5 10.5h11",
  text: "M3.5 3.5h9M8 3.5v9.5",
  link: "M6.8 9.2l2.4-2.4M7.2 4.8l.9-.9a2.5 2.5 0 013.5 3.5l-.9.9M8.8 11.2l-.9.9a2.5 2.5 0 01-3.5-3.5l.9-.9",
  button: "M4 5h8a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2zM6 8h4",
  input: "M3 4.5h10a.5.5 0 01.5.5v6a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V5a.5.5 0 01.5-.5zM5.5 6.5v3",
  image: "M3 3h10a.5.5 0 01.5.5v9a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5v-9A.5.5 0 013 3zM2.5 11l3.2-3 2.8 2.4 1.7-1.4 3.3 2.5M10.2 6.2h.1",
  vector: "M8 2.5l4.5 5.5L8 13.5 3.5 8zM8 2.5V8",
  list: "M6 4.5h7.5M6 8h7.5M6 11.5h7.5M3 4.5h.5M3 8h.5M3 11.5h.5",
  table: "M3 3h10a.5.5 0 01.5.5v9a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5v-9A.5.5 0 013 3zM2.5 6.5h11M7 6.5V13",
  form: "M4 2.5h8a.5.5 0 01.5.5v10a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5zM5.5 5.5h5M5.5 8h5M5.5 10.5h3",
  code: "M6 4.5L2.5 8 6 11.5M10 4.5l3.5 3.5-3.5 3.5",
};

export function ElementIcon({ tag }: { tag: string }) {
  return (
    <svg className="element-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[KINDS[tag] ?? "frame"]} />
    </svg>
  );
}
