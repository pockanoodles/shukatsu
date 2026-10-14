/**
 * The answer keys an application form asks for, and how a form field is
 * recognised as one of them.
 *
 * A field is matched by the strongest signal it carries, in this order:
 *   vendor        the ATS's own field name (platforms/ `fill.fields`): exact
 *   autocomplete  the HTML autocomplete token the site set: exact
 *   label         the field's accessible name against the patterns below
 *   name          the input's name or id against the same patterns, weaker
 * A key only lands in a field of a kind it fits (an email never goes into a
 * file input, a resume never into a text box).
 *
 * `sensitive` keys (work authorization, sponsorship, salary, demographics,
 * consent) are answered only from what the candidate has said in so many
 * words (data/form-answers.yml), never worked out from the profile: a
 * student on CPT is authorized for a co-op and not listed as authorized in
 * the country, and a guess either way is a false statement to an employer.
 */

const TEXT = ['text', 'email', 'tel', 'url', 'textarea', 'number', 'search', 'combobox'];
const CHOICE = ['select', 'radio', 'combobox', 'checkbox'];
const ANY = [...TEXT, ...CHOICE, 'date', 'month'];

export const KEYS = {
  // Checked in this order, so a narrower question comes before the one it contains ("preferred first name" before "first name").
  'name.preferred': { kinds: TEXT, label: [/\b(preferred|chosen|nick) ?(first )?name\b/, /^preferred\b/] },
  'name.full': { kinds: TEXT, label: [/^(full |legal |your )?name\b(?!.*(company|school|employer|reference|manager|preferred|first|last|family|given))/, /^full name/], auto: ['name'] },
  'name.given': { kinds: TEXT, label: [/\b(first|given) name\b/, /^first\b/, /\bforename\b/], auto: ['given-name'] },
  'name.family': { kinds: TEXT, label: [/\b(last|family|sur) ?name\b/, /^last\b/], auto: ['family-name'] },
  pronouns: { kinds: [...TEXT, ...CHOICE], label: [/\bpronouns?\b/] },
  email: { kinds: TEXT, label: [/\be-?mail\b/], auto: ['email'] },
  phone: { kinds: TEXT, label: [/\b(phone|mobile|cell|telephone)\b/], auto: ['tel', 'tel-national'] },
  location: { kinds: [...TEXT, 'select'], label: [/^(current )?location\b/, /\bwhere are you (currently )?(located|based)\b/, /^(city|city, state)\b/], auto: ['address-level2'] },
  'link.linkedin': { kinds: TEXT, label: [/\blinked ?in\b/] },
  'link.github': { kinds: TEXT, label: [/\bgit ?hub\b/] },
  'link.portfolio': { kinds: TEXT, label: [/\b(portfolio|personal (web)?site|website)\b/], auto: ['url'] },
  'school': { kinds: [...TEXT, 'select'], label: [/\b(school|university|college|institution)\b(?!.*(year|graduat|gpa|degree|major))/] },
  'degree': { kinds: [...TEXT, 'select'], label: [/^degree\b/, /\bdegree (type|level|pursuing)\b/] },
  'major': { kinds: [...TEXT, 'select'], label: [/\b(major|discipline|field of study|area of study|concentration)\b/] },
  'gpa': { kinds: TEXT, label: [/\bgpa\b/, /\bgrade point\b/] },
  'grad.date': { kinds: [...TEXT, 'select', 'date', 'month'], label: [/\b(expected )?graduation (date|year|month)\b/, /\bwhen (do|will) you graduate\b/, /^graduation\b/] },
  'work.company': { kinds: TEXT, label: [/\bcurrent (company|employer)\b/, /^(company|employer|organization)$/], auto: ['organization'] },
  'work.title': { kinds: TEXT, label: [/\bcurrent (job )?title\b/, /^(job )?title$/], auto: ['organization-title'] },
  'start.date': { kinds: [...TEXT, 'select', 'date'], label: [/\b(earliest )?start date\b/, /\bwhen (can|could) you start\b/, /\bavailab(le|ility) to start\b/] },
  'heard.from': { kinds: [...TEXT, ...CHOICE], label: [/\bhow did you (hear|learn|find out) about\b/, /\b(referral )?source\b/] },
  'auth.work': { kinds: CHOICE.concat(TEXT), sensitive: true, label: [/\b(legally )?authori[sz]ed to work\b/, /\bwork authori[sz]ation\b/, /\beligib(le|ility) to work\b/, /\bright to work\b/] },
  'auth.sponsorship': { kinds: CHOICE.concat(TEXT), sensitive: true, label: [/\bsponsor(ship)?\b/, /\bvisa\b/, /\bimmigration (status|support)\b/] },
  'salary': { kinds: [...TEXT, 'select'], sensitive: true, label: [/\b(salary|compensation|pay|hourly rate|wage)\b/] },
  'eeo.gender': { kinds: CHOICE.concat(TEXT), sensitive: true, label: [/^gender\b/, /\bgender identity\b/, /^sex\b/] },
  'eeo.race': { kinds: CHOICE.concat(TEXT), sensitive: true, label: [/\b(race|ethnicity)\b/] },
  'eeo.hispanic': { kinds: CHOICE, sensitive: true, label: [/\bhispanic\b|\blatin[oax]\b/] },
  'eeo.veteran': { kinds: CHOICE, sensitive: true, label: [/\bveteran\b/, /\bmilitary\b/] },
  'eeo.disability': { kinds: CHOICE, sensitive: true, label: [/\bdisabilit(y|ies)\b/] },
  'consent': { kinds: ['checkbox'], sensitive: true, label: [/\b(i agree|i consent|i acknowledge|i certify|i confirm|privacy (policy|notice)|terms)\b/] },
  'file.resume': { kinds: ['file'], label: [/\b(resume|résumé|cv|curriculum vitae)\b/] },
  'file.cover': { kinds: ['file'], label: [/\bcover letter\b/] },
  'text.cover': { kinds: ['textarea'], label: [/\bcover letter\b/] },
};

