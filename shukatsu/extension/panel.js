/*
 * The panel beside a filled form, in the tab's top frame and inside a closed
 * shadow root so the site's styles can't reach it (or read it).
 *
 * The rows a candidate must act on come first: what is theirs to answer, then
 * what to glance at, then what was filled from an exact source. Pressing a
 * row scrolls to that field. The panel never submits; its last line says so.
 */

(() => {
  if (globalThis.__shukatsuPanel) return;

  const ORDER = { yours: 0, check: 1, sure: 2, empty: 3 };
  const MARK = { yours: '●', check: '?', sure: '✓', empty: '·' };
  let host = null;
  let root = null;
  let state = null;

  const css = `
    :host { all: initial; }
    .p { position: fixed; top: 16px; right: 16px; width: 360px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
      background: #f6f1e7; color: #1f1d1a; border: 2px solid #1f1d1a; box-shadow: 0 6px 24px rgba(0,0,0,.18);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; z-index: 2147483647; }
    @media (prefers-color-scheme: dark) { .p { background: #1b1a18; color: #ece6da; border-color: #ece6da; } .row:hover { background: #2a2825; } .note, .sub { color: #a39c90; } }
    header { padding: 12px 14px 10px; border-bottom: 1px solid #d9d0bf; display: grid; gap: 2px; }
    .t { font-size: 15px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
    .sub { color: #5b564e; }
    button.x { all: unset; cursor: pointer; padding: 0 4px; font-size: 16px; line-height: 1; }
    ul { list-style: none; margin: 0; padding: 0; overflow: auto; }
    .row { display: grid; grid-template-columns: 18px 1fr; gap: 2px 8px; padding: 8px 14px; border-bottom: 1px solid #d9d0bf; cursor: pointer; }
    .row:hover { background: #ede6d8; }
    .m { font-weight: 700; text-align: center; }
    .m.yours, .m.bad { color: #b8432f; }
    .q { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .v { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .note { grid-column: 2; color: #5b564e; }
    details { padding: 8px 14px; border-bottom: 1px solid #d9d0bf; }
    footer { padding: 10px 14px; font-weight: 600; color: #b8432f; }
  `;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function row(r) {
    const li = el('li', 'row');
    const bad = r.state === 'failed' || r.state === 'restored';
    li.append(el('span', `m ${r.mark}${bad ? ' bad' : ''}`, bad ? '!' : MARK[r.mark] || '·'), el('span', 'q', r.label || '(no label)'));
    if (r.value && r.act !== 'leave') li.append(el('span', 'v', r.value));
    else if (r.value && r.mark === 'yours') li.append(el('span', 'v', `Answer: ${r.value}`));
    if (r.note) li.append(el('span', 'note', r.note));
    li.title = r.label || '';
    li.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'fill.show', ref: r.ref, frameId: r.frameId }));
    return li;
  }

  function draw() {
    if (!root) return;
    root.replaceChildren();
    const style = el('style', null, css);
    const box = el('div', 'p');
    const rows = state.rows.filter((r) => r.mark !== 'skip');
    const count = (m) => rows.filter((r) => r.mark === m && r.mark !== 'empty').length;
    const filled = rows.filter((r) => ['set', 'restored', 'yours-now'].includes(r.state)).length;
    const head = el('header');
    const t = el('div', 't');
    t.append(el('span', null, state.title));
    const x = el('button', 'x', '×');
    x.title = 'Close';
    x.addEventListener('click', () => { host.remove(); host = null; root = null; });
    t.append(x);
    head.append(t, el('span', 'sub', `Filled ${filled} in ${(state.ms / 1000).toFixed(1)} s · ${count('check')} to check · ${count('yours')} yours`));
    if (state.posting) head.append(el('span', 'sub', state.posting));
    const list = el('ul');
    const shown = rows.filter((r) => r.mark !== 'empty').sort((a, b) => (ORDER[a.mark] - ORDER[b.mark]) || ((b.state === 'failed') - (a.state === 'failed')));
    shown.forEach((r) => list.append(row(r)));
    box.append(head, list);
    const empty = rows.filter((r) => r.mark === 'empty');
    if (empty.length) {
      const d = el('details');
      d.append(el('summary', null, `${empty.length} optional, left empty`));
      const ul = el('ul');
      empty.forEach((r) => ul.append(row(r)));
      d.append(ul);
      box.append(d);
    }
    box.append(el('footer', null, 'Submit is yours. The site\'s button is outlined in red.'));
    root.append(style, box);
  }

  function render(next) {
    state = next;
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-shukatsu-panel', '');
      root = host.attachShadow({ mode: 'closed' });
      document.documentElement.append(host);
    }
    draw();
  }

  /** Take a frame's latest rows (the guard putting a value back, the candidate changing one), row by row. */
  function update(frameId, rows) {
    if (!state) return;
    const next = new Map(rows.map((r) => [r.ref, { ...r, frameId }]));
    state.rows = state.rows.map((r) => (r.frameId === frameId && next.has(r.ref) ? next.get(r.ref) : r));
    draw();
  }

  globalThis.__shukatsuPanel = { render, update };
})();
