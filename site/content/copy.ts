// Every string on the product page, both languages, behind one Dict, so a
// missing translation is a type error instead of English on /shukatsu/ja.
// Claims here describe what the app does today; check ../shukatsu/README.md
// and the code before adding one. Labels the app shows (the four review
// outcomes, the roles) are the app's own strings from src/lib/i18n, so the
// page and the app say the same thing.
//
// Every figure on the page belongs to a made-up example candidate and is
// labelled as an example where it appears.

export type Locale = "en" | "ja";

export type ShotId = "today" | "review" | "record" | "packet";

export type Outcome = "accept" | "correct" | "narrative" | "unsure";

export interface Row {
  id: string;
  prov: string;
  text: string;
  waiting?: boolean;
}

export interface Dict {
  meta: { title: string; description: string };
  nav: { how: string; review: string; app: string; family: string; home: string; github: string; label: string };
  hero: { label: string; statement: [string, string]; sub: string; cta: string; more: string; caption: string };
  how: {
    eyebrow: string;
    title: string;
    caption: string;
    note: string;
    cols: { n: string; fact: string; src: string; line: string; state: string };
    rows: Row[];
    confirmed: string;
    stampWaiting: [string, string];
    steps: { title: string; body: string }[];
  };
  review: {
    eyebrow: string;
    title: string;
    sub: string;
    note: string;
    proposedBy: string;
    question: string;
    figures: string;
    noteLabel: string;
    momNote: string;
    original: string;
    /** The same claim with the figures in question taken out (the "keep, no figures" outcome). */
    narrative: string;
    outcomes: Record<Outcome, { label: string; lead: string; key?: string }>;
    editLabel: string;
    correctHelp: string;
    narrativeHelp: string;
    submitEdit: string;
    submitNarrative: string;
    done: Record<Outcome, string>;
    reopen: string;
    footnote: string;
  };
  app: { eyebrow: string; title: string; note: string; shots: Record<ShotId, { tab: string; caption: string; alt: string }> };
  family: {
    eyebrow: string;
    title: string;
    body: string;
    roles: [string, string][];
    digestCaption: string;
    digestNote: string;
    digestFoot: string;
  };
  japanese: {
    eyebrow: string;
    title: string;
    body: string;
    points: string[];
    es: { caption: string; note: string; question: string; limit: number; unit: string; norm: string; over: string; under: string; ok: string };
  };
  home: { eyebrow: string; title: string; body: string; points: string[]; guide: string };
  open: { eyebrow: string; title: string; body: string; cta: string; by: string; more: string };
  footer: { rights: string; license: string; source: string; setup: string; portfolio: string; product: string; maker: string };
  menu: { menu: string; close: string; items: { href: string; label: string }[] };
  lang: { href: string; label: string; code: Locale };
}

// The weekly digest as a parent reads it: Japanese in both languages, because
// that is the point. Same example as the app's own landing page.
export const DIGEST_JA = `就活レポート 10/5〜10/12

応募：2件
  Example Co · Operations Intern
  Sample Labs · Data Analyst Co-op

進捗
  Demo Inc · BizOps Intern: 応募済み → 面接

進行中：9件中4件
本人の確認待ち：1件
確認キュー：6件（うち提案2件）
評価待ちの求人：12件`;

// An example entry-sheet answer, counted live on the page.
export const ES_ANSWER =
  "学生時代に最も力を入れたのは、サークルの新入生勧誘の仕組みを作り直したことです。以前は先輩が個別に連絡していたため、返信の漏れが多く、説明会への参加は毎年20人ほどでした。そこで問い合わせを一つの表にまとめ、担当を週ごとに決めて、全員が状況を見られるようにしました。その結果、参加者は45人に増え、引き継ぎの負担も減りました。";

