// The sky from above: the horizon as a circle (north up, east right, as on a map),
// the zenith at the centre, dotted rings at 30 and 60 degrees. The sun and the moon
// (in phase) sit at their compass bearing and height, outside the circle when
// below the horizon. Today's sun path and the moon's pass are dotted, and the
// rise and set times go under the chart. Ports xy figures.py `_sky`.
// Everything is computed in the browser from latitude, longitude and t, once a
// minute (memo), never per frame.
const V = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const K = await import(`../alfie-sky.js${V}`);

const R = 0.6, CY = 0.08, BELOW = 35;   // chart radius, centre height, lowest body shown (degrees)
const dotted = 0.15;

// A body's place on the chart in canonical units: below the horizon is outside the circle.
const xy = (alt, az) => {
  const r = R * (90 - Math.max(-BELOW, Math.min(90, alt))) / 90;
  return [r * Math.sin(az * Math.PI / 180), CY + r * Math.cos(az * Math.PI / 180)];
};

// The moon's track over the horizon: the pass it is on, or its next if it is down.
// It rises ~50 min later each day, so a pass often spans midnight and a calendar
// day would cut it in two. Bounded so a place where it never sets still returns.
function moonPass(lat, lon, t, step = 600) {
  const up = (s) => K.moon(lat, lon, s)[0] >= 0;
  let start = t;
  if (up(t)) {
    while (t - start < 20 * 3600 && up(start - step)) start -= step;
  } else {
    let found = false;
    for (let i = 0; i < (26 * 3600) / step; i++) { start += step; if (up(start)) { found = true; break; } }
    if (!found) return [];
  }
  const path = [];
  for (let k = 0; k <= (20 * 3600) / step; k++) {
    const [alt, az] = K.moon(lat, lon, start + k * step);
    if (alt < 0) break;
    path.push(xy(alt, az));
  }
  return path;
}

const scaleAll = (strokes, s, dy = 0) => strokes.map((k) => ({ ...k, pts: k.pts.map(([x, y]) => [x * s, (y + dy) * s]) }));

// Everything but the text, in canonical units.
function chart(o, lat, lon, tz, t, S) {
  const out = [];
  // Horizon with compass ticks, one stroke: spikes outward at E, S, W and a
  // longer arrow-tipped one at N.
  const rim = [], n = 96;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const p = [R * Math.sin(a), CY + R * Math.cos(a)];
    rim.push(p);
    if (i === 0) {
      const tip = [0, CY + R + 0.16];
      rim.push(tip, [-0.035, CY + R + 0.11], tip, [0.035, CY + R + 0.11], tip, p);
    } else if (i % (n / 4) === 0) {
      rim.push([(R + 0.06) * Math.sin(a), CY + (R + 0.06) * Math.cos(a)], p);
    }
  }
  out.push(S.stroke(rim, { closed: true, w: 0.4 }));
  if (o.rings) {
    for (const alt of [30, 60]) {
      const r = (R * (90 - alt)) / 90;
      out.push(S.stroke(Array.from({ length: 48 }, (_, i) => [r * Math.sin((2 * Math.PI * i) / 48), CY + r * Math.cos((2 * Math.PI * i) / 48)]),
        { closed: true, w: dotted, role: "dim" }));
    }
  }
  if (o.labels) {
    // Letters just outside the ticks; north's sits above its arrow.
    for (const [ch, x, y] of [["N", 0, CY + R + 0.25], ["E", R + 0.14, CY], ["S", 0, CY - R - 0.14], ["W", -R - 0.14, CY]]) {
      out.push(...S.text(ch, 0.07, x, y, { role: "dim" }));
    }
  }

  // Today's sun path over the horizon only, from where it rises to where it sets.
  const mid = K.localMidnight(t, tz);
  if (o.sun_path) {
    let path = [];
    const flush = () => { if (path.length > 1) out.push(S.stroke(path, { w: dotted, role: "dim" })); path = []; };
    for (let k = 0; k <= 144; k++) {
      const [alt, az] = K.sun(lat, lon, mid + k * 600);
      if (alt >= 0) path.push(xy(alt, az)); else flush();
    }
    flush();
  }
  if (o.moon_path) {
    const mp = moonPass(lat, lon, t);
    if (mp.length > 1) out.push(S.stroke(mp, { w: dotted, role: "dim" }));
  }
  return out;
}

export default {
  type: "sky",
  draw({ w, h, t, options, config, memo, S }) {
    const o = options ?? {};
    const loc = K.location(o, config);
    const u = Math.min(h, w / 0.95);           // canonical unit: half the height of xy's frame
    const wide = w / h > 1.35;
    if (!loc) return S.text("Sky", 0.3 * u, 0, 0);
    const minute = Math.floor(t / 60);
    const key = `${minute}|${loc.lat}|${loc.lon}|${loc.tz}|${w.toFixed(3)}|${h.toFixed(3)}|${JSON.stringify(o)}`;
    if (memo.key === key) return memo.out;

    const { lat, lon, tz } = loc;
    const sz = Number(o.size) || 1;
    const items = chart(o, lat, lon, tz, t, S);
    const [sAlt, sAz] = K.sun(lat, lon, t);
    const [mAlt, mAz] = K.moon(lat, lon, t);
    const [sx, sy] = xy(sAlt, sAz), [mx, my] = xy(mAlt, mAz);
    items.push(...K.sunMark(sx, sy, 0.05 * sz));
    items.push(...K.moonStrokes(mx, my, 0.06 * sz, K.moonPhase(t), { fill: !!o.moon_fill, flip: lat < 0 }));
    const out = scaleAll(items, u);

    if (o.times) {
      const mid = K.localMidnight(t, tz);
      const sunRS = K.riseSet((s) => K.sun(lat, lon, s)[0], mid, -0.833);
      const hrs = (x) => (x === null ? null : K.localHours(x, tz));
      const rows = [[sunRS, null]];
      if (o.moon_times) rows.push([K.riseSet((s) => K.moon(lat, lon, s)[0], mid, 0), "moon"]);
      const hh = 0.1 * u;
      // A small arrow, up for rise and down for set, then the time.
      const entry = (cx, cy, up, text) => {
        const wTxt = S.width(text, hh), a = hh * 0.45, gap = hh * 0.5;
        const x0 = cx - (wTxt + 2 * a + gap) / 2;
        const tri = up ? [[x0, cy - a], [x0 + 2 * a, cy - a], [x0 + a, cy + a]] : [[x0, cy + a], [x0 + 2 * a, cy + a], [x0 + a, cy - a]];
        out.push(S.stroke(tri, { closed: true, w: 0.8 }), ...S.text(text, hh, x0 + 2 * a + gap + wTxt / 2, cy));
      };
      rows.forEach(([rs, kind], i) => {
        const rise = K.clock(hrs(rs.rise)), set = K.clock(hrs(rs.set));
        if (wide) {
          // Beside the disc, which leaves the corners of a wide box free.
          const x = w * 0.7, y = (0.1 - i * 0.24) * u;
          entry(-x, y, true, rise); entry(x, y, false, set);
        } else {
          const y = (-0.8 - i * 0.14) * u;
          entry(-0.5 * u, y, true, rise); entry(0.5 * u, y, false, set);
          if (o.moon_times) out.push(...(kind ? K.moonStrokes(0, y, 0.035 * u, 0.3, { dark: false }) : K.sunMark(0, y, 0.025 * u)));
        }
      });
    }
    memo.key = key; memo.out = out;
    return out;
  },
};
