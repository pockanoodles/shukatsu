/*
 * The extension's one way out: every call goes to the candidate's own
 * shukatsu (the address and capture key set on the options page), through
 * /api/v1, and nowhere else.
 *
 *   observe   from reader.js on a board page, unless reading is off for that
 *             board or altogether -> page.observe
 *   the toolbar button   any page at all, pressed by the candidate ->
 *             posting.capture with the page's text (the bookmarklet's job)
 *   Fill      the shortcut (Alt+Shift+F) or the toolbar button's menu, on an
 *             application form -> application.plan, then filler.js fills
 *             it, panel.js lists what went where, and application.filled
 *             records how it went. Nothing presses Submit. Preview
 *             (Alt+Shift+P) plans the same way and writes nothing. The
 *             panel's "Remember my answers" -> answers.suggest.
 *
 * The badge says what happened: + a posting went to the inbox, ✓ saved,
 * … filling, ! something failed (the options page says what).
 */

const settings = () => chrome.storage.local.get({ url: 'http://127.0.0.1:3000', token: '', reading: true, off: [] });

async function call(op, input) {
  const { url, token } = await settings();
  if (!token) throw new Error('Set the capture key on the options page.');
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/v1/ops/${op}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!body?.ok) throw new Error(body?.error?.message || `shukatsu answered ${res.status}.`);
  return body.result;
}

async function badge(tabId, text, problem = null) {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: problem ? '#b8432f' : '#2b2b2b' });
  if (problem) await chrome.storage.local.set({ lastError: { at: new Date().toISOString(), message: problem } });
  if (text) setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 4000);
}

/** Whether reading is on for this page's board: a match pattern in `off` turns that board off. */
async function readingOn(pageUrl) {
  const { token, reading, off } = await settings();
  if (!token || !reading) return false;
  const host = new URL(pageUrl).hostname;
  return !off.some((pattern) => {
    const base = pattern.replace(/^https:\/\/(\*\.)?/, '').replace(/\/\*$/, '');
    return host === base || host.endsWith(`.${base}`);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'observe' || !sender.tab) return false;
  (async () => {
    if (!(await readingOn(msg.page.url))) return reply({ ok: false, off: true });
    try {
      const result = await call('page.observe', msg.page);
      if (result.signal && result.kept === 'page' && result.page === 'posting') await badge(sender.tab.id, '+');
      reply({ ok: true, result });
    } catch (e) {
      // A page that hasn't finished loading is read again on its own; anything else is worth showing.
      if (!/no text yet/.test(e.message)) await badge(sender.tab.id, '!', e.message);
      reply({ ok: false, error: e.message });
    }
  })();
  return true;
});

/** Runs in the page when the button is pressed: the selection if there is a long one, else the main text. */
function grab() {
  const main = document.querySelector('main, [role="main"]') || document.body;
  return { url: location.href, title: document.title, text: main.innerText || document.body.innerText || '', selection: String(getSelection() || '') };
}

chrome.runtime.onInstalled.addListener(({ reason }) => { if (reason === 'install') chrome.runtime.openOptionsPage(); });

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grab });
    await call('posting.capture', { ...page, via: 'extension' });
    await badge(tab.id, '✓');
  } catch (e) {
    await badge(tab.id, '!', e.message);
  }
});

// ------------------------------------------------------------------ fill

/** Run a function in the tab: every frame the extension may reach, or the ones named. */
async function inTab(tabId, func, args = [], frameIds = null) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  return chrome.scripting.executeScript({ target, func, args });
}

const reports = new Map(); // tabId -> { url, frames left to report }