const en: Dict = {
  meta: {
    title: "Shukatsu: every resume, traced to a fact",
    description:
      "Shukatsu keeps one record of everything you have done, and every resume is a selection from it. Family and mentors can help write, but nothing counts until you stamp it.",
  },
  nav: { how: "How it works", review: "Review", app: "The app", family: "Family", home: "At home", github: "GitHub", label: "Shukatsu" },
  hero: {
    label: "For students, and the people behind them",
    statement: ["Every resume, traced", "to a fact."],
    sub: "Shukatsu keeps one record of everything you have done, and every resume is a selection from it. Family and mentors can help write, but nothing counts until you stamp it.",
    cta: "Run it at home",
    more: "or see how it works",
    caption: "就職活動 · Job hunting",
  },
  how: {
    eyebrow: "How it works",
    title: "Every resume is a selection from one record.",
    caption: "A resume, line by line",
    note: "Example",
    cols: { n: "#", fact: "Fact", src: "Src", line: "On the resume", state: "State" },
    rows: [
      { id: "acme.routing", prov: "U", text: "Rebuilt lead routing for a 6-person team, cutting manual triage from 40 to 5 minutes a day across 1,200 weekly leads." },
      { id: "tool.speed", prov: "V", text: "Built an open-source CLI that cuts a 45 minute report build to 13 seconds with a two-layer cache, used by 30 people." },
      { id: "acme.dashboard", prov: "M", text: "Built a pipeline dashboard tracking 14 KPIs that the ops lead reviewed every Monday with 3 regional managers.", waiting: true },
    ],
    confirmed: "Confirmed",
    stampWaiting: ["確認", "待ち"],
    steps: [
      { title: "One record", body: "Every achievement lives once, with its evidence and the place it came from." },
      { title: "A selection per posting", body: "Shukatsu picks the facts that fit a posting, and each bullet names the fact it states." },
      { title: "Figures don't move", body: "You can reword any bullet, but a number changes only when you restate it yourself." },
    ],
  },
  review: {
    eyebrow: "Review",
    title: "Nothing counts until you stamp it.",
    sub: "Drafts and suggestions wait in one queue, and only you can decide each one.",
    note: "Example",
    proposedBy: "Proposed by Mom",
    question: "Mom suggests adding this.",
    figures: "2 figures. What's right?",
    noteLabel: "Mom's note",
    momNote: "You showed us this dashboard over New Year's. I think it tracked 14 things?",
    original: "Built a pipeline dashboard tracking 14 KPIs that the ops lead reviewed every Monday with 3 regional managers.",
    narrative: "Built a pipeline dashboard that the ops lead reviewed every Monday with the regional managers.",
    outcomes: {
      accept: { label: "Confirm", lead: "True as written. Stamps it.", key: "A" },
      correct: { label: "Correct a figure", lead: "Edit it. You become the source.", key: "E" },
      narrative: { label: "Keep, no figures", lead: "True, but not as a number claim." },
      unsure: { label: "I don't know", lead: "Kept out of every resume, for good.", key: "U" },
    },
    editLabel: "Wording",
    correctHelp: "Change the figure to what's true. It's recorded as stated by you, today.",
    narrativeHelp: "Rewrite it without the figures in question.",
    submitEdit: "Confirm this wording",
    submitNarrative: "Keep without figures",
    done: {
      accept: "Stamped, so this line can now appear on a resume.",
      correct: "Corrected and stamped, with you recorded as the source of the new figure.",
      narrative: "Kept without figures, so the line makes no number claim.",
      unsure: "Marked unsure, so this line stays out of every resume and the guess never becomes a fact.",
    },
    reopen: "Put back in the queue",
    footnote: "In the app, every decision is a commit that records who proposed it and who decided.",
  },
  app: {
    eyebrow: "The app",
    title: "Every screen is a page of the same ledger.",
    note: "Example data",
    shots: {
      today: { tab: "Today", caption: "Today shows how many things wait for your stamp and what the people helping you did.", alt: "The Today screen, with six items waiting for the candidate's stamp, counts of packets and applications, and what Mom and Mentor did recently." },
      review: { tab: "Review", caption: "Review puts one waiting item on screen with its figures marked and the four ways to answer.", alt: "The Review screen with Mom's proposed line selected, its figures 2 and 3 marked, the four answers below it, and a comment from Mentor." },
      record: { tab: "Record", caption: "The record lists every fact as a ledger row, with its source and its state.", alt: "The Record screen, with every fact as one ledger row, its figures marked, a confirmed Japanese wording, and one row still waiting for the stamp." },
      packet: { tab: "Packet", caption: "A packet holds one application, here a 職務経歴書 Mom prepared, with every line traced to a confirmed fact.", alt: "A Japanese application packet Mom prepared, which passes every check, lists its 職務経歴書 lines, and waits for the candidate's approval." },
    },
  },
  family: {
    eyebrow: "For family and mentors",
    title: "The phone calls become a review queue.",
    body: "Parents far away can find postings, prepare a whole application and suggest edits in Japanese, and you review all of it in one place.",
    roles: [
      ["Editor", "Prepares applications, suggests facts and rewordings, and finds postings."],
      ["Reviewer", "Reads everything shared, comments, and suggests postings."],
      ["Viewer", "Follows the applications and the weekly digest."],
    ],
    digestCaption: "The weekly digest, as a parent reads it",
    digestNote: "Example",
    digestFoot: "It comes as copy-ready text for LINE or email, in Japanese or English.",
  },
  japanese: {
    eyebrow: "Japanese applications",
    title: "Japanese applications get the same checks.",
    body: "A 職務経歴書 is built from each fact's confirmed Japanese, so a reworded line is still held to what you confirmed.",
    points: [
      "Written answers are counted the way forms count them, and held to the limit and to the 80% fill norm.",
      "Japanese lines keep one politeness register and pass their own style check.",
      "A fact without confirmed Japanese links to its review item, which is where a parent who writes Japanese helps most.",
    ],
    es: {
      caption: "An entry-sheet answer, counted",
      note: "Example · try editing it",
      question: "学生時代に力を入れたことは何ですか。（200字以内）",
      limit: 200,
      unit: "chars",
      norm: "80%",
      over: "Over the limit",
      under: "Under 80%",
      ok: "Within the norm",
    },
  },
  home: {
    eyebrow: "Yours, at home",
    title: "It runs on a small computer you own.",
    body: "An old Mac mini or a small PC at home serves Shukatsu to the people you invite through a private tunnel, and your record stays in a git repo on that machine.",
    points: [
      "There is no public sign-up, because the first account is made on the machine itself and everyone else needs your invite.",
      "Anyone who would rather not remember a password can sign in with a passkey such as Face ID or Touch ID.",
      "Each confirmed change is a commit that records who proposed it and who decided.",
      "Nothing leaves the machine unless you turn on AI wordings, which send one bullet and the posting and log every call.",
    ],
    guide: "Read the setup guide",
  },
  open: {
    eyebrow: "Open source",
    title: "Shukatsu is free and open source.",
    body: "It is a fork of career-ops by santifer (MIT) that adds the review queue, the checks and an app your family can use. It never submits an application, so you always press the last button.",
    cta: "View the source on GitHub",
    by: "Made by Kaito Soeno.",
    more: "See more of my work",
  },
  footer: { rights: "© 2026 Kaito Soeno", license: "MIT License", source: "Source", setup: "Run it at home", portfolio: "Portfolio", product: "Shukatsu", maker: "Kaito Soeno" },
  menu: {
    menu: "Menu",
    close: "Close",
    items: [
      { href: "/", label: "Contact" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/experience", label: "Experience" },
      { href: "/about", label: "About" },
    ],
  },
  lang: { href: "/shukatsu/ja/", label: "日本語", code: "ja" },
};

const ja: Dict = {
  meta: {
    title: "Shukatsu｜すべての書類を、事実にひもづける",
    description:
      "Shukatsu はこれまでの実績をひとつの記録にまとめ、書類はすべてそこから選びます。家族やメンターも書類づくりを手伝えますが、本人が判を押すまで何も確定しません。",
  },
  nav: { how: "しくみ", review: "レビュー", app: "アプリ", family: "家族", home: "自宅で", github: "GitHub", label: "Shukatsu" },
  hero: {
    label: "就活する人と、それを支える人のために",
    statement: ["すべての書類を、", "事実にひもづける。"],
    sub: "これまでの実績をひとつの記録にまとめ、書類はすべてそこから選びます。家族やメンターも書類づくりを手伝えますが、本人が判を押すまで何も確定しません。",
    cta: "自宅で動かす",
    more: "しくみを見る",
    caption: "就職活動 · Shukatsu",
  },
  how: {
    eyebrow: "しくみ",
    title: "書類はすべて、ひとつの記録から選ばれる。",
    caption: "職務経歴書を一行ずつ",
    note: "サンプル",
    cols: { n: "#", fact: "実績", src: "根拠", line: "書類の記載", state: "状態" },
    rows: [
      { id: "acme.routing", prov: "U", text: "6人のチームのリード振り分けを作り直し、週1,200件のリードの手作業の仕分けを1日40分から5分に短縮。" },
      { id: "tool.speed", prov: "V", text: "2層キャッシュを備えたオープンソースのCLIを開発し、45分かかっていたレポート作成を13秒に短縮。30人が利用。" },
      { id: "acme.dashboard", prov: "M", text: "14のKPIを追うパイプラインのダッシュボードを構築し、運用リードが毎週月曜に3人の地域マネージャーと確認。", waiting: true },
    ],
    confirmed: "確認済み",
    stampWaiting: ["確認", "待ち"],
    steps: [
      { title: "記録はひとつ", body: "実績は、根拠と出どころとともに一か所にだけ保存されます。" },
      { title: "求人ごとに選ぶ", body: "求人に合う実績を選び、箇条書きの一行一行が元の実績を指します。" },
      { title: "数字は動かない", body: "表現は自由に変えられますが、数字が変わるのは本人が申告し直したときだけです。" },
    ],
  },
  review: {
    eyebrow: "レビュー",
    title: "判を押すまで、何も確定しない。",
    sub: "下書きも提案もひとつのキューで待ち、決められるのは本人だけです。",
    note: "サンプル",
    proposedBy: "提案：母",
    question: "母から実績の追加提案です。",
    figures: "数字が2つあります。正しいのはどれですか？",
    noteLabel: "母のメモ",
    momNote: "お正月に見せてくれたダッシュボードのこと。たしか14項目だったと思う。",
    original: "14のKPIを追うパイプラインのダッシュボードを構築し、運用リードが毎週月曜に3人の地域マネージャーと確認。",
    narrative: "パイプラインのダッシュボードを構築し、運用リードが毎週月曜に地域マネージャーと確認。",
    outcomes: {
      accept: { label: "確認する", lead: "記載どおり正確です。判を押します。", key: "A" },
      correct: { label: "数字を直す", lead: "直すと、本人の申告が出典になります。", key: "E" },
      narrative: { label: "数字なしで残す", lead: "内容は正しいが、数字は主張しない。" },
      unsure: { label: "わからない", lead: "どの書類にも使いません。", key: "U" },
    },
    editLabel: "表現",
    correctHelp: "正しい数字に直してください。今日、本人が申告したものとして記録されます。",
    narrativeHelp: "該当する数字を外して書き直してください。",
    submitEdit: "この表現で確認",
    submitNarrative: "数字なしで残す",
    done: {
      accept: "判を押しました。この行は書類に載せられます。",
      correct: "数字を直して判を押しました。新しい数字の出典は本人の申告として記録されます。",
      narrative: "数字なしで残しました。この行は数字を主張しません。",
      unsure: "「わからない」にしました。この行はどの書類にも使わず、推測が事実になることはありません。",
    },
    reopen: "キューに戻す",
    footnote: "アプリでは、すべての決定が、誰が提案し誰が決めたかとともにコミットとして記録されます。",
  },
  app: {
    eyebrow: "アプリ",
    title: "どの画面も、同じ台帳の一ページです。",
    note: "サンプルデータ",
    shots: {
      today: { tab: "今日", caption: "本人の判を待っている件数と、手伝ってくれている人たちの最近の動きがわかります。", alt: "今日の画面。本人の確認を待つ6件、応募書類と応募の件数、Mom と Mentor の最近の動きが並んでいる。" },
      review: { tab: "レビュー", caption: "待っている項目をひとつずつ、数字に印をつけて、4つの答え方とともに表示します。", alt: "レビュー画面。Mom が提案した行が選ばれ、数字の2と3に印がつき、4つの答え方と Mentor のコメントが見える。" },
      record: { tab: "記録", caption: "すべての実績を、出典と状態つきの台帳の行として並べます。", alt: "記録の画面。実績が1行ずつ並び、数字に印がつき、確認済みの日本語と、確認待ちの印がついた行が見える。" },
      packet: { tab: "応募書類", caption: "ひとつの応募をまとめた画面です。母が用意した職務経歴書の一行一行が、確認済みの実績にひもづいています。", alt: "Mom が用意した日本語の応募書類。すべてのチェックに合格し、職務経歴書の行が並び、本人の承認を待っている。" },
    },
  },
  family: {
    eyebrow: "家族とメンターのために",
    title: "毎日の電話が、確認キューになる。",
    body: "遠くに住む親も、求人を探し、応募書類を最初から最後まで準備し、日本語で修正を提案できます。本人はそれをひとつの場所で確認します。",
    roles: [
      ["編集者", "書類を準備し、実績や言い換えを提案し、求人を探します。"],
      ["レビュアー", "共有された内容を読み、コメントし、求人を提案します。"],
      ["閲覧者", "応募状況と週報を見守ります。"],
    ],
    digestCaption: "親が読む週報",
    digestNote: "サンプル",
    digestFoot: "LINE やメールにそのまま貼れるテキストで、日本語でも英語でも用意できます。",
  },
  japanese: {
    eyebrow: "日本語の応募書類",
    title: "日本語の書類にも、英語と同じチェックを。",
    body: "職務経歴書は各実績の確認済みの日本語から作られるので、言い換えた行も、本人が確認した内容に照らしてチェックされます。",
    points: [
      "ES の回答はフォームと同じ数え方で文字数を数え、字数制限と8割の目安に照らします。",
      "日本語の行は敬語のレベルをひとつにそろえ、専用の表現チェックを通します。",
      "確認済みの日本語がない実績はレビュー項目にリンクされ、日本語を書ける親がいちばん力になれる場所になります。",
    ],
    es: {
      caption: "ES の回答を数える",
      note: "サンプル · 編集できます",
      question: "学生時代に力を入れたことは何ですか。（200字以内）",
      limit: 200,
      unit: "字",
      norm: "8割",
      over: "字数オーバー",
      under: "8割未満",
      ok: "目安の範囲内",
    },
  },
  home: {
    eyebrow: "自宅で、自分のものとして",
    title: "手元の小さなコンピューターで動く。",
    body: "古い Mac mini や小型 PC を自宅に置けば、招待した人だけにプライベートなトンネル経由で届けられ、記録はそのマシンの git リポジトリに残ります。",
    points: [
      "公開の登録ページはなく、最初のアカウントはマシン上で作り、ほかの人は招待リンクで参加します。",
      "パスワードを覚えたくない人は、Face ID や Touch ID などのパスキーでログインできます。",
      "確定した変更はすべて、誰が提案し誰が決めたかとともにコミットされます。",
      "AI の表現候補をオンにしない限り外部には何も送られず、オンにしても送るのは箇条書き1行と求人だけで、すべての呼び出しが記録されます。",
    ],
    guide: "セットアップの手順を読む",
  },
  open: {
    eyebrow: "オープンソース",
    title: "Shukatsu は無料のオープンソースです。",
    body: "santifer による career-ops（MIT）のフォークで、レビューの仕組み、チェック、家族が使えるアプリを加えています。応募を代わりに送信することはなく、最後のボタンはいつも本人が押します。",
    cta: "GitHub でソースを見る",
    by: "制作は Kaito Soeno です。",
    more: "ほかの作品を見る",
  },
  footer: { rights: "© 2026 Kaito Soeno", license: "MIT License", source: "ソース", setup: "自宅で動かす", portfolio: "作品", product: "Shukatsu", maker: "Kaito Soeno" },
  menu: {
    menu: "メニュー",
    close: "閉じる",
    items: [
      { href: "/ja", label: "お問い合わせ" },
      { href: "/ja/portfolio", label: "作品" },
      { href: "/ja/experience", label: "経歴" },
      { href: "/ja/about", label: "プロフィール" },
    ],
  },
  lang: { href: "/shukatsu/", label: "English", code: "en" },
};

export const copy: Record<Locale, Dict> = { en, ja };
