"use client";

import { useActionState } from "react";
import { addBrowserAction, addFeedAction, addGmailAction, pauseAccountAction, purgeAction, removeAccountAction, syncAccountAction } from "@/app/actions/connectors";
import { addLineAction, sendLineAction, updateLineAction } from "@/app/actions/notify";
import { ConfirmSubmit, Submit } from "@/components/client";

type L = Record<string, string>;

const Msg = ({ s }: { s: { ok: boolean; message?: string; error?: string } | null }) =>
  s ? <span role={s.ok ? "status" : "alert"} className={`text-[14px] ${s.ok ? "" : "text-shu"}`}>{s.ok ? s.message : s.error}</span> : null;

export function FeedForm({ zone, l }: { zone: string; l: L }) {
  const [state, action] = useActionState(addFeedAction, null);
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <label className="grid gap-1.5">
        <span className="label text-ink-2">{l.url}</span>
        <input name="url" type="text" inputMode="url" required autoComplete="off" spellCheck={false} placeholder="webcal://…" className="field code" maxLength={2000} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.label}</span><input name="label" placeholder={l.labelPlaceholder} className="field" maxLength={80} /></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.timezone}</span><input name="timezone" defaultValue={zone} className="field code" /></label>
      </div>
      <div className="flex items-center gap-4"><Submit className="btn btn-sm" pending={l.working}>{l.add}</Submit><Msg s={state} /></div>
    </form>
  );
}

export function GmailForm({ l }: { l: L }) {
  const [state, action] = useActionState(addGmailAction, null);
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.clientId}</span><input name="client_id" required autoComplete="off" spellCheck={false} className="field code" maxLength={300} /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.clientSecret}</span><input name="client_secret" type="password" required autoComplete="off" className="field code" maxLength={300} /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.label}</span><input name="label" placeholder={l.labelPlaceholder} className="field" maxLength={80} /></label>
      <div className="flex items-center gap-4"><Submit className="btn btn-sm" pending={l.working}>{l.add}</Submit><Msg s={state} /></div>
    </form>
  );
}

export function BrowserForm({ l }: { l: L }) {
  const [state, action] = useActionState(addBrowserAction, null);
  return (
    <form action={action} className="flex items-center gap-4"><Submit className="btn btn-sm" pending={l.working}>{l.add}</Submit><Msg s={state} /></form>
  );
}

/** Sync, pause, and remove for one connected account. A push connector (the extension) has nothing to sync. */
export function AccountButtons({ id, paused, connect, push = false, l }: { id: number; paused: boolean; connect: string | null; push?: boolean; l: L }) {
  const [state, action] = useActionState(syncAccountAction, null);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {connect && <a href={connect} className="btn btn-sm">{l.connect}</a>}
      {!push && <form action={action}><input type="hidden" name="id" value={id} /><Submit className="btn btn-ghost btn-sm" pending={l.syncing}>{l.sync}</Submit></form>}
      <form action={pauseAccountAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="paused" value={paused ? "0" : "1"} /><button className="label text-ink-2 underline underline-offset-4">{paused ? l.resume : l.pause}</button></form>
      <form action={removeAccountAction}><input type="hidden" name="id" value={id} /><ConfirmSubmit message={l.removeConfirm} className="label text-ink-2 underline underline-offset-4">{l.remove}</ConfirmSubmit></form>
      <Msg s={state} />
    </div>
  );
}

export function PurgeForm({ connector, label, confirm, ghost = true }: { connector?: string; label: string; confirm: string; ghost?: boolean }) {
  const [state, action] = useActionState(purgeAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-4">
      {connector && <input type="hidden" name="connector" value={connector} />}
      <ConfirmSubmit message={confirm} className={ghost ? "btn btn-ghost btn-sm" : "btn btn-sm"}>{label}</ConfirmSubmit>
      <Msg s={state} />
    </form>
  );
}

/** The schedule and what LINE gets, shared by connecting and changing it. Day and mode names come translated from the page. */
function LineSchedule({ v, days, modes, l }: { v: { mode: string; weekday: number; hour: number; timezone: string }; days: string[]; modes: Record<string, string>; l: L }) {
  return (
    <>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.mode}</span>
        <select name="mode" defaultValue={v.mode} className="field">{Object.entries(modes).map(([k, name]) => <option key={k} value={k}>{name}</option>)}</select></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.weekday}</span>
          <select name="weekday" defaultValue={v.weekday} className="field">{days.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.hour}</span>
          <select name="hour" defaultValue={v.hour} className="field">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${h}:00`}</option>)}</select></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.timezone}</span><input name="timezone" defaultValue={v.timezone} className="field code" /></label>
      </div>
    </>
  );
}

const LINE_DEFAULTS = { mode: "nudge", weekday: 0, hour: 9, timezone: "Asia/Tokyo" };

export function LineForm({ days, modes, l }: { days: string[]; modes: Record<string, string>; l: L }) {
  const [state, action] = useActionState(addLineAction, null);
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.secret}</span><input name="channel_secret" required autoComplete="off" spellCheck={false} className="field code" maxLength={64} /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.token}</span><input name="channel_access_token" type="password" required autoComplete="off" className="field code" maxLength={1000} /></label>
      <LineSchedule v={LINE_DEFAULTS} days={days} modes={modes} l={l} />
      <div className="flex items-center gap-4"><Submit className="btn btn-sm" pending={l.working}>{l.add}</Submit><Msg s={state} /></div>
    </form>
  );
}

export function LineSettingsForm({ id, v, days, modes, l }: { id: number; v: typeof LINE_DEFAULTS; days: string[]; modes: Record<string, string>; l: L }) {
  const [state, action] = useActionState(updateLineAction, null);
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <input type="hidden" name="id" value={id} />
      <LineSchedule v={v} days={days} modes={modes} l={l} />
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.newToken}</span><input name="channel_access_token" type="password" autoComplete="off" className="field code" maxLength={1000} /></label>
      <div className="flex items-center gap-4"><Submit className="btn btn-ghost btn-sm" pending={l.working}>{l.save}</Submit><Msg s={state} /></div>
    </form>
  );
}

export function SendLineForm({ l }: { l: L }) {
  const [state, action] = useActionState(sendLineAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-4">
      <ConfirmSubmit message={l.sendConfirm} className="btn btn-sm">{l.sendNow}</ConfirmSubmit>
      <Msg s={state} />
    </form>
  );
}
