/**
 * Connector operations: accounts, sync, and purge. The connectors themselves
 * live in connectors/, and their copies of outside data in sync.db.
 *
 * Adding, changing, or removing an account and purging its data are stamps
 * (connector.manage) and never an agent's: connecting a mailbox decides what
 * data reaches this machine. Listing is open to whoever may read the inbox,
 * and never returns a secret. Syncing is open to them as well, because it only
 * fetches again what the account already allows.
 *
 * page.observe is the browser extension's way in. It is owner-only, so it
 * arrives through the owner's capture key and never from an agent, which has
 * no browser to have read a page in.
 */

import { CONNECTORS, changeAccount, connectorIds, createAccount, removeAccount, syncNow } from '../../connectors/index.mjs';
import { observe } from '../../connectors/browser/index.mjs';
import { PAGE_KINDS } from '../../platforms/index.mjs';
import { getAccount, listAccounts, openSignalCount, purge, syncDb } from '../sync.mjs';
import { S } from './schema.mjs';

const notFound = Object.assign(new Error('There is no such account.'), { code: 'not_found', status: 404 });

const ACCOUNT = S.obj({
  id: S.int(), connector: S.str(), label: S.str(), settings: S.any('Public settings only: a feed\'s host, a Gmail client id. Credentials are never returned.'),
  status: S.enum(['ok', 'needs_auth', 'error', 'paused']), created_at: S.str(), last_attempt_at: S.nullable(S.str()), last_sync_at: S.nullable(S.str()),
  has_error: S.bool(), has_secret: S.bool(), records: S.int(), open_signals: S.int(),
});

const counts = (root, id) => ({
  records: syncDb(root).prepare('SELECT COUNT(*) AS n FROM records WHERE account_id = ?').get(id).n,
  open_signals: syncDb(root).prepare("SELECT COUNT(*) AS n FROM signals s JOIN records r ON r.id = s.record_id WHERE r.account_id = ? AND s.status = 'open' AND s.kind != 'noise'").get(id).n,
});

const view = (root, a) => {
  const { fail_count: _f, last_error: _e, ...rest } = a;
  return { ...rest, has_error: Boolean(a.last_error), ...counts(root, a.id) };
};

const FIELDS = {
  label: S.str('A name for it on the settings page.', { maxLength: 80 }),
  url: S.str('A calendar feed address (https:// or webcal://). For Canvas: Calendar, then Calendar Feed.', { maxLength: 2000 }),
  client_id: S.str('The OAuth client id from your Google Cloud project.', { maxLength: 300 }),
  client_secret: S.str('The OAuth client secret from the same project.', { maxLength: 300 }),
  timezone: S.str('Where a feed\'s times with no zone are read, e.g. America/New_York.', { format: 'timezone' }),
  lookback_days: S.int('How far back the first Gmail sync looks.', { minimum: 1, maximum: 365 }),
};

const subject = (id) => `connector:${id}`;

