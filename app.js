(() => {
  const LIMIT = 20; // percent of calories from fat
  const $ = (id) => document.getElementById(id);
  const els = {
    panel: $('panel'), pct: $('pct'), lede: $('lede'), verdict: $('verdict'),
    cal: $('cal'), fat: $('fat'), unitG: $('unitG'), unitCal: $('unitCal'),
    convLabel: $('convLabel'), conv: $('conv'), maxFat: $('maxFat'), clear: $('clearBtn'),
    status: $('status'), statusText: $('statusText'), thumb: $('thumb'), bar: $('barFill'),
    scanBtn: $('scanBtn'), pickBtn: $('pickBtn'), file: $('fileInput'),
    camera: $('camera'), video: $('video'), shutter: $('shutter'), camCancel: $('camCancel'),
    camHint: $('camHint'), camView: $('camView'), foundBox: $('foundBox'),
    theme: $('themeColor'),
  };
  let fatUnit = 'g';

  // ================= math =================
  const num = (s) => {
    const v = parseFloat(String(s).replace(',', '.'));
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  const fmt = (v) => (Math.round(v * 10) / 10).toString();

  function show(state, title, lede, verdict) {
    document.body.classList.remove('pass', 'fail');
    if (state) document.body.classList.add(state);
    els.panel.className = 'panel ' + state + (state ? ' has-result' : '');
    els.pct.textContent = title;
    els.lede.textContent = lede;
    els.verdict.textContent = verdict;
    els.theme.content = getComputedStyle(document.body).getPropertyValue('--page').trim();
  }

  function calc() {
    const cal = num(els.cal.value), fat = num(els.fat.value);
    els.clear.hidden = els.cal.value === '' && els.fat.value === '';

    const fatCal = fat === null ? null : (fatUnit === 'g' ? fat * 9 : fat);
    els.convLabel.textContent = fatUnit === 'g' ? 'Calories from fat' : 'Fat in grams';
    els.conv.textContent = fat === null ? '0' : (fatUnit === 'g' ? fmt(fatCal) : fmt(fat / 9) + ' g');
    els.maxFat.textContent = (cal === null ? '0' : fmt(cal * LIMIT / 100 / 9)) + ' g';

    if (cal === null || fat === null) {
      const missing = cal === null && fat === null ? 'Scan a label or barcode, or type the calories and total fat.'
        : cal === null ? 'Add the calories to see the result.' : 'Add the total fat to see the result.';
      return show('', 'Fat Facts', missing, '');
    }
    if (cal === 0 && fatCal === 0) return show('pass', '0%', 'of calories from fat', `✓ At or under the ${LIMIT}% limit`);
    const pct = cal === 0 ? Infinity : (fatCal / cal) * 100;
    // Rounding on real labels can push fat a little past the total (cooking spray, oils).
    if (pct > 115) return show('', 'Fat Facts', 'The fat adds up to more calories than the total. Check both numbers.', '');
    const pass = pct <= LIMIT;
    show(pass ? 'pass' : 'fail', fmt(Math.min(pct, 100)) + '%', 'of calories from fat',
      pass ? `✓ At or under the ${LIMIT}% limit` : `✕ Over the ${LIMIT}% limit`);
  }

  function setUnit(u) {
    fatUnit = u;
    els.unitG.setAttribute('aria-pressed', u === 'g');
    els.unitCal.setAttribute('aria-pressed', u === 'cal');
    calc();
  }

  // ================= reading numbers out of label text =================
  const FROM_FAT = 'f[a-z ]{0,6}at'; // "from Fat", also when the reader garbles it to "f at"
  const fixDigits = (s) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(',', '.');
  const labelRound = (g) => (g < 5 ? Math.round(g * 2) / 2 : Math.round(g));

  // Reads the grams from whatever follows "Total Fat" on its row, e.g. "8g 10%".
  // The reader's usual mistakes: the "g" becomes a 9 or another character ("8g" -> "89",
  // "0.5g" -> "0.5¢"), digits get split ("19g" -> "1 9g"), or the number is unreadable
  // ("8g" -> "ig"). The % Daily Value on the same row is used to pick the right reading.
  function readFat(rest, out) {
    const dvM = /(\d{1,3})\s*%/.exec(rest);
    const seg = (dvM ? rest.slice(0, dvM.index) : rest).trim();
    const cands = [];
    const weak = []; // "8g" read as "80", "86"...: only believed if the daily value agrees
    const add = (s) => {
      const mm = /^([0-9OoIl|]+(?:[.,][0-9OoIl|]+)?)(.*)$/.exec(s.replace(/^[<~]/, ''));
      if (!mm || mm[2].length > 2) return;
      const raw = fixDigits(mm[1]);
      let v = parseFloat(raw);
      if (!Number.isFinite(v)) return;
      if (/^m/i.test(mm[2])) v /= 1000;
      if ((raw.split('.')[1] || '').length < 2) cands.push(v);          // labels never print 2 decimals
      if (!mm[2] && /\d9$/.test(raw)) cands.push(parseFloat(raw.slice(0, -1)));
      else if (!mm[2] && /^\d{2,}$/.test(raw)) weak.push(parseFloat(raw.slice(0, -1)));
    };
    const toks = seg.split(/\s+/).filter(Boolean);
    while (toks.length > 1 && toks[0].length <= 2 && !/\d|^[Oo]/.test(toks[0])) toks.shift(); // stray letter before the number
    if (toks.length) add(toks[0]);
    if (toks.length > 1 && /^[gq9]$/i.test(toks[1])) add(toks[0] + 'g');
    if (toks.length > 1 && dvM) add(toks.join(''));

    if (dvM) {
      const want = Number(dvM[1]);
      // Daily value for fat is 78 g on current labels and was 65 g on older ones.
      const bases = out.fatCal !== null ? [65, 78] : [78, 65];
      const err = (x) => Math.min(...bases.map((b) => Math.abs(x / b * 100 - want)));
      cands.sort((a, b) => err(a) - err(b));
      if (cands.length && err(cands[0]) <= 1.6) { out.fatChecked = true; return cands[0]; }
      const rescued = weak.find((w) => err(w) <= 1.6);
      if (rescued !== undefined) { out.fatChecked = true; return rescued; }
      if (cands.length) return cands[0];
      if (want <= 100) { out.fatFromDV = want; return labelRound(want * bases[0] / 100); }
      return null;
    }
    if (cands.length > 1 && out.calories !== null && cands[0] * 9 > out.calories * 1.1) cands.reverse();
    return cands.length ? cands[0] : null;
  }

  function parseLabel(text) {
    const out = { calories: null, fatG: null, fatCal: null, estimate: null, fatFromDV: null, fatChecked: false, calChecked: false, checked: false };
    const t = text.replace(/\r/g, '');

    // Older labels: "Calories from Fat 110"
    let m = new RegExp(`calories\\s*${FROM_FAT}\\D{0,6}?(\\d{1,4})`, 'i').exec(t);
    if (m) out.fatCal = Number(m[1]);

    // "Calories 230". Skips "Calories from Fat" and the "2,000 calorie diet" footnote,
    // and rejoins a number the reader split in two ("1 50").
    const calRe = new RegExp(`calor[a-z]{2,4}\\b(?![ \\t]*${FROM_FAT})(?![ \\t]*per\\s*gram)[^\\d\\n]{0,20}?(\\d{1,4})(?: (\\d{2})\\b(?!\\s*%))?(?!\\d*,\\d{3})`, 'gi');
    while ((m = calRe.exec(t))) {
      const v = Number(m[1].length === 1 && m[2] ? m[1] + m[2] : m[1]);
      if (v <= 2500) { out.calories = v; break; }
    }
    // The number alone on the line after "Calories"
    if (out.calories === null && (m = /calor[a-z]{2,4}[^\d\n]*\n+[ \t]*(\d{1,4})[ \t]*(?:\n|$)/i.exec(t))) out.calories = Number(m[1]);
    // UK/EU style: "Energy 250 kcal"
    if (out.calories === null && (m = /(\d{1,4})\s*kcal/i.exec(t))) out.calories = Number(m[1]);

    // "Total Fat 8g 10%"
    const fatRe = /(?:tota.[ \t]*fat|^[^a-z\n]*fat)\b[ \t]*[:.]?/gim;
    while ((m = fatRe.exec(t))) {
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 90).split('\n');
      // Values usually share the row; if the row is empty they are on the next lines.
      let rest = /[\dOo]/.test(after[0]) ? after[0] : after.filter((s) => s.trim()).slice(0, 3).join(' ');
      rest = rest.trim();
      if (/^less/i.test(rest) || /carbohydrate/i.test(rest)) continue; // footnote tables
      const g = readFat(rest, out);
      if (g !== null) { out.fatG = g; break; }
      out.fatFromDV = null;
    }

    // Cross-checks using the label's own numbers.
    const grams = (re) => { const g = re.exec(t); return g ? parseFloat(g[1]) : null; };
    const carb = grams(/carb[a-z. ]{0,18}?(\d{1,3}(?:\.\d)?)\s*g\b/i);
    const protein = grams(/protein[a-z ]{0,4}?(\d{1,3}(?:\.\d)?)\s*g\b/i);
    if (carb !== null && protein !== null && out.fatG !== null) {
      const est = out.estimate = Math.round(carb * 4 + protein * 4 + out.fatG * 9); // 4, 4 and 9 calories per gram
      const near = (c) => Math.abs(est - c) <= Math.max(20, c * 0.2);
      if (out.calories !== null && !near(out.calories)) {
        // A stray mark read as an extra digit ("150" -> "1508")? Try without the first or last digit.
        const s = String(out.calories);
        const fix = [s.slice(0, -1), s.slice(1)].filter(Boolean).map(Number).find(near);
        if (fix !== undefined) out.calories = fix;
      }
      out.calChecked = out.calories !== null && near(out.calories);
    }
    if (out.fatCal !== null && out.fatG !== null && Math.abs(out.fatCal - out.fatG * 9) <= 8) out.fatChecked = true;
    if (out.fatFromDV !== null) out.fatChecked = false;
    out.checked = out.fatChecked && out.calChecked;
    return out;
  }

  const hasFat = (f) => f.fatG !== null || f.fatCal !== null;
  const complete = (f) => f.calories !== null && hasFat(f);
  const score = (f) => (complete(f) ? (f.checked ? 3 : 2) : (f.calories !== null || hasFat(f) ? 1 : 0));
  function merge(best, p) {
    if (!best) return p;
    if (score(p) > score(best)) [best, p] = [p, best];
    if (!complete(best)) {
      for (const k of ['calories', 'fatCal']) if (best[k] === null) best[k] = p[k];
      if (best.fatG === null && p.fatG !== null) { best.fatG = p.fatG; best.fatFromDV = p.fatFromDV; }
    }
    return best;
  }

  // ================= the label reader: PaddleOCR, running on the phone =================
  // A text reader built for photos. It returns each piece of text with its position,
  // so the label's rows can be rebuilt from where things sit rather than guessed.
  const PADDLE = 'https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm';
  const ORT_DIST = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';
  let paddlePromise = null;
  let paddleFailed = false;
  let readerReady = false;

  function getPaddle() {
    if (!paddlePromise) {
      paddlePromise = (async () => {
        const { PaddleOCR } = await import(PADDLE);
        const models = new URL('models/', document.baseURI).href;
        const ocr = await PaddleOCR.create({
          textDetectionModelName: 'PP-OCRv5_mobile_det',
          textDetectionModelAsset: { url: models + 'PP-OCRv5_mobile_det_onnx_infer.tar' },
          textRecognitionModelName: 'en_PP-OCRv5_mobile_rec',
          textRecognitionModelAsset: { url: models + 'en_PP-OCRv5_mobile_rec_onnx_infer.tar' },
          ortOptions: { backend: 'wasm', wasmPaths: ORT_DIST },
        });
        readerReady = true;
        try { localStorage.setItem('readerReady', '1'); } catch (e) { /* private mode */ }
        return ocr;
      })();
      paddlePromise.catch((err) => { paddleFailed = true; console.warn('PaddleOCR unavailable, using the backup reader', err); });
    }
    return paddlePromise;
  }

  const median = (list) => { const s = list.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  // Turns the reader's pieces of text into the rows of one label, as plain text.
  function readPanel(items, k, W, H) {
    const boxes = items.filter((i) => i.text && i.text.trim() && i.poly && i.poly.length >= 4).map((i) => {
      const p = i.poly.map(([x, y]) => [x / k, y / k]);
      const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
      return {
        text: i.text.trim(),
        x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
        cx: (xs[0] + xs[1] + xs[2] + xs[3]) / 4, cy: (ys[0] + ys[1] + ys[2] + ys[3]) / 4,
        w: Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), h: Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1]),
        angle: Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]),
      };
    });
    const out = { text: '', rect: null, labels: 0 };
    if (!boxes.length) return out;
    const typical = median(boxes.map((b) => b.h));

    // Headings: "Nutrition Facts" in type clearly bigger than the body text.
    const heads = boxes.filter((b) => /nutrit/i.test(b.text) && b.text.replace(/[^a-z]/gi, '').length <= 18 && b.h >= typical * 1.3);
    out.labels = heads.length;
    const dist = (b) => Math.hypot(b.cx - W / 2, b.cy - H / 2);
    const hd = heads.sort((a, b) => dist(a) - dist(b))[0] || null;

    // Work in the label's own upright frame, so a tilted label still lines up in rows.
    const wide = boxes.filter((b) => b.w > b.h * 3);
    const tilt = hd ? hd.angle : median((wide.length ? wide : boxes).map((b) => b.angle));
    const a = Math.abs(tilt) < 0.6 ? tilt : 0;
    const px = hd ? hd.cx : W / 2, py = hd ? hd.cy : H / 2;
    for (const b of boxes) {
      const dx = b.cx - px, dy = b.cy - py;
      b.rx = dx * Math.cos(a) + dy * Math.sin(a);
      b.ry = -dx * Math.sin(a) + dy * Math.cos(a);
      b.rx0 = b.rx - b.w / 2; b.rx1 = b.rx + b.w / 2;
    }

    let panel = boxes;
    if (hd) {
      let hw = hd.w;
      if (!/fact/i.test(hd.text)) { // "Facts" came out as its own piece, or was missed
        const facts = boxes.find((b) => b !== hd && /^facts?\W*$/i.test(b.text) && b.rx0 > hd.rx && Math.abs(b.ry) < hd.h * 0.6);
        hw = facts ? facts.rx1 - hd.rx0 : hd.w * 1.62;
      }
      const left0 = hd.rx0, right0 = hd.rx0 + hw;
      let left = left0 - hw * 0.3, right = right0 + hw * 0.9;
      for (const o of heads) { // don't run into a neighbouring label
        if (o === hd || Math.abs(o.ry) > hw) continue;
        if (o.rx0 > right0) right = Math.min(right, o.rx0 - hw * 0.05);
        if (o.rx1 < left0) left = Math.max(left, o.rx1 + hw * 0.02);
      }
      const inBand = (b) => b.ry > -hd.h * 0.8 && b.ry < hw * 3.2 && b.rx0 >= left && b.rx0 <= right;
      // The "% Daily Value" column sits flush against the label's right edge.
      const pcts = boxes.filter((b) => inBand(b) && /^\d{1,3}\s?%$/.test(b.text)).map((b) => b.rx1);
      right = Math.min(right, pcts.length >= 2 ? Math.max(...pcts) + hw * 0.05 : right0 + hw * 0.35);
      panel = boxes.filter(inBand);
    }

    // Each row: a piece that names a nutrient, plus everything else sitting at the same height
    // ("Total" + "Fat 8g" + "10%" come back as separate pieces as often as one).
    const anchors = panel.filter((b) => /calor|fat|carb|protein|kcal/i.test(b.text)).sort((m, n) => m.ry - n.ry || m.rx0 - n.rx0);
    const overlaps = (m, n) => Math.min(m.ry + m.h / 2, n.ry + n.h / 2) - Math.max(m.ry - m.h / 2, n.ry - n.h / 2) >= Math.min(m.h, n.h) * 0.5;
    const rows = anchors.map((m) => panel.filter((n) => n === m || overlaps(m, n)).sort((p, q) => p.rx0 - q.rx0).map((b) => b.text).join(' '));
    out.text = rows.filter((row, i) => rows.indexOf(row) === i).join('\n');

    if (hd && anchors.length) {
      const bottom = anchors[anchors.length - 1].ry + typical * 2;
      const part = panel.filter((b) => b.ry <= bottom);
      const x0 = Math.max(0, Math.min(...part.map((b) => b.x0)) - typical), y0 = Math.max(0, Math.min(...part.map((b) => b.y0)) - typical);
      const x1 = Math.min(W, Math.max(...part.map((b) => b.x1)) + typical), y1 = Math.min(H, Math.max(...part.map((b) => b.y1)) + typical);
      out.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return out;
  }

  async function analyzePaddle(src, { live = false } = {}) {
    const ocr = await getPaddle();
    const W = src.width, H = src.height, long = Math.max(W, H);
    const k = Math.min(live ? 1280 : 1600, Math.max(1100, long)) / long;
    const [page] = await ocr.predict(cropScaled(src, 0, 0, W, H, k));
    const panel = readPanel(page.items || [], k, W, H);
    const r = panel.rect;
    return {
      found: parseLabel(panel.text), rect: r, labels: panel.labels, texts: [panel.text],
      crop: r ? cropScaled(src, r.x, r.y, r.w, r.h, Math.min(1, 600 / Math.max(r.w, r.h))) : null,
    };
  }

  // Reads one picture. Uses PaddleOCR; if that can't run on this phone, the older reader.
  async function analyze(src, opts) {
    if (!paddleFailed) {
      try { return await analyzePaddle(src, opts); }
      catch (err) { paddleFailed = true; console.warn('PaddleOCR failed, using the backup reader', err); }
    }
    return analyzeTess(src, opts);
  }

  // ================= backup reader: Tesseract =================
  let workerPromise = null;
  let tessScript = null;
  function getWorker() {
    if (!workerPromise) {
      tessScript = tessScript || new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('The label reader didn’t load. Connect to the internet and reload, or type the numbers.'));
        document.head.append(s);
      });
      workerPromise = tessScript.then(() => Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (!els.status.classList.contains('busy')) return;
          if (m.status === 'recognizing text') setStatus('Reading the label…', { busy: true, progress: m.progress });
        },
      }));
      workerPromise.catch(() => { workerPromise = null; tessScript = null; });
    }
    return workerPromise;
  }

  // The reader handles one picture at a time, so jobs wait their turn.
  let chain = Promise.resolve();
  function exclusive(fn) {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  }

  async function ocr(canvas, psm) {
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas);
    return data;
  }

  // Copies a region of a picture at a new size. With an angle, the picture is first
  // turned about (px, py) so a tilted label comes out upright.
  function cropScaled(src, x, y, w, h, scale, angle = 0, px = 0, py = 0) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(scale, scale);
    ctx.translate(-x, -y);
    if (angle) { ctx.translate(px, py); ctx.rotate(-angle); ctx.translate(-px, -py); }
    ctx.drawImage(src, 0, 0);
    return c;
  }

  // Every Nutrition Facts panel starts with that heading in its biggest type, spanning
  // the panel's width. Finding the heading gives the panel's position and size.
  function findHeadings(words) {
    const found = [];
    const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    const typical = heights[Math.floor(heights.length / 2)] || 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const s = w.text.toLowerCase().replace(/[^a-z]/g, '');
      if (!/nutrit|utriti|tritio/.test(s)) continue;
      const b = { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 };
      const h = b.y1 - b.y0;
      const next = words[i + 1];
      if (/fact|acts/.test(s)) {
        // "NutritionFacts" read as one word
      } else if (next && next.bbox.x0 > b.x1 - h && Math.abs(next.bbox.y0 - b.y0) < h * 0.6
        && (/fac|act|^f/i.test(next.text) || (h >= typical * 1.8 && Math.abs((next.bbox.y1 - next.bbox.y0) / h - 1) < 0.3))) {
        // The slope from "Nutrition" to "Facts" tells how far the label is tilted.
        const n = next.bbox;
        b.angle = Math.atan2((n.y0 + n.y1) / 2 - (b.y0 + b.y1) / 2, (n.x0 + n.x1) / 2 - (b.x0 + b.x1) / 2);
        b.x1 = n.x1; b.y0 = Math.min(b.y0, n.y0); b.y1 = Math.max(b.y1, n.y1);
      } else if (h >= typical * 1.8) {
        b.x1 = b.x0 + (b.x1 - b.x0) * 1.62; // only "Nutrition" was read; "Facts" follows it
      } else {
        continue; // small print, e.g. "general nutrition advice" in the footnote
      }
      found.push(b);
    }
    return found;
  }

  // Works out the panel's edges from its heading. The heading usually spans the panel,
  // but not always, so the right edge comes from the "% Daily Value" column when it can
  // be seen: those percentages sit flush against the panel's right side.
  function panelRect(b, others, percents, W, H) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const y0 = Math.max(0, b.y0 - h * 0.6), y1 = Math.min(H, b.y1 + w * 2.4);
    let minX = 0, maxX = W; // don't run into a neighbouring label
    for (const o of others) {
      if (o === b || o.y1 < y0 || o.y0 > y1) continue;
      if (o.x0 > b.x1) maxX = Math.min(maxX, o.x0 - w * 0.08);
      if (o.x1 < b.x0) minX = Math.max(minX, o.x1 + w * 0.08);
    }
    const reach = Math.min(maxX, b.x1 + w * 0.7);
    const col = percents.filter((p) => p.y0 > b.y1 && p.y1 < y1 && p.x1 > b.x0 + w * 0.5 && p.x1 <= reach).map((p) => p.x1);
    const right = col.length >= 2 ? Math.max(...col) + w * 0.08 : b.x1 + w * 0.3;
    const x0 = Math.max(minX, b.x0 - w * (b.angle ? 0.12 : 0.2)), x1 = Math.min(maxX, Math.max(right, b.x1 + w * 0.08));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Finds the label in the picture, crops to it and reads the numbers.
  // live = true is the quick version the camera runs over and over.
  async function analyzeTess(src, { live = false } = {}) {
    const W = src.width, H = src.height, long = Math.max(W, H);
    const texts = [];
    const result = { found: null, rect: null, labels: 0, crop: null, texts };

    // Pass 1: whole picture at modest size, just to find the heading(s).
    const k = (live ? 1100 : Math.min(1800, Math.max(1400, long))) / long;
    const overview = await ocr(cropScaled(src, 0, 0, W, H, k), '11');
    texts.push(overview.text);
    const unscale = (b) => ({ x0: b.x0 / k, y0: b.y0 / k, x1: b.x1 / k, y1: b.y1 / k, angle: b.angle || 0 });
    const headings = findHeadings(overview.words || []).map(unscale);
    const percents = (overview.words || []).filter((w) => /^\d{1,3}\s?%$/.test(w.text.trim())).map((w) => unscale(w.bbox));
    const all = headings.slice();
    result.labels = headings.length;

    if (headings.length) {
      // With several labels in view, take the one nearest the middle.
      const dist = (b) => Math.hypot((b.x0 + b.x1) / 2 - W / 2, (b.y0 + b.y1) / 2 - H / 2);
      headings.sort((a, b) => dist(a) - dist(b));
      const hd = headings[0];
      const r = result.rect = panelRect(hd, all, percents, W, H);

      // Pass 2: just that label, straightened and enlarged so the small print is readable.
      const tilt = Math.abs(hd.angle) > 0.012 && Math.abs(hd.angle) < 0.45 ? hd.angle : 0;
      const crop = result.crop = cropScaled(src, r.x, r.y, r.w, r.h, Math.min(4, 1200 / r.w), tilt, hd.x0, (hd.y0 + hd.y1) / 2);
      for (const psm of live ? ['6', '4'] : ['6', '4', '11']) {
        const data = await ocr(crop, psm);
        texts.push(data.text);
        result.found = merge(result.found, parseLabel(data.text));
        if (score(result.found) === 3) break;
      }
      if (live || complete(result.found)) return result;
    } else if (live) {
      return result;
    }

    // No heading found (or it led nowhere): read the whole picture instead.
    const whole = cropScaled(src, 0, 0, W, H, Math.min(2200, Math.max(1700, long)) / long);
    result.found = merge(result.found, parseLabel(overview.text));
    for (const psm of ['6', '3']) {
      if (complete(result.found)) break;
      const data = await ocr(whole, psm);
      texts.push(data.text);
      result.found = merge(result.found, parseLabel(data.text));
    }
    return result;
  }

  // ================= showing a scan =================
  function setStatus(msg, { warn = false, busy = false, progress = null } = {}) {
    els.status.classList.add('show');
    els.status.classList.toggle('warn', warn);
    els.status.classList.toggle('busy', busy);
    els.statusText.textContent = msg;
    if (progress !== null) els.bar.style.width = Math.round(progress * 100) + '%';
  }

  function thumbOf(canvas) {
    const s = Math.min(1, 240 / Math.max(canvas.width, canvas.height));
    return cropScaled(canvas, 0, 0, canvas.width, canvas.height, s).toDataURL('image/jpeg', 0.7);
  }

  function applyResult(res, source) {
    const found = res.found || parseLabel('');
    const picture = res.crop || source;
    els.thumb.hidden = !picture;
    if (picture) els.thumb.src = thumbOf(picture);
    $('rawWrap').hidden = !res.rawText;
    $('rawText').textContent = res.rawText || '';

    if (found.calories !== null) els.cal.value = found.calories;
    if (found.fatCal !== null) { els.fat.value = found.fatCal; setUnit('cal'); }
    else if (found.fatG !== null) { els.fat.value = found.fatG; setUnit('g'); }
    calc();

    const several = res.labels > 1 ? ` There were ${res.labels} labels in view; this is the one nearest the middle.` : '';
    const est = found.estimate;
    if (!complete(found)) {
      if (found.calories === null && !hasFat(found)) {
        return setStatus('No numbers found. Hold the phone straight, move closer and avoid glare, then scan again. Or type them in.', { warn: true });
      }
      const missing = found.calories === null ? 'calories' : 'total fat';
      setStatus(`The ${missing} didn’t come through. Type it in, or scan again.`, { warn: true });
      return (found.calories === null ? els.cal : els.fat).focus();
    }
    if (found.fatCal === null && found.fatFromDV !== null) {
      setStatus(`Read ${found.calories} calories. The fat grams were unclear, so ${found.fatG} g is worked out from the ${found.fatFromDV}% daily value on the label. Check it.${several}`, { warn: true });
      return els.fat.focus();
    }
    if (est !== null && Math.abs(est - found.calories) > Math.max(30, found.calories * 0.35)) {
      setStatus(`Read ${found.calories} calories, but the carbs, protein and fat on the label add up to about ${est}. Check the calories against the label.${several}`, { warn: true });
      return els.cal.focus();
    }
    const fatTxt = found.fatCal !== null ? `${found.fatCal} calories from fat` : `${found.fatG} g of fat`;
    setStatus(`Read ${found.calories} calories and ${fatTxt}. Check them against the label.${several}`);
  }

  async function fileToCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const s = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
      return cropScaled(img, 0, 0, img.naturalWidth, img.naturalHeight, s);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Full read of one picture (a chosen photo, or the camera's "read it now" button).
  async function scan(source) {
    els.scanBtn.disabled = els.pickBtn.disabled = true;
    els.thumb.hidden = true;
    setStatus(readerReady || paddleFailed ? 'Reading the label…' : FIRST_LOAD, { busy: true, progress: 0 });
    try {
      const canvas = source instanceof HTMLCanvasElement ? source : await fileToCanvas(source);
      const res = await exclusive(() => analyze(canvas));
      window.fatApp.last = res;
      if (!res.found || !complete(res.found)) {
        // No readable label in the picture: maybe it shows the barcode instead.
        const product = await barcodeIn(canvas).catch(() => null);
        if (product && product.values) { applyProduct(product); return res.found; }
      }
      applyResult(res, canvas);
      return res.found;
    } catch (err) {
      setStatus(err && err.message ? err.message : 'That picture couldn’t be read. Scan again, or type the numbers.', { warn: true });
    } finally {
      els.scanBtn.disabled = els.pickBtn.disabled = false;
    }
  }

  // ================= barcode: look the product up instead of reading the label =================
  // The barcode number is sent to Open Food Facts, a free public food database.
  // Only that number leaves the phone; no picture does.
  const FIRST_LOAD = 'Getting the label reader ready. This happens once and is about 20 MB.';
  let detectorPromise = null;
  function getDetector() {
    if (!detectorPromise) {
      detectorPromise = import('https://cdn.jsdelivr.net/npm/barcode-detector@3/dist/es/ponyfill.min.js')
        .then((m) => new m.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }));
      detectorPromise.catch(() => { detectorPromise = null; });
    }
    return detectorPromise;
  }

  const lookups = new Map();
  function lookup(code) {
    if (!lookups.has(code)) {
      const p = fetchProduct(code);
      lookups.set(code, p);
      p.catch(() => lookups.delete(code));
    }
    return lookups.get(code);
  }

  async function fetchProduct(code) {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments`);
    if (!r.ok && r.status !== 404) throw new Error('lookup failed');
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const n = j.product.nutriments || {};
    const pick = (suffix, per) => {
      const cal = num(n['energy-kcal' + suffix]), fat = num(n['fat' + suffix]);
      return cal !== null && fat !== null ? { cal: Math.round(cal * 10) / 10, fat: Math.round(fat * 10) / 10, per } : null;
    };
    const brand = String(j.product.brands || '').split(',')[0].trim();
    const name = String(j.product.product_name || '').trim();
    return {
      code,
      name: (brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand + ' ' : '') + (name || 'This product'),
      values: pick('_serving', 'serving') || pick('_100g', '100 g'),
    };
  }

  const isProductCode = (v) => /^\d{8,14}$/.test(v);
  async function barcodeIn(source) {
    const det = await getDetector();
    const codes = (await det.detect(source)).map((c) => c.rawValue).filter(isProductCode);
    return codes.length ? lookup(codes[0]) : null;
  }

  function applyProduct(p) {
    els.cal.value = p.values.cal;
    els.fat.value = p.values.fat;
    els.thumb.hidden = true;
    $('rawWrap').hidden = true;
    setUnit('g');
    setStatus(`${p.name}, found by its barcode: ${p.values.cal} calories and ${p.values.fat} g of fat per ${p.values.per}. This comes from Open Food Facts, a public database, so check it against the label.`);
  }

  // ================= in-app camera =================
  // The live camera runs inside the page. Video frames are copied into memory for
  // reading; nothing is saved to the phone's photos or sent anywhere.
  let stream = null;
  let session = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function grabFrame() {
    const w = els.video.videoWidth, h = els.video.videoHeight;
    if (!w || !h) return null; // camera still starting
    const frame = document.createElement('canvas');
    frame.width = w; frame.height = h;
    frame.getContext('2d').drawImage(els.video, 0, 0, w, h);
    return frame;
  }

  // Draws the outline around the found label, matching how the video is fitted on screen.
  function showFound(rect, frame) {
    if (!rect) { els.foundBox.hidden = true; return; }
    const vw = els.camView.clientWidth, vh = els.camView.clientHeight;
    const s = Math.max(vw / frame.width, vh / frame.height);
    const ox = (vw - frame.width * s) / 2, oy = (vh - frame.height * s) / 2;
    Object.assign(els.foundBox.style, {
      left: ox + rect.x * s + 'px', top: oy + rect.y * s + 'px',
      width: rect.w * s + 'px', height: Math.min(rect.h * s, vh - (oy + rect.y * s) - 4) + 'px',
    });
    els.foundBox.hidden = false;
  }

  // Looks at the camera over and over. When it finds a label and the numbers hold up,
  // it closes the camera by itself and shows the result.
  const POINT = 'Point the camera at the Nutrition Facts label or the barcode';
  let barcodeNote = '';

  // Watches for a barcode at the same time as the label; whichever works first wins.
  async function watchBarcode(my) {
    let det;
    try { det = await getDetector(); } catch (err) { return; }
    const tried = new Set();
    const note = (msg) => { barcodeNote = msg; els.camHint.textContent = msg; setTimeout(() => { if (barcodeNote === msg) barcodeNote = ''; }, 6000); };
    while (my === session && stream) {
      await wait(400);
      if (my !== session || !stream || !els.video.videoWidth) continue;
      let codes = [];
      try { codes = await det.detect(els.video); } catch (err) { continue; }
      const code = codes.map((c) => c.rawValue).find((v) => isProductCode(v) && !tried.has(v));
      if (!code) continue;
      tried.add(code);
      note('Barcode found. Looking it up…');
      let product;
      try { product = await lookup(code); }
      catch (err) { note('The food database can’t be reached. Point at the Nutrition Facts label instead.'); continue; }
      if (my !== session || !stream) return;
      if (product && product.values) { closeCamera(); return applyProduct(product); }
      note(product ? 'That product is listed without calories and fat. Point at the Nutrition Facts label instead.'
        : 'That barcode isn’t in the food database. Point at the Nutrition Facts label instead.');
    }
  }

  async function watch(my) {
    let previous = null, misses = 0;
    const same = (a, b) => a && b && a.calories === b.calories && a.fatG === b.fatG && a.fatCal === b.fatCal;
    if (!readerReady && !paddleFailed) els.camHint.textContent = FIRST_LOAD + ' A barcode can be scanned meanwhile.';
    while (my === session && stream) {
      const frame = grabFrame();
      if (!frame) { await wait(200); continue; }
      let res;
      try { res = await exclusive(() => analyze(frame, { live: true })); }
      catch (err) { closeCamera(); return setStatus(err.message || 'The label reader stopped. Type the numbers instead.', { warn: true }); }
      if (my !== session || !stream) return;

      showFound(res.rect, frame);
      const f = res.found;
      // Close by itself only when the numbers hold up: both pass the label's own
      // cross-checks, or (when a check isn't possible) two frames in a row agree.
      const disputed = f && f.estimate !== null && !f.calChecked;
      if (f && complete(f) && f.fatFromDV === null && !disputed && (f.checked || same(f, previous))) {
        els.camHint.textContent = 'Got it';
        await wait(350); // let the outline around the label be seen
        if (my !== session || !stream) return;
        window.fatApp.last = res;
        closeCamera();
        return applyResult(res, frame);
      }
      previous = f && complete(f) ? f : null;
      misses = res.rect ? misses + 1 : 0;
      els.camHint.textContent = barcodeNote ? barcodeNote
        : !res.rect ? POINT
        : misses > 2 ? 'Label found, but the numbers are blurry. Move closer or tap the button.'
        : 'Label found. Hold still…';
      await wait(250); // leave the phone a moment to redraw and respond to taps
    }
  }

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return setStatus('This browser can’t open the camera here. Use the photo button, or type the numbers.', { warn: true });
    }
    els.scanBtn.disabled = true;
    els.thumb.hidden = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (err) {
      els.scanBtn.disabled = false;
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      return setStatus(denied
        ? 'The camera is turned off for this app. Allow it in your browser’s site settings, or type the numbers.'
        : 'The camera didn’t start. Use the photo button, or type the numbers.', { warn: true });
    }
    els.scanBtn.disabled = false;
    els.status.classList.remove('show');
    els.video.srcObject = stream;
    els.camHint.textContent = POINT;
    barcodeNote = '';
    els.foundBox.hidden = true;
    els.camera.hidden = false;
    document.body.classList.add('camera-open');
    els.video.play().catch(() => {});
    els.shutter.focus();
    const my = ++session;
    watch(my);
    watchBarcode(my);
  }

  function closeCamera() {
    session++;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    els.video.srcObject = null;
    els.camera.hidden = true;
    document.body.classList.remove('camera-open');
    els.scanBtn.focus();
  }

  function readNow() {
    const frame = grabFrame();
    if (!frame) return;
    closeCamera();
    scan(frame);
  }

  // ================= text handed over by an iPhone Shortcut =================
  // The Shortcut takes the picture, lets the iPhone read the text, and opens this page
  // with that text after "#text=" in the address. The part after # stays on the phone;
  // it is never sent to the server.
  function fromShortcut() {
    const m = /[#&]text=([^&]*)/.exec(location.hash);
    if (!m) return;
    let text = m[1].replace(/\+/g, ' ');
    try { text = decodeURIComponent(text); } catch (e) { /* use it as it came */ }
    history.replaceState(null, '', location.pathname + location.search);
    if (!text.trim()) {
      return setStatus('The phone found no text in that picture. Run the shortcut again closer to the label, or type the numbers.', { warn: true });
    }
    applyResult({ found: parseLabel(text), labels: 1, crop: null, rawText: text }, null);
  }
  window.addEventListener('hashchange', fromShortcut);

  // ================= wiring =================
  els.cal.addEventListener('input', calc);
  els.fat.addEventListener('input', calc);
  els.unitG.addEventListener('click', () => setUnit('g'));
  els.unitCal.addEventListener('click', () => setUnit('cal'));
  els.scanBtn.addEventListener('click', openCamera);
  els.shutter.addEventListener('click', readNow);
  els.camCancel.addEventListener('click', closeCamera);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stream) closeCamera(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) closeCamera(); });

  els.pickBtn.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    const f = els.file.files && els.file.files[0];
    els.file.value = '';
    if (f) scan(f);
  });
  els.clear.addEventListener('click', () => {
    els.cal.value = els.fat.value = '';
    els.status.classList.remove('show');
    $('rawWrap').hidden = true;
    setUnit('g');
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', calc);

  // On a return visit the reader is already saved on the phone, so warm it up right away.
  // On a first visit, wait until a scan is asked for before downloading 20 MB.
  let warm = false;
  try { warm = localStorage.getItem('readerReady') === '1'; } catch (e) { /* private mode */ }
  if (warm) window.addEventListener('load', () => setTimeout(() => getPaddle().catch(() => {}), 600));

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.fatApp = { parseLabel, scan, analyze, analyzeTess, lookup, barcodeIn, last: null };
  calc();
  fromShortcut();
})();
