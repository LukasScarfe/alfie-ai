// A placeholder screen type that proves the pipeline: centred, word-wrapped
// text, its cap height 0.3 face units (the ring has radius 1) times Text size;
// it shrinks to fit the box.
const PITCH = 1.6;   // line to line, in cap heights

export default {
  type: "label",
  draw({ w, h, options, memo, S }) {
    const words = S.title(options.text ?? "") || "Alfie";
    // One element, the text: the whole screen, or a box of its own.
    const L = S.layout(w, h, options.layout);
    if (memo) memo.boxes = L.boxes;
    if (!L.show("text")) return [];
    const B = L.box("text", S.rect(-w, -h, w, h)), bw = B.w / 2, bh = B.h / 2;
    let ht = Math.max(0.02, 0.3 * (Number(options.text_size) || 1) * L.size("text"));
    const fits = (hh) => {
      const lines = S.wrap(words, (2 * bw * 0.92) / hh);
      const single = lines.some((l) => !l.includes(" ") && S.width(l, hh) > 2 * bw * 0.92);
      return { lines, ok: !single && lines.length * PITCH * hh - (PITCH - 1) * hh <= 2 * bh * 0.92 };
    };
    let f = fits(ht);
    for (let i = 0; i < 40 && !f.ok && ht > 0.02; i++) { ht *= 0.88; f = fits(ht); }
    return S.lines(f.lines, ht, S.inset(B, bw * 0.04, 0), { pitch: PITCH, align: L.align("text") });
  },
};