export default [
  {
    name: 'connector.list',
    kind: 'query',
    summary: 'The connectors that exist (calendar feeds, Gmail) and the accounts connected, with status, last sync, and how many records and open signals each holds. Never returns a credential. Error text from a remote server is outside text under untrusted.',
    permission: 'inbox.read',
    untrusted: true,
    input: S.obj({}),
    output: S.obj({
      connectors: S.arr(S.any()), accounts: S.arr(ACCOUNT), open_signals: S.int(),
      untrusted: S.obj({ errors: S.any('Last error per account id.') }, ['errors']),
    }, ['connectors', 'accounts', 'untrusted']),
    run: ({ root }) => {
      const accounts = listAccounts(root);
      return {
        connectors: CONNECTORS.map((m) => ({ id: m.id, name: m.name, description: m.description, capabilities: m.capabilities, auth: m.auth, allowedHosts: m.allowedHosts, intervalMinutes: m.intervalMinutes })),
        accounts: accounts.map((a) => view(root, a)),
        open_signals: openSignalCount(root),
        untrusted: { errors: Object.fromEntries(accounts.filter((a) => a.last_error).map((a) => [String(a.id), a.last_error])) },
      };
    },
  },
  {
    name: 'connector.add',
    kind: 'command',
    summary: 'Connect a calendar feed or Gmail. A person does this signed in, since it decides what outside data reaches this machine.',
    permission: 'connector.manage',
    stamp: true,
    agent: false,
    input: S.obj({ connector: S.enum(connectorIds()), ...FIELDS }, ['connector']),
    output: S.obj({ account: ACCOUNT, next: S.nullable(S.str()) }, ['account']),
    activity: (input, out) => ({ verb: 'connector.added', subject: subject(out.account.id), detail: { connector: input.connector } }),
    run: ({ root, input }) => {
      const { connector, ...rest } = input;
      const a = createAccount(root, connector, rest);
      return { account: view(root, a), next: a.status === 'needs_auth' && connector === 'gmail' ? `/connectors/gmail/start?account=${a.id}` : null };
    },
  },
  {
    name: 'connector.update',
    kind: 'command',
    summary: 'Change a connected account: its name, feed address, Gmail client, timezone, or pause it. Changing a Gmail client means signing in again.',
    permission: 'connector.manage',
    stamp: true,
    agent: false,
    input: S.obj({ id: S.int(null, { minimum: 1 }), ...FIELDS, paused: S.bool('Stop syncing without removing it.') }, ['id']),
    output: S.obj({ account: ACCOUNT, next: S.nullable(S.str()) }, ['account']),
    activity: (input) => ({ verb: 'connector.updated', subject: subject(input.id), detail: { fields: Object.keys(input).filter((k) => k !== 'id') } }),
    run: ({ root, input }) => {
      const { id, ...rest } = input;
      if (!getAccount(root, id)) throw notFound;
      const a = changeAccount(root, id, rest);
      return { account: view(root, a), next: a.status === 'needs_auth' && a.connector === 'gmail' ? `/connectors/gmail/start?account=${a.id}` : null };
    },
  },
  {
    name: 'connector.remove',
    kind: 'command',
    summary: 'Disconnect an account and delete everything copied from it, its credential included.',
    permission: 'connector.manage',
    stamp: true,
    agent: false,
    input: S.obj({ id: S.int(null, { minimum: 1 }) }, ['id']),
    output: S.obj({ id: S.int() }, ['id']),
    activity: (input) => ({ verb: 'connector.removed', subject: subject(input.id) }),
    run: ({ root, input }) => {
      if (!getAccount(root, input.id)) throw notFound;
      removeAccount(root, input.id);
      return { id: input.id };
    },
  },
  {
    name: 'connector.sync',
    kind: 'command',
    summary: 'Fetch one connected account now instead of waiting for its schedule. Returns what arrived, or why it could not.',
    permission: 'inbox.write',
    input: S.obj({ id: S.int(null, { minimum: 1 }) }, ['id']),
    output: S.obj({ ok: S.bool(), records: S.int(), added: S.int(), signals: S.int(), error: S.str() }, ['ok']),
    activity: (input, out) => ({ verb: 'connector.synced', subject: subject(input.id), detail: { ok: out.ok, added: out.added ?? 0 } }),
    run: ({ root, input }) => {
      if (!getAccount(root, input.id)) throw notFound;
      return syncNow(root, input.id);
    },
  },
  {
    name: 'connector.purge',
    kind: 'command',
    summary: 'Delete the copies of outside data (messages, events, signals) for one connector, or for all of them. Accounts stay connected and fetch again from now on.',
    permission: 'connector.manage',
    stamp: true,
    agent: false,
    input: S.obj({ connector: S.enum(connectorIds(), 'Only this connector. Leave out for everything.') }),
    output: S.obj({ records: S.int(), signals: S.int() }, ['records', 'signals']),
    activity: (input, out) => ({ verb: 'connector.purged', subject: input.connector ? `connector:${input.connector}` : 'connector:all', detail: out }),
    run: ({ root, input }) => purge(root, { connector: input.connector }),
  },
  {
    name: 'page.observe',
    kind: 'command',
    summary: 'A page of a login-walled board (NUworks, Handshake, LinkedIn, CareerForum.Net) the candidate opened, as the browser extension read it. The board and page kind are decided from the URL; a posting becomes an inbox signal to save it, and any other page of the board is kept by its path alone.',
    permission: 'page.observe',
    untrusted: true,
    input: S.obj({
      url: S.url(),
      title: S.str(null, { maxLength: 500, default: '' }),
      text: S.text('The page\'s visible text. Sent only after a URL-only call answered wants_text.', 400000, { default: '' }),
      links: S.arr(S.str(null, { maxLength: 2000 }), 'The page\'s links; only http(s) ones are kept.', { maxItems: 1000, default: [] }),
      observed_at: S.str('When the page was read, ISO 8601.', { maxLength: 40 }),
    }, ['url']),
    output: S.obj({
      platform: S.str(), page: S.enum([...PAGE_KINDS, 'other']), kept: S.enum(['page', 'path', 'none']),
      record: S.nullable(S.int()), signal: S.nullable(S.int()), wants_text: S.bool('Send the page again with its text: the board lists this kind of page.'),
    }, ['platform', 'page', 'kept', 'record']),
    run: ({ root, input }) => observe(root, input),
  },
];
