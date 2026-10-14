/*
 * The extension's one way out: every call goes to the candidate's own
 * shukatsu (the address and capture key set on the options page), through
 * /api/v1, and nowhere else.
 *
 *   observe   from reader.js on a board page, unless reading is off for that
 *             board or altogether -> page.observe
 *   the toolbar button   any page at all, pressed by the candidate ->
 *             posting.capture with the page's text (the bookmarklet's job)
 *
 * The badge says what happened: + a posting went to the inbox, ✓ saved,
 * ! something failed (the options page says what).
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