/** Fill the form in the tab, or with `dry`, show what would go where and write nothing. */
async function fill(tab, { dry = false } = {}) {
  const started = Date.now();
  await badge(tab.id, '…');
  try {
    // Every frame we may reach: a Greenhouse form often sits in an iframe on the company's own site.
    const files = ['match.js', 'filler.js'];
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files }).catch(() =>
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files }));
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['panel.js'] });
    const read = (await inTab(tab.id, () => globalThis.__shukatsuFill?.read({ fresh: true }) ?? null))
      .filter((r) => r.result?.fields?.some((f) => f.visible));
    if (!read.length) throw new Error('There is no form on this page to fill.');

    const rows = [];
    let posting = null;
    let unmatched = null;
    for (const { frameId, result } of read) {
      const plan = await call('application.plan', { url: result.url, fields: result.fields });
      posting = posting || plan.posting;
      unmatched = unmatched || plan.note;
      const [{ result: done }] = await inTab(tab.id, (p) => globalThis.__shukatsuFill.act(p), [{ ...plan, dry }], [frameId]);
      rows.push(...done.rows.map((r) => ({ ...r, frameId })));
      if (dry) continue;
      // An answer can reveal a follow-up question, or fill a list that was empty (a state list once the
      // country is chosen); plan and fill those once more.
      const [{ result: next }] = await inTab(tab.id, () => globalThis.__shukatsuFill.again(), [], [frameId]);
      if (next.fields.some((f) => f.visible)) {
        const more = await call('application.plan', { url: next.url, fields: next.fields });
        const [{ result: two }] = await inTab(tab.id, (p) => globalThis.__shukatsuFill.act({ ...p, resume: null }), [more], [frameId]);
        const replanned = new Set(two.rows.map((r) => r.ref));
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].frameId === frameId && replanned.has(rows[i].ref)) rows.splice(i, 1);
        rows.push(...two.rows.map((r) => ({ ...r, frameId })));
      }
      await inTab(tab.id, () => globalThis.__shukatsuFill.watch(), [], [frameId]);
    }
    const ms = Date.now() - started;
    if (!dry) reports.set(tab.id, { url: read[0].result.url, left: read.length, ms });
    const title = posting ? `${posting.company}, ${posting.role}` : new URL(read[0].result.url).hostname;
    const note = posting
      ? (posting.by === 'company' ? `Matched to your ${posting.company} posting by the site's name, not its link. Check it's the right one.` : null)
      : unmatched || 'shukatsu doesn\'t know this posting, so only your profile and stated answers were used.';
    const { url: app } = await settings();
    await inTab(tab.id, (s) => globalThis.__shukatsuPanel.render(s), [{ title, posting: note, rows, ms, dry, app: `${app.replace(/\/+$/, '')}/answers` }], [0]);
    await badge(tab.id, '');
  } catch (e) {
    await badge(tab.id, '!', e.message);
  }
}

/** The panel's "Remember my answers": what the candidate entered by hand, from every frame, kept as suggestions. */
async function remember(tabId) {
  const frames = await inTab(tabId, () => globalThis.__shukatsuFill?.answers() ?? null);
  let kept = 0;
  for (const { result } of frames) {
    if (!result?.items?.length) continue;
    kept += (await call('answers.suggest', result)).kept;
  }
  return kept;
}

const count = (rows, test) => rows.filter(test).length;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return false;
  if (msg?.type === 'fill.rows') {
    chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: (f, r) => globalThis.__shukatsuPanel?.update(f, r), args: [sender.frameId, msg.rows] }).catch(() => {});
    const rep = reports.get(tabId);
    if (msg.final && rep) {
      const r = msg.rows;
      call('application.filled', {
        url: rep.url, ms: rep.ms,
        filled: count(r, (x) => ['set', 'restored', 'yours-now'].includes(x.state)), check: count(r, (x) => x.mark === 'check'),
        yours: count(r, (x) => x.mark === 'yours'), restored: count(r, (x) => x.state === 'restored'), failed: count(r, (x) => x.state === 'failed'),
      }).catch(() => {});
      if (--rep.left <= 0) reports.delete(tabId);
    }
  }
  if (msg?.type === 'fill.run') { chrome.tabs.get(tabId).then((tab) => fill(tab)).catch(() => {}); return false; }
  if (msg?.type === 'fill.remember') {
    remember(tabId).then((kept) => reply({ ok: true, kept }), (e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'fill.show') {
    chrome.scripting.executeScript({ target: { tabId, frameIds: [msg.frameId ?? 0] }, func: (ref) => globalThis.__shukatsuFill?.show(ref), args: [msg.ref] }).catch(() => {});
  }
  return false;
});

chrome.commands.onCommand.addListener((command, tab) => { if (tab && (command === 'fill' || command === 'preview')) fill(tab, { dry: command === 'preview' }); });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'fill', title: 'Fill this application', contexts: ['action'] }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create({ id: 'preview', title: 'Preview the fill (writes nothing)', contexts: ['action'] }, () => void chrome.runtime.lastError);
});
chrome.contextMenus.onClicked.addListener((info, tab) => { if (tab && (info.menuItemId === 'fill' || info.menuItemId === 'preview')) fill(tab, { dry: info.menuItemId === 'preview' }); });