export const isSensitive = (key) => Boolean(KEYS[key]?.sensitive);
export const fits = (key, kind) => Boolean(KEYS[key]) && (KEYS[key].kinds || ANY).includes(kind);

/** Lowercase, accents and punctuation folded, required-marks and spacing gone: the form a label is matched in. */
export const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[*✱]+/g, ' ').replace(/\(required\)|\(optional\)/g, ' ').replace(/[^\p{L}\p{N}?]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** A name or id split into words: "urls[LinkedIn]" -> "urls linkedin", "firstName" -> "first name". */
const words = (s) => norm(String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-[\].]+/g, ' '));

/**
 * The key a field most likely asks for: { key, by, confidence } or null.
 * `vendor` is the ATS's platforms/ fill entry, when the form is on one.
 */
export function identify(field, vendor = null) {
  const kind = field.kind;
  for (const id of [field.name, field.id].filter(Boolean)) {
    const key = vendor?.fields?.[id];
    if (key && fits(key, kind)) return { key, by: 'vendor', confidence: 1 };
  }
  const auto = String(field.autocomplete || '').toLowerCase().split(/\s+/).pop();
  if (auto && auto !== 'on' && auto !== 'off') {
    const key = Object.keys(KEYS).find((k) => KEYS[k].auto?.includes(auto));
    if (key && fits(key, kind)) return { key, by: 'autocomplete', confidence: 0.95 };
  }
  const tried = [[norm(field.label), 'label', 0.8], [words(field.name || field.id), 'name', 0.6], [norm(field.placeholder), 'placeholder', 0.55]];
  for (const [text, by, confidence] of tried) {
    if (!text) continue;
    const key = Object.keys(KEYS).find((k) => fits(k, kind) && KEYS[k].label.some((re) => re.test(text)));
    if (key) return { key, by, confidence };
  }
  return null;
}
