/** Strings for the oauth pages. Merged by index.ts; every key needs its twin in oauth.ja.ts. */
const dict = {
  oauth: {
    title: "Connect an app",
    lead: "{client} is asking to use your shukatsu.",
    app: "App",
    publishedAt: "Published at",
    returnsTo: "Sends you back to",
    thisComputer: "(this computer)",
    canTitle: "What it will be able to do",
    can: "Read your record and tracker, evaluate postings, draft packets, and make suggestions.",
    cannot: "It can never confirm a fact, decide a review item, send an application, or change who has access. Those stay with you.",
    identityTitle: "Which agent identity does it get?",
    identityHelp: "Everything it does is logged under this name, and you can cut it off from the Agents page.",
    newIdentity: "Create a new identity",
    newName: "Name for the new identity",
    approve: "Allow",
    deny: "Deny",
    staleTitle: "Sign in again to continue",
    staleLead: "Giving an app access needs a sign-in from the last 10 minutes, so a forgotten browser tab can't hand out access.",
    staleSubmit: "Sign in again",
    ownerOnly: "Only the owner can give an app access. Sign in as the owner, then start the connection again from the app.",
    invalid: "This request has expired or isn't valid. Go back to the app and start the connection again.",
    err: {
      name: "Give the new identity a name.",
      stale: "Your sign-in is too old. Sign in again to continue.",
      expired: "This request expired. Start the connection again from the app.",
      owner: "Only the owner can give an app access.",
    },
  },
};

export default dict;
