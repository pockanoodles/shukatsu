/*
 * The page reader: runs on the boards listed in manifest.json, in the
 * extension's own isolated world, and only reads what the page already shows.
 * It never clicks, scrolls, types, or fetches anything from the board.
 *
 * On every page the candidate opens (single-page apps included, by watching
 * the address), it sends the URL alone. shukatsu answers wants_text for a page
 * the board lists (a posting, the applications list, a thread); only then does
 * the reader wait for the page to stop changing and send its visible text and
 * links. Any other page's text never leaves the browser.
 */

(() => {
  const QUIET_MS = 1500;
  const MAX_WAIT_MS = 12000;
  const MAX_LINKS = 1000;

  let lastUrl = '';
  let sentText = new Map(); // url -> a fingerprint of the text already sent

  const send = (page) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'observe', page }, (reply) => resolve(chrome.runtime.lastError ? null : reply));
    } catch {
      resolve(null); // the extension was reloaded under this page
    }
  });

  /** Resolve once the page has gone QUIET_MS without a change, or after MAX_WAIT_MS. */
  const settled = () => new Promise((resolve) => {
    let timer = setTimeout(done, QUIET_MS);
    const cap = setTimeout(done, MAX_WAIT_MS);
    const watch = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, QUIET_MS); });
    watch.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    function done() { watch.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); }
  });

  function read() {
    const main = document.querySelector('main, [role="main"]') || document.body;
    const links = [...new Set([...main.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/.test(h)))].slice(0, MAX_LINKS);
    return { title: document.title, text: main.innerText || '', links };
  }

  const fingerprint = (text) => `${text.length}:${text.slice(0, 120)}:${text.slice(-120)}`;

  async function look(url) {
    const first = await send({ url, observed_at: new Date().toISOString() });
    if (!first?.ok || !first.result?.wants_text) return;
    await settled();
    if (location.href !== url) return; // moved on while it loaded
    let page = read();
    if (page.text.trim().length < 200) { await new Promise((r) => setTimeout(r, 3000)); page = read(); }
    const fp = fingerprint(page.text);
    if (sentText.get(url) === fp) return;
    const out = await send({ url, observed_at: new Date().toISOString(), ...page });
    if (out?.ok) sentText.set(url, fp);
  }

  function check() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    look(lastUrl);
  }

  check();
  setInterval(check, 1000);
})();
