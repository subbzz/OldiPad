/* Google keys. Leave these empty in git: the publish workflow fills them in from
 * the repository secrets YT_API_KEY, YT_CLIENT_ID and YT_CLIENT_SECRET (see README).
 * To test on the Mac, fill them in locally and don't commit the change. */
var YT_CONFIG = {
  // API key restricted to HTTP referrer https://<you>.github.io/* and to YouTube Data API v3.
  apiKey: "",
  // OAuth client of type "TVs and Limited Input devices" (for Google sign-in).
  clientId: "",
  clientSecret: "",
  // Country for search results and Live videos (two-letter code).
  region: "AU",
};
