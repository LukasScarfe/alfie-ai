// A placeholder screen type that proves the pipeline: centred, word-wrapped
// text. `size` is the text's cap height in face units (the ring has radius 1);
// it shrinks to fit the box.
const PITCH = 1.6;   // line to line, in cap heights

export default {
  type: "label",
  draw({ w, h, options, S }) {
    const words = S.title(options.text ?? "") || "Alfie";
    let ht = Math.max(0.02, Number(options.size) || 0.3);
    const fits = (hh) => {
      const lines = S.wrap(words, (2 * w * 0.92) / hh);
      const single = lines.some((l) => !l.includes(" ") && S.width(l, hh) > 2 * w * 0.92);
      return { lines, ok: !single && lines.length * PITCH * hh - (PITCH - 1) * hh <= 2 * h * 0.92 };
    };
    let f = fits(ht);
    for (let i = 0; i < 40 && !f.ok && ht > 0.02; i++) { ht *= 0.88; f = fits(ht); }
    const total = (f.lines.length - 1) * PITCH * ht;
    return f.lines.flatMap((line, i) => S.text(line, ht, 0, total / 2 - i * PITCH * ht));
  },
};
