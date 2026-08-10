// Base URL of trfservices, derived from the current hostname so one bundle
// serves both clusters. Never hardcode an apex here: this package is pinned by
// every frontend, so a literal domain sends one cluster's users to the other.
//
// Off-apex hosts (localhost dev, bare IPs) go through the `/proxy/services-api`
// dev proxy that each consuming frontend defines in its vite.config.ts.
function servicesApiBase(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.hostname.split(".");
  if (parts.length < 2) return "/proxy/services-api";
  return `https://services-api.${parts.slice(-2).join(".")}`;
}

const BASE = servicesApiBase();

export const DEFAULT_DISCOVERY_MENU_URL = `${BASE}/v1/discovery/menu`;

export const DEFAULT_DISCOVERY_MENU_GROUP = "default";

export const DEFAULT_DISCOVERY_AUTH_COOKIE_NAME = "jwt_token";

export const DEFAULT_DISCOVERY_FETCH_CREDENTIALS: RequestCredentials = "include";

export const DEFAULT_TRANSLATIONS_URL = `${BASE}/v1/translations`;
export const DEFAULT_SUGGESTIONS_URL = `${BASE}/v1/translations/suggestions`;
