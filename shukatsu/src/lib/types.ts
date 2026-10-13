/** Shapes the pages rely on, mirroring what shukatsu/core returns. */

export type Finding = { severity: "error" | "warn"; rule: string; message: string };
export type NumberDiff = { added: string[]; removed: string[] };
export type Evidence = { source: string | null; line: number | null; quote: string | null } | null;

export type EntityView = {
  id: string | null; label: string; heading: string; title?: string | null; dates?: string | null;
  section: string; ended?: boolean; live?: boolean; status?: string; review_status?: string;
};

export type FactView = {
  id: string; text: string; tags: string[]; provenance: string | null; priority: number; pin: boolean;
  status: string; review_status: string; reason: string | null; evidence: Evidence;
  variants: { key: string; for: string[]; text: string; review_status: string; status: string }[];
  ja: { text: string; review_status: string; status: string; note: string | null } | null;
};

export type Warning = { code: string; entity?: string; fact?: string; diff?: NumberDiff; current?: string; blocking?: boolean };

export type QueueItem = {
  key: string; kind: string; source: "profile" | "proposal" | "packet";
  entity: EntityView | null; fact: FactView | null;
  before: string | null; after: string | null; current?: string | null; hasNumbers: boolean;
  evidence?: Evidence; checks: Finding[]; warnings: Warning[]; note?: string | null;
  author?: { id: number; name: string; role: string }; created_at?: string; comments: number;
  variant?: { key: string; for: string[] }; part?: string | null; proposal?: number; packet?: number;
  posting?: { url: string; company: string; role: string; note: string }; reason?: string;
  tags?: string[]; priority?: number; ja?: string | null; company?: string; role?: string;
};

export type Activity = {
  id: number; actor_id: number | null; actor_name: string | null; actor_role: string | null;
  verb: string; subject: string | null; detail: Record<string, unknown> | null; created_at: string;
};

export type Comment = { id: number; subject: string; author_id: number; author_name: string; author_role: string; body: string; created_at: string; resolved_at: string | null; parent_id: number | null };

export type Bullet = {
  id: string | null; variant: string | null; text: string; kind: string; score: number; original: string | null;
  reworded: boolean; problem: string | null; numberDiff: NumberDiff | null; lint: Finding[];
};

export type Packet = {
  id: number; company: string; role: string; url: string | null; jd_path: string | null; archetype: string; lang: string;
  status: "drafting" | "in_review" | "changes_requested" | "ready" | "sent" | "closed";
  tracker_num: number | null; cover_letter: string | null; notes: string | null; created_by: number; author_name: string;
  created_at: string; updated_at: string; sent_on: string | null; jdText: string; changesNote?: string | null;
  sections: { entity: EntityView; bullets: Bullet[] }[];
  pool: { id: string; entity: string; entityLabel: string; text: string; score: number; why: string }[];
  budget: number; count: number; canEdit: boolean;
  manifest: { name: string; status: string; finalized: string | null; deliverable: string | null; sent_on: string | null; gates: { name: string; ok: boolean; out: string }[] | null; problems: string[] | null } | null;
  archetypes: { id: string; name: string }[];
  coverCheck: { sentence: string; figures: string[]; closest: string | null }[];
  missingJa: { id: string; entityLabel: string; text: string; pending: boolean; review: string | null }[];
  headerGaps: string[];
  answers: { question: string; limit: number | null; unit: "chars" | "words"; text: string; check: { used: number; unit: string; limit: number | null; over: boolean; underFilled: boolean; warnings: string[]; flags: { figures: string[]; sentence: string }[] } }[];
};

export type TrackerRow = { num: number; date: string; company: string; role: string; score: string; status: string; pdf: string; report: string; notes: string; url: string };
export type PipelineItem = { line: number; section: string; state: string; url: string; company: string; role: string; location: string; posted: string; note: string; extra: string };

export type ActionResult = { ok: boolean; message?: string; error?: string; data?: unknown };
