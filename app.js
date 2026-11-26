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
      const missing = cal === null && fat === null ? 'Scan a label, or type its calories and total fat.'
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
    const add = (s) => {
      const mm = /^([0-9OoIl|]+(?:[.,][0-9OoIl|]+)?)(.*)$/.exec(s.replace(/^[<~]/, ''));
      if (!mm || mm[2].length > 2) return;
      const raw = fixDigits(mm[1]);
      let v = parseFloat(raw);
      if (!Number.isFinite(v)) return;
      if (/^m/i.test(mm[2])) v /= 1000;
      if ((raw.split('.')[1] || '').length < 2) cands.push(v);          // labels never print 2 decimals
      if (!mm[2] && /\d9$/.test(raw)) cands.push(parseFloat(raw.slice(0, -1)));
    };
    const toks = seg.split(/\s+/).filter(Boolean);
    if (toks.length) add(toks[0]);
    if (toks.length > 1 && /^[gq9]$/i.test(toks[1])) add(toks[0] + 'g');
    if (toks.length > 1 && dvM) add(toks.join(''));

    if (dvM) {
      const want = Number(dvM[1]);
      // Daily value for fat is 78 g on current labels and was 65 g on older ones.
      const bases = out.fatCal !== null ? [65, 78] : [78, 65];
      const err = (x) => Math.min(...bases.map((b) => Math.abs(x / b * 100 - want)));
      cands.sort((a, b) => err(a) - err(b));
      if (cands.length) {
        if (err(cands[0]) <= 1.6) out.fatChecked = true;
        return cands[0];
      }
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
    const carb = grams(/total\s*carb[a-z.]*\s*(\d{1,3}(?:\.\d)?)\s*g\b/i);
    const protein = grams(/protein\s*(\d{1,3}(?:\.\d)?)\s*g\b/i);
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

  // ================= finding the label in a picture =================
  let workerPromise = null;
  function getWorker() {
    if (!window.Tesseract) return Promise.reject(new Error('The label reader didn’t load. Connect to the internet and reload, or type the numbers.'));
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (!els.status.classList.contains('busy')) return;
          if (m.status === 'recognizing text') setStatus('Reading the label…', { busy: true, progress: m.progress });
          else if (/load/.test(m.status)) setStatus('Setting up the label reader. This happens once.', { busy: true, progress: m.progress || 0 });
        },
      });
      workerPromise.catch(() => { workerPromise = null; });
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
  async function analyze(src, { live = false } = {}) {
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
    els.thumb.src = thumbOf(res.crop || source);
    els.thumb.hidden = false;

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
    setStatus('Looking for the label…', { busy: true, progress: 0 });
    try {
      const canvas = source instanceof HTMLCanvasElement ? source : await fileToCanvas(source);
      const res = await exclusive(() => analyze(canvas));
      window.fatApp.last = res;
      applyResult(res, canvas);
      return res.found;
    } catch (err) {
      setStatus(err && err.message ? err.message : 'That picture couldn’t be read. Scan again, or type the numbers.', { warn: true });
    } finally {
      els.scanBtn.disabled = els.pickBtn.disabled = false;
    }
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
  async function watch(my) {
    let previous = null, misses = 0;
    const same = (a, b) => a && b && a.calories === b.calories && a.fatG === b.fatG && a.fatCal === b.fatCal;
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
      els.camHint.textContent = !res.rect ? 'Point the camera at a Nutrition Facts label'
        : misses > 3 ? 'Label found, but the numbers are blurry. Move closer or tap the button.'
        : 'Label found. Hold still…';
      await wait(120);
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
    els.camHint.textContent = 'Point the camera at a Nutrition Facts label';
    els.foundBox.hidden = true;
    els.camera.hidden = false;
    document.body.classList.add('camera-open');
    els.video.play().catch(() => {});
    els.shutter.focus();
    watch(++session);
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
    setUnit('g');
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', calc);

  // Warm up the label reader in the background so the first scan is quick.
  window.addEventListener('load', () => setTimeout(() => getWorker().catch(() => {}), 800));

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.fatApp = { parseLabel, scan, analyze, last: null };
  calc();
})();
