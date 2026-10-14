/* The options page: where shukatsu runs, the capture key, and which boards are read. */

const $ = (id) => document.getElementById(id);
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
    status.textContent = `Connected as ${body.result.name}.`;
  } catch (e) {
    status.className = 'bad';
    status.textContent = e.message === 'Failed to fetch' ? `Nothing answered at ${url}. Is shukatsu running?` : e.message;
  }
}

$('save').addEventListener('click', save);
load();
