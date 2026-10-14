/**
 * Strings for the Form answers page: the candidate's stated answers for
 * application forms, and the answers suggested from their fills. Every key
 * here needs its twin in answers.ja.ts.
 */
const answers = {
  answers: {
    nav: "Form answers",
    eyebrow: "Fill",
    title: "Form answers",
    lead: "What Fill puts in a box your profile can't answer. Work authorization, sponsorship, salary, and demographic questions are filled only from here, never worked out from your profile.",
    saved: "Saved.",
    cleared: "Cleared.",
    accepted: "Stated. Fill uses it from the next form on.",
    dismissed: "Dismissed.",
    suggested: {
      title: "From your fills",
      lead: "What you typed or picked by hand on a form, after pressing Remember my answers on the panel. Nothing here is used until you accept it.",
      from: "On {host}",
      as: "Would be stated as",
      sensitive: "An employer reads this as your statement.",
      accept: "Accept",
      dismiss: "Dismiss",
      question: "this exact question",
    },
    auth: {
      title: "Work authorization",
      lead: "By country. A question that names a country you haven't listed stays yours; one that names no country uses the one country listed here, marked for a look.",
      country: "Country",
      work: "Authorized to work?",
      sponsorship: "Will need sponsorship?",
      none: "No country yet.",
      add: "Add a country",
      countryHint: "United States, Japan, …",
      plain: "Stated for no country in particular: {value}. Clear it to state answers per country.",
      blank: "—",
      yes: "Yes",
      no: "No",
    },
    sensitive: { title: "Salary and demographics", lead: "Optional. Left empty, these stay yours on every form. \"Decline to self-identify\" is an answer too." },
    other: { title: "Everything else", lead: "Stated here, an answer wins over your profile. Empty, Fill uses what the profile says (shown in grey)." },
    questions: {
      title: "Questions, in their exact wording",
      lead: "A question a form asks in exactly these words gets this answer, before anything else is tried.",
      none: "None yet.",
      q: "Question",
      a: "Answer",
      add: "Add",
    },
    fromProfile: "Profile: {value}",
    clear: "Clear",
    keys: {
      "name.preferred": "Preferred name", "name.full": "Full name", "name.given": "First name", "name.family": "Last name",
      pronouns: "Pronouns", email: "Email", phone: "Phone", location: "Location",
      "link.linkedin": "LinkedIn", "link.github": "GitHub", "link.portfolio": "Website",
      school: "School", degree: "Degree", major: "Major", gpa: "GPA (cumulative)", "grad.date": "Graduation",
      "work.company": "Current company", "work.title": "Current title", "start.date": "Earliest start", "heard.from": "How you heard about the job",
      "auth.work": "Authorized to work", "auth.sponsorship": "Needs sponsorship", salary: "Salary expectation",
      "eeo.gender": "Gender", "eeo.race": "Race or ethnicity", "eeo.hispanic": "Hispanic or Latino", "eeo.veteran": "Veteran status", "eeo.disability": "Disability status",
    },
    hints: { decline: "Decline to self-identify" },
  },
};

export default answers;
