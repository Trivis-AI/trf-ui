const removeCookie = (name: string): void => {
  // Must match the domain used when the cookie was set (the apex, e.g. .trivis.ee)
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const parts = hostname.split(".");
  const sharedDomain = parts.length >= 2 ? `.${parts.slice(-2).join(".")}` : hostname;

  const bases = [
    `expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`,
    `expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${hostname}`,
    `expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${sharedDomain}`,
  ];

  for (const attrs of bases) {
    document.cookie = `${encodeURIComponent(name)}=; ${attrs}`;
  }
};

/** CORS-enabled login API base, e.g. `crm.trivis.ee` -> `https://login-api.trivis.ee`. */
const loginApiBase = (): string => {
  const parts = window.location.hostname.split(".");
  const apex = parts.length >= 2 ? parts.slice(-2).join(".") : "trf.is";
  return `https://login-api.${apex}`;
};

/**
 * Ends the session everywhere it is held: the server-side account cookie, the JS-visible
 * cookies, and this tab's minted org tokens.
 *
 * The server round-trip is the load-bearing part. `jwt_token` is HttpOnly, so the cookie
 * sweep below cannot see it, and for as long as that was the whole of logout the account
 * session survived intact — up to its full 30-day TTL. It only looked like a logout
 * because the login page always renders a password form. Anyone returning to an app URL
 * was silently still signed in.
 */
export const logout = async (
  redirectUrl?: string,
  opts?: { apiBase?: string },
): Promise<void> => {
  if (typeof document === "undefined") return;

  try {
    await fetch(`${opts?.apiBase ?? loginApiBase()}/v1/account/logout`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
    });
  } catch {
    // Offline, or the API is down. Still shed everything reachable locally, but the
    // account cookie outlives this: logout is not complete until the server clears it.
  }

  // Remove all cookies accessible from this domain (covers the whole apex)
  for (const chunk of document.cookie.split(";")) {
    const name = decodeURIComponent((chunk.split("=")[0] ?? "").trim());
    if (name) {
      removeCookie(name);
    }
  }

  // Org tokens are not cookies — they are minted per tab into sessionStorage, so the sweep
  // above misses them and they stay valid for the rest of their hour.
  try {
    const stale = Object.keys(sessionStorage).filter((k) => k.startsWith("trf_org_jwt_"));
    for (const key of stale) {
      sessionStorage.removeItem(key);
    }
  } catch {
    /* sessionStorage unavailable (rare) */
  }

  window.dispatchEvent(new Event("trf:auth-changed"));

  const target = redirectUrl ?? (typeof window !== "undefined" ? window.location.origin : "/");
  window.location.href = target;
};
