/* The options page: where shukatsu runs, the capture key, which boards are read, and where forms may be filled. */

const $ = (id) => document.getElementById(id);
const fillOrigins = chrome.runtime.getManifest().optional_host_permissions || [];
const boards = [...new Set(chrome.runtime.getManifest().content_scripts[0].matches.map((m) => m.replace(/^https:\/\/(\*\.)?/, '').replace(/\/\*$/, '')))];

async function load() {
  const s = await chrome.storage.local.get({ url: 'http://127.0.0.1:3000', token: '', reading: true, off: [], lastError: null });
  $('url').value = s.url;
  $('token').value = s.token;
  $('reading').checked = s.reading;
  $('boards').replaceChildren(...boards.map((host) => {
    const row = document.createElement('label');
    row.className = 'row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.host = host;
    box.checked = !s.off.includes(host);
    row.append(box, document.createTextNode(host));
    return row;
  }));
  await showFill();
  if (s.lastError) $('last').textContent = `Last problem (${new Date(s.lastError.at).toLocaleString()}): ${s.lastError.message}`;
}

async function save() {
  const url = $('url').value.trim().replace(/\/+$/, '') || 'http://127.0.0.1:3000';
  const token = $('token').value.trim();
  const off = [...document.querySelectorAll('#boards input')].filter((b) => !b.checked).map((b) => b.dataset.host);
  await chrome.storage.local.set({ url, token, reading: $('reading').checked, off, lastError: null });
  $('last').textContent = '';
  const status = $('status');
  status.className = '';
  status.textContent = 'Checking…';
  try {
    const res = await fetch(`${url}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error?.message || `shukatsu answered ${res.status}.`);
    const scopes = body.result.token?.scopes || [];
    if (!scopes.includes('page.observe')) throw new Error('This key can\'t read pages. Make a new capture key in shukatsu.');
    status.textContent = scopes.includes('application.plan') ? `Connected as ${body.result.name}.` : `Connected as ${body.result.name}, but this key is older than form filling. Make a new capture key to fill forms.`;
  } catch (e) {
    status.className = 'bad';
    status.textContent = e.message === 'Failed to fetch' ? `Nothing answered at ${url}. Is shukatsu running?` : e.message;
  }
}

/** Filling reaches a form inside a Greenhouse, Lever, or Ashby frame only with access to that host, asked for once here. */
async function showFill() {
  const granted = await chrome.permissions.contains({ origins: fillOrigins });
  $('fill-state').textContent = granted ? 'Allowed. Press Alt+Shift+F on an application form.' : 'Not allowed yet. A form on the site itself still fills; one framed inside a company page needs this.';
  $('fill-allow').hidden = granted;
}

$('fill-allow').addEventListener('click', async () => { await chrome.permissions.request({ origins: fillOrigins }); await showFill(); });
$('save').addEventListener('click', save);
load();
