// The chat's pure parts: markdown, ids, the stored history, replies, and the card's config.
import * as C from "../../custom_components/alfie/frontend/alfie-chat.js";
import * as K from "../../custom_components/alfie/frontend/alfie-chat-card.js";

let failures = 0;
function check(ok, what) { if (!ok) { failures++; console.error(`FAIL ${what}`); } }
const md = C.markdown;

check(md("hi") === "<p>hi</p>", "plain paragraph");
check(md("a\nb") === "<p>a<br>b</p>", "line break inside a paragraph");
check(md("a\n\nb") === "<p>a</p><p>b</p>", "blank line splits paragraphs");
check(md("**bold** and *it* and `x*y*`") === "<p><b>bold</b> and <i>it</i> and <code>x*y*</code></p>", "inline styles, code untouched");
check(md("<script>alert(1)</script>").includes("&lt;script&gt;") && !md("<script>").includes("<script>"), "html is escaped");
check(md("- one\n- two") === "<ul><li>one</li><li>two</li></ul>", "bullets");
check(md("1. one\n2. two") === "<ol><li>one</li><li>two</li></ol>", "numbered");
check(md("Lights:\n- a\n- b\nDone") === "<p>Lights:</p><ul><li>a</li><li>b</li></ul><p>Done</p>", "list between paragraphs");
check(md("```\nif a < b:\n  go()\n```") === "<pre><code>if a &lt; b:\n  go()</code></pre>", "code block, escaped, kept");
check(md("## Weather") === '<p class="h">Weather</p>', "heading as a bold line");
check(md("[HA](https://home-assistant.io)").includes('<a href="https://home-assistant.io" target="_blank" rel="noopener noreferrer">HA</a>'), "link");
check(!md("[x](javascript:alert(1))").includes("<a"), "no javascript links");
check(md("see https://x.org/a.").includes('href="https://x.org/a"'), "bare link without the full stop");
check(md("snake_case_name stays") === "<p>snake_case_name stays</p>", "underscores inside words are not italics");
check(md("2 * 3 * 4") === "<p>2 * 3 * 4</p>", "spaced asterisks are not italics");
check(C.body("a\n<b>", false) === "<p>a<br>&lt;b&gt;</p>", "plain body");

const id = C.newId("abcdef0123456789", () => 0.5);
check(/^chat-abcdef01-[a-z0-9]{10}$/.test(id), `id shape ${id}`);
check(id.length !== 26, "not ULID-sized, so HA keeps it");
check(C.newId("") .startsWith("chat-anon-"), "no user");

const many = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? "alfie" : "user", text: `m${i}`, t: i }));
const t = C.trimmed({ id: "chat-x", messages: [...many, { role: "system", text: "no" }, null] }, 50);
check(t.messages.length === 50 && t.messages[49].text === "m79", "keeps the last 50, drops junk");
check(C.trimmed({ id: "c", messages: [{ role: "alfie", text: "x".repeat(9000) }] }).messages[0].text.length === C.MAX_TEXT, "long text capped");
check(C.trimmed(null).id === "" && C.trimmed(null).messages.length === 0, "nothing stored");

let r = C.replyOf({ response: { response_type: "action_done", speech: { plain: { speech: "Done." } } }, conversation_id: "chat-a" });
check(r.text === "Done." && !r.error && r.id === "chat-a", "reply");
r = C.replyOf({ response: { response_type: "error", speech: {} } });
check(r.error && r.text, "error reply has words");

let c = K.applyChange({ type: "custom:alfie-chat-card" }, "title", "");
check(c.title === "", "an empty title is written (no title)");
c = K.applyChange(c, "title", "Alfie");
check(!("title" in c), "default title removed");
c = K.applyChange(c, "starters", [...C.OPTIONS.starters]);
check(!("starters" in c), "default starters not written");
c = K.applyChange(c, "starters", ["Hi"]);
check(c.starters[0] === "Hi", "own starters written");
c = K.applyChange(c, "face_style", null);
check(!("face_style" in c), "no face style");
const s = K.settled({ height: 50, face_size: "x", face_position: "under", starters: "a\n\n b " });
check(s.height === 200 && s.face_size === 96 && s.face_position === "top", "settled numbers and position");
check(s.starters.length === 2 && s.starters[1] === "b", "starters as lines");

if (failures) { console.error(`${failures} chat checks failed`); process.exit(1); }
console.log("chat ok");
