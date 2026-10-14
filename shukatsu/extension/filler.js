/*
 * The form filler: injected into the tab (every frame of it) only when the
 * candidate presses Fill, and only ever acting on the form in front of them.
 *
 *   read()       every field on the page as a person sees it: its kind, its
 *                question (the accessible name), whether it is required, its
 *                options. Hidden fields are reported as hidden and never
 *                filled, since a field no person can see is often a bot trap.
 *   act(plan)    fills the plan shukatsu returned (application.plan), in the
 *                order that beats the site's own autofill:
 *                  1. the resume goes in first, and the filler waits for the
 *                     site to finish reading it into the form;
 *                  2. every planned value is written over whatever the site
 *                     put there, through the browser's own value setter plus
 *                     the input and change events a framework listens for;
 *                  3. each value is read back, and one that didn't hold is
 *                     typed again the slower way;
 *                  4. for GUARD_MS after, a value the site (or the browser's
 *                     autofill) changes is put back. One the candidate changes
 *                     by hand is theirs and is left alone.
 *   show(ref)    scrolls to a field, for a row in the panel (panel.js).
 *
 * It never presses Submit, Next, or any button. The site's Submit button is
 * outlined so the candidate can see it is theirs.
 */

(() => {
  if (globalThis.__shukatsuFill) return;

  const MAX_OPTIONS = 300;
  const GUARD_MS = 12000;
  const SHU = '#b8432f';

  let seq = 0;
  const refs = new Map(); // ref -> { el } or { group: [inputs] }
  let busy = false; // true while the filler itself is writing, so its own events aren't taken for the candidate's
  const touched = new Map(); // ref -> when the candidate last changed it by hand
  const labels = new Map(); // ref -> the question, as read
  let session = []; // every row filled since the candidate pressed Fill, across rounds

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const fold = (s) => clean(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[*✱]+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (el) => (el ? clean(el.innerText ?? el.textContent) : '');

  /** A label's own words, without the text of the controls inside it (a wrapping label holds its select's options). */
  function ownText(el) {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('input, select, textarea, option, [role="listbox"], [role="option"]').forEach((n) => n.remove());
    return clean(copy.textContent);
  }

  const byIds = (ids) => clean(String(ids).split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? ownText(n) : ''; }).join(' '));

  /** What a person reads as this control's question. */
  function labelOf(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = byIds(by); if (t) return t; }
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) { const t = ownText(l); if (t) return t; }
    }
    const wrap = el.closest('label');
    if (wrap) { const t = ownText(wrap); if (t) return t; }
    return nearbyText(el) || clean(el.getAttribute('placeholder') || el.title || '');
  }

  /** The closest text before a control, climbing a few levels: how most custom forms put a question above its box. */
  function nearbyText(el) {
    let e = el;
    for (let i = 0; i < 4 && e && e !== document.body; i++) {
      for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.matches('input, select, textarea, button') || p.querySelector('input, select, textarea')) break;
        const t = ownText(p);
        if (t && t.length <= 400) return t;
      }
      e = e.parentElement;
    }
    return '';
  }

  /** The question a group of radios or boxes answers together. */
  function groupLabel(inputs) {
    const fs = inputs[0].closest('fieldset');
    if (fs && inputs.every((i) => fs.contains(i))) { const lg = fs.querySelector('legend'); if (lg && ownText(lg)) return ownText(lg); }
    const g = inputs[0].closest('[role="radiogroup"], [role="group"]');
    if (g) {
      const t = (g.getAttribute('aria-labelledby') && byIds(g.getAttribute('aria-labelledby'))) || clean(g.getAttribute('aria-label'));
      if (t) return t;
    }
    let common = inputs[0].parentElement;
    while (common && !inputs.every((i) => common.contains(i))) common = common.parentElement;
    return common ? nearbyText(common.firstElementChild || common) || nearbyText(common) : '';
  }

  /** Whether a person can see it. Off-screen to the top or left, zero-sized, or styled away all count as hidden. */
  function seen(el) {
    if (!el.isConnected || el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  }

  /** A styled radio or box hides its input and shows its label; a type-ahead's input can be 2px wide inside a visible box. */
  function visible(el, kind) {
    if (seen(el)) return true;
    if (kind === 'radio' || kind === 'checkbox') {
      const l = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
      return Boolean(l && seen(l));
    }
    if (kind === 'combobox') {
      let e = el.parentElement;
      for (let i = 0; i < 3 && e; i++, e = e.parentElement) if (seen(e)) return true;
    }
    return false;
  }

  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    const role = el.getAttribute('role');
    if (role === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') return 'combobox';
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'password'].includes(type)) return null;
    return type;
  };

  const required = (el, label) => el.required || el.getAttribute('aria-required') === 'true' || /[*✱]\s*$/.test(label) || /\(required\)/i.test(label);

  function refFor(target) {
    if (!target.dataset.shukatsuRef) target.dataset.shukatsuRef = `f${++seq}`;
    return target.dataset.shukatsuRef;
  }

  // ------------------------------------------------------------------ read

  /** `fresh` starts a new fill: what was filled before is forgotten. */
  function read({ fresh = false } = {}) {
    if (fresh) session = [];
    const fields = [];
    const groups = new Map();
    for (const el of document.querySelectorAll('input, select, textarea')) {
      const kind = kindOf(el);
      if (!kind || el.disabled || (el.readOnly && kind !== 'combobox')) continue;
      if ((kind === 'radio' || kind === 'checkbox') && el.name) {
        const key = `${kind}:${el.form ? [...document.forms].indexOf(el.form) : -1}:${el.name}`;
        if (!groups.has(key)) groups.set(key, { kind, inputs: [] });
        groups.get(key).inputs.push(el);
        continue;
      }
      const ref = refFor(el);
      refs.set(ref, { el, kind });
      const label = labelOf(el);
      const f = {
        ref, kind, label: label.slice(0, 1000), name: el.name || '', id: el.id || '', autocomplete: el.getAttribute('autocomplete') || '',
        placeholder: el.getAttribute('placeholder') || '', required: required(el, label), visible: visible(el, kind),
        maxlength: el.maxLength > 0 ? el.maxLength : null, options: null,
      };
      if (kind === 'select') {
        const opts = [...el.options].map((o) => ({ text: clean(o.text).slice(0, 500), value: String(o.value).slice(0, 500) }));
        f.options = opts.length <= MAX_OPTIONS ? opts : null;
      }
      fields.push(f);
    }
    for (const { kind, inputs } of groups.values()) {
      if (kind === 'checkbox' && inputs.length === 1) {
        const el = inputs[0];
        const ref = refFor(el);
        refs.set(ref, { el, kind });
        const label = labelOf(el);
        fields.push({ ref, kind, label: label.slice(0, 1000), name: el.name, id: el.id || '', autocomplete: '', placeholder: '', required: required(el, label), visible: visible(el, kind), maxlength: null, options: null });
        continue;
      }
      const ref = refFor(inputs[0]);
      refs.set(ref, { group: inputs, kind });
      const label = groupLabel(inputs);
      fields.push({
        ref, kind, label: label.slice(0, 1000), name: inputs[0].name, id: '', autocomplete: '', placeholder: '',
        required: inputs.some((i) => required(i, label)), visible: inputs.some((i) => visible(i, kind)), maxlength: null,
        options: inputs.slice(0, MAX_OPTIONS).map((i) => ({ text: labelOf(i).slice(0, 500), value: String(i.value).slice(0, 500) })),
      });
    }
    for (const f of fields) labels.set(f.ref, f.label);
    return { url: location.href, fields };
  }

  // ------------------------------------------------------------------ write

  const setter = (el) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  /** Write a value the way a framework notices: the native setter (past any wrapper the page put on the element), then the events. */
  function setValue(el, value) {
    setter(el).call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  /** The slower way, for a field that ignored setValue: focus it and insert the text as typing would. */
  function typeValue(el, value) {
    el.focus();
    if (typeof el.select === 'function') el.select();
    const ok = document.execCommand && document.execCommand('insertText', false, value);
    if (!ok) setValue(el, value);
    el.blur();
  }

  function setFile(input, file) {
    const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name, { type: file.type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** The option a value names in a list the server didn't see (too long, or only there once opened): exact, then starts-with, then the one that contains it. */
  function pickText(texts, want) {
    const w = fold(want);
    const t = texts.map(fold);
    let i = t.indexOf(w);
    if (i >= 0) return i;
    const starts = t.flatMap((x, j) => (x.startsWith(w) || (x.length >= 3 && w.startsWith(x)) ? [j] : []));
    if (starts.length === 1) return starts[0];
    const has = t.flatMap((x, j) => (x.includes(w) ? [j] : []));
    return has.length === 1 ? has[0] : -1;
  }

  const press = (el) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  };

  function optionsFor(input) {
    const ids = [input.getAttribute('aria-controls'), input.getAttribute('aria-owns')].filter(Boolean).join(' ');
    const lists = ids ? ids.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean) : [];
    const found = lists.flatMap((l) => [...l.querySelectorAll('[role="option"]')]);
    return (found.length ? found : [...document.querySelectorAll('[role="option"]')]).filter(seen);
  }

  async function pickCombo(input, want) {
    input.focus();
    setValue(input, want);
    let opts = [];
    for (let waited = 0; waited < 2500 && !opts.length; waited += 100) { await sleep(100); opts = optionsFor(input); }
    const i = pickText(opts.map(textOf), want);
    if (i < 0) { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return null; }
    const chosen = textOf(opts[i]);
    press(opts[i]);
    await sleep(50);
    return chosen;
  }

  const comboShows = (input, text) => {
    for (let e = input.parentElement, n = 0; e && n < 4; e = e.parentElement, n++) if (fold(textOf(e)).includes(fold(text))) return true;
    return false;
  };

  // A masked field reformats what it's given ("(617) 555-0123"), so compare letters and digits only.
  const same = (a, b) => String(a || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === String(b || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  /** Whether the field still says what the plan put there. */
  function holds(r) {
    const h = refs.get(r.ref);
    if (!h) return false;
    if (r.act === 'file') return h.el.files?.length > 0 && h.el.files[0].name === r.value;
    if (h.group) return h.group[r.option]?.checked === true;
    if (h.kind === 'select') return h.el.selectedIndex >= 0 && same(h.el.options[h.el.selectedIndex].text, r.value);
    if (h.kind === 'combobox') return comboShows(h.el, r.value);
    if (h.kind === 'checkbox') return h.el.checked === true;
    return same(h.el.value, r.value);
  }

  async function write(r) {
    const h = refs.get(r.ref);
    if (!h) return false;
    if (h.group) {
      const target = h.group[r.option];
      if (target && !target.checked) target.click();
      return true;
    }
    if (h.kind === 'select') {
      const i = r.option ?? pickText([...h.el.options].map((o) => o.text), r.value);
      if (i < 0) return false;
      h.el.selectedIndex = i;
      h.el.dispatchEvent(new Event('input', { bubbles: true }));
      h.el.dispatchEvent(new Event('change', { bubbles: true }));
      r.value = clean(h.el.options[i].text);
      return true;
    }
    if (h.kind === 'combobox') {
      const chosen = await pickCombo(h.el, r.value);
      if (!chosen) return false;
      r.value = chosen;
      return true;
    }
    setValue(h.el, r.value);
    return true;
  }

  /** Every field's current value at once, for telling when the page has stopped changing. */
  const snapshot = () => [...refs.values()].map((h) => (h.group ? h.group.map((i) => i.checked).join() : h.el.type === 'file' ? h.el.files?.length : h.el.value)).join('\u0001');

  /** Resolve once no field has changed for `quiet` ms (and at least `min` ms have passed), or after `max`. */
  async function settle({ min, quiet, max }) {
    const start = performance.now();
    let last = snapshot();
    let since = start;
    while (performance.now() - start < max) {
      await sleep(100);
      const now = snapshot();
      if (now !== last) { last = now; since = performance.now(); }
      if (performance.now() - start >= min && performance.now() - since >= quiet) return;
    }
  }

  const isAutofill = (el) => { try { return el.matches(':autofill'); } catch { try { return el.matches(':-webkit-autofill'); } catch { return false; } } };

  function onEdit(ev) {
    if (busy || !ev.isTrusted) return;
    const el = ev.target;
    // The browser's own autofill fires trusted events too; it is not the candidate choosing a value.
    if (!(el instanceof Element) || isAutofill(el)) return;
    const ref = el.closest('[data-shukatsu-ref]')?.dataset.shukatsuRef || [...refs.entries()].find(([, h]) => h.group?.includes(el))?.[0];
    if (ref) touched.set(ref, Date.now());
  }
  document.addEventListener('input', onEdit, true);
  document.addEventListener('change', onEdit, true);

  /** Outline the site's Submit button: the candidate presses it, never the filler. */
  function markSubmit() {
    const buttons = [...document.querySelectorAll('button, input[type="submit"]')].filter((b) => seen(b)
      && (b.type === 'submit' || /^(submit|apply|send)( (my |your )?application)?\b/i.test(clean(b.innerText || b.value))));
    for (const b of buttons) {
      b.style.outline = `3px solid ${SHU}`;
      b.style.outlineOffset = '3px';
      b.title = 'shukatsu filled the form. Submitting is yours.';
    }
    return buttons.length;
  }

  /**
   * Fill a plan (application.plan's output for fields read() returned).
   * Returns { rows, ms }. A second round (fields the first one revealed) is
   * another act; watch() then guards everything filled since read({fresh}).
   */
  async function act(plan) {
    const started = performance.now();
    const rows = plan.entries.filter((e) => e.mark !== 'skip').map((e) => ({ ...e, label: labels.get(e.ref) || '', state: e.act === 'leave' ? 'left' : 'pending' }));

    busy = true;
    try {
      // 1. The resume first, so the site's own resume reading happens before our values go in, not after.
      const files = rows.filter((r) => r.act === 'file');
      for (const r of files) {
        const h = refs.get(r.ref);
        if (!plan.resume || !h) { r.state = 'left'; r.mark = 'yours'; r.note = 'Attach your resume yourself.'; continue; }
        setFile(h.el, plan.resume);
        r.state = 'set';
      }
      if (files.some((r) => r.state === 'set')) {
        busy = false; // the site rewriting fields now is exactly what settle watches for
        await settle(plan.platform?.parser === 'on-upload' ? { min: 1500, quiet: 900, max: 9000 } : { min: 300, quiet: 600, max: 4000 });
        busy = true;
      }
      // 2. Every value, over whatever the site put there.
      for (const r of rows.filter((x) => x.act === 'type' || x.act === 'choose')) {
        try { r.state = (await write(r)) ? 'set' : 'failed'; } catch { r.state = 'failed'; }
        if (r.state === 'failed') { r.mark = 'yours'; r.note = r.note || 'Couldn\'t set this one.'; }
      }
      await sleep(150);
      // 3. Read back; anything a framework threw away gets typed instead.
      for (const r of rows.filter((x) => x.state === 'set' && x.act !== 'file')) {
        if (holds(r)) continue;
        const h = refs.get(r.ref);
        if (h?.el && !h.group && h.kind !== 'select' && h.kind !== 'combobox') { typeValue(h.el, r.value); await sleep(80); }
        if (!holds(r)) { r.state = 'failed'; r.mark = 'yours'; r.note = 'The page didn\'t keep this value.'; }
      }
      // A field we left that the site filled (usually from the resume) is worth a look.
      for (const r of rows.filter((x) => x.state === 'left')) {
        const h = refs.get(r.ref);
        const v = h?.group ? h.group.some((i) => i.checked) : h?.el?.value;
        if (v && r.mark !== 'yours') { r.mark = 'check'; r.note = 'The site filled this itself, likely from your resume.'; }
      }
    } finally {
      busy = false;
    }
    const ms = Math.round(performance.now() - started);
    session.push(...rows);
    markSubmit();
    return { rows, ms };
  }

  const send = (msg) => { try { chrome.runtime.sendMessage({ type: 'fill.rows', ...msg }); } catch { /* the extension was reloaded under this page */ } };

  /** For GUARD_MS, put back any value the site changes; leave the candidate's own changes alone. Reports through `report`. */
  function watch({ report = send, ms = GUARD_MS } = {}) {
    const rows = session;
    const watched = rows.filter((r) => r.state === 'set');
    const tries = new Map();
    const since = Date.now();
    const timer = setInterval(async () => {
      let changed = false;
      for (const r of watched) {
        if (r.state !== 'set' && r.state !== 'restored') continue;
        if ((touched.get(r.ref) || 0) > since) { r.state = 'yours-now'; r.mark = 'sure'; r.note = 'You changed this.'; changed = true; continue; }
        if (holds(r)) continue;
        const n = (tries.get(r.ref) || 0) + 1;
        tries.set(r.ref, n);
        if (n > 3) { r.state = 'failed'; r.mark = 'yours'; r.note = 'The site keeps changing this. Set it yourself.'; changed = true; continue; }
        busy = true;
        try { await write(r); } finally { busy = false; }
        r.state = 'restored';
        r.mark = r.mark === 'sure' ? 'check' : r.mark;
        r.note = 'The site changed this after the fill; shukatsu put it back.';
        changed = true;
      }
      if (changed) report({ rows, final: false });
      if (Date.now() - since > ms) { clearInterval(timer); report({ rows, final: true }); }
    }, 300);
  }

  /** Scroll a field into view and flash it, from a row in the panel. */
  function show(ref) {
    const h = refs.get(ref);
    const el = h?.group ? h.group[0] : h?.el;
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const box = el.closest('label, fieldset') || el;
    const was = box.style.outline;
    box.style.outline = `3px solid ${SHU}`;
    setTimeout(() => { box.style.outline = was; }, 1600);
    if (!h.group) el.focus({ preventScroll: true });
    return true;
  }

  globalThis.__shukatsuFill = { read, act, watch, show };
})();
