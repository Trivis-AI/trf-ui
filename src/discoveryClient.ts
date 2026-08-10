import {
  DEFAULT_DISCOVERY_AUTH_COOKIE_NAME,
  DEFAULT_DISCOVERY_FETCH_CREDENTIALS,
  DEFAULT_DISCOVERY_MENU_URL
} from "./config";
import type { DiscoveryMenuConfig, MenuItem } from "./types";

type DiscoveryMenuEntry = {
  id: string;
  label: string;
  labels?: Record<string, string>;
  url?: string;
  app_key: string;
  enabled: boolean;
  order?: number;
  items?: DiscoveryMenuEntry[];
};

type DiscoveryMenuResponse = {
  menu?: DiscoveryMenuEntry[];
  base_urls?: Record<string, string>;
};

export type DiscoveryMenuClientConfig = DiscoveryMenuConfig & {
  fetchImpl?: typeof fetch;
};

type ResolvedAuthToken = {
  token?: string;
  source: "config" | "cookie" | "none";
  cookieName: string;
};

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const getCookieValue = (cookieName: string): string | undefined => {
  if (typeof document === "undefined" || typeof document.cookie !== "string") {
    return undefined;
  }

  const chunks = document.cookie.split(";");
  for (const chunk of chunks) {
    const [rawName, ...rawValueParts] = chunk.split("=");
    const name = safeDecodeURIComponent((rawName ?? "").trim());
    if (name !== cookieName) {
      continue;
    }
    const rawValue = rawValueParts.join("=").trim();
    return safeDecodeURIComponent(rawValue);
  }

  return undefined;
};

const resolveAuthToken = (config: DiscoveryMenuClientConfig): ResolvedAuthToken => {
  const explicitToken = config.authToken?.trim();
  if (explicitToken) {
    return {
      token: explicitToken,
      source: "config",
      cookieName: config.authCookieName?.trim() || DEFAULT_DISCOVERY_AUTH_COOKIE_NAME
    };
  }

  const cookieName = config.authCookieName?.trim() || DEFAULT_DISCOVERY_AUTH_COOKIE_NAME;
  const cookieToken = getCookieValue(cookieName)?.trim();
  if (!cookieToken) {
    return {
      source: "none",
      cookieName
    };
  }

  return {
    token: cookieToken,
    source: "cookie",
    cookieName
  };
};

const byOrder = (a: DiscoveryMenuEntry, b: DiscoveryMenuEntry) => {
  const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
  return aOrder - bOrder;
};

const mapMenuEntry = (entry: DiscoveryMenuEntry): MenuItem => {
  const item: MenuItem = {
    id: `discovery-${entry.id}`,
    label: entry.label,
    labels: entry.labels,
    appId: entry.app_key || undefined,
    externalUrl: entry.url,
    disabled: entry.enabled === false
  };
  if (entry.items && entry.items.length > 0) {
    item.children = entry.items.sort(byOrder).map(mapMenuEntry);
  }
  return item;
};

export type DiscoveryMenuResult = {
  items: MenuItem[];
  baseUrls: Record<string, string>;
};

export const mapDiscoveryMenuResponse = (
  response: DiscoveryMenuResponse
): DiscoveryMenuResult => {
  const entries = response.menu ?? [];

  return {
    items: entries.sort(byOrder).map(mapMenuEntry),
    baseUrls: response.base_urls ?? {}
  };
};

export const mapDiscoveryMenuToMenuItems = (
  response: DiscoveryMenuResponse
): MenuItem[] => mapDiscoveryMenuResponse(response).items;

export const fetchDiscoveryMenu = async (
  config: DiscoveryMenuClientConfig = {}
): Promise<DiscoveryMenuResult> => {
  const menuUrl = config.menuUrl ?? DEFAULT_DISCOVERY_MENU_URL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const auth = resolveAuthToken(config);

  if (!auth.token) {
    const message =
      `Discovery menu request requires authentication. ` +
      `Provide discovery.authToken or ensure "${auth.cookieName}" cookie is present.`;
    console.error("[trf-ui] discovery menu request blocked", {
      menuUrl,
      reason: "missing_auth_token",
      authCookieName: auth.cookieName
    });
    throw new Error(message);
  }

  // Used as-is rather than through `new URL()`: the menu URL is relative when no
  // apex can be derived (SSR, tests, the localhost dev proxy), and the URL
  // constructor rejects relative input. Nothing here needs a parsed URL.
  const url = menuUrl;

  const headers: Record<string, string> = {};
  headers.Authorization = `Bearer ${auth.token}`;
  if (config.ifMatch) {
    headers["If-Match"] = config.ifMatch;
  }

  const credentials = config.credentials ?? DEFAULT_DISCOVERY_FETCH_CREDENTIALS;

  console.log("[trf-ui] calling discovery menu endpoint", {
    menuUrl: url.toString(),
    authSource: auth.source,
    hasIfMatchHeader: Boolean(config.ifMatch),
    credentials
  });

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers,
    credentials
  });

  if (!response.ok) {
    console.error("[trf-ui] discovery menu request failed", {
      menuUrl: url.toString(),
      status: response.status,
      statusText: response.statusText
    });
    throw new Error(`Discovery menu request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as DiscoveryMenuResponse;
  const result = mapDiscoveryMenuResponse(data);

  console.log("[trf-ui] discovery menu retrieved", {
    menuUrl: url.toString(),
    status: response.status,
    count: result.items.length,
    baseUrlKeys: Object.keys(result.baseUrls),
    items: result.items.map((item) => ({
      id: item.id,
      label: item.label,
      externalUrl: item.externalUrl,
      disabled: Boolean(item.disabled)
    }))
  });

  return result;
};

export const fetchDiscoveryMenuItems = async (
  config: DiscoveryMenuClientConfig = {}
): Promise<MenuItem[]> => {
  const result = await fetchDiscoveryMenu(config);
  return result.items;
};
