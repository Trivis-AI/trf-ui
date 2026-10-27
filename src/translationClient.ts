import { DEFAULT_SUGGESTIONS_URL, DEFAULT_TRANSLATIONS_URL } from "./config";

type TranslationEntry = Record<string, string>;

type TranslationsResponse = {
  translations?: Array<{ key: string } & TranslationEntry>;
};

// The language a user sees until they pick one, by their organisation's country: the org
// token's o.c, an ISO code. Organisations created before backlogin normalised the field
// may still carry the English name.
const COUNTRY_LANGUAGES: Record<string, string> = {
  EE: "ee", ESTONIA: "ee",
  LV: "lv", LATVIA: "lv",
  LT: "lt", LITHUANIA: "lt",
  ES: "es", SPAIN: "es",
  FR: "fr", FRANCE: "fr",
  IT: "it", ITALY: "it",
  SE: "sv", SWEDEN: "sv",
  NO: "nb", NORWAY: "nb",
  DK: "da", DENMARK: "da",
  FI: "fi", FINLAND: "fi"
};

function orgLanguage(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    return COUNTRY_LANGUAGES[String(claims?.o?.c ?? "").trim().toUpperCase()] ?? null;
  } catch {
    return null;
  }
}

export class TranslationClient {
  private map: Map<string, TranslationEntry> = new Map();
  private loaded = false;
  private lang: string;
  private suggested: Set<string> = new Set();
  private loadPromise: Promise<void> | null = null;
  // Languages already in the map. Only the one in use is downloaded (with English, the
  // fallback); another is fetched when the user switches to it.
  private fetched: Set<string> = new Set();

  private static readonly LANG_KEY = "trf:lang";

  constructor(lang: string = "en") {
    const cookie = this.readLangCookie();
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(TranslationClient.LANG_KEY) : null;
    this.lang = cookie ?? stored ?? lang;
    // Nobody picked a language yet: the first org token decides, by the organisation's
    // country. @trf/ui2 announces each token as trf:org-token; the token lives in that
    // package's per-tab cache and is minted after the page loads, so it is not readable here.
    if (!cookie && !stored && typeof window !== "undefined") {
      window.addEventListener("trf:org-token", this.onOrgToken);
    }
  }

  // The organisation's language is kept the way a pick is (setLang), so every other app and
  // tab opens in it at once instead of in English until its own token arrives.
  private onOrgToken = (e: Event): void => {
    const lang = orgLanguage((e as CustomEvent<{ token?: string }>).detail?.token);
    if (!lang) return;
    window.removeEventListener("trf:org-token", this.onOrgToken);
    this.setLang(lang);
  };

  private readLangCookie(): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(/(?:^|;)\s*lang=([^;]+)/);
    return match ? match[1].trim() : null;
  }

  load(): Promise<void> {
    if (this.loaded) {
      return Promise.resolve();
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }
    this.loadPromise = this._doLoad();
    return this.loadPromise;
  }

  private async _doLoad(): Promise<void> {
    if (!(await this.fetchLang(this.lang))) {
      return;
    }
    this.loaded = true;
    console.log("[trf-ui] translations loaded", {
      lang: this.lang,
      keys: this.map.size,
      sample: [...this.map.keys()].slice(0, 3)
    });
  }

  // fetchLang merges one language and English into the map. ?lang= keeps the download to
  // those two instead of every language services carries.
  private async fetchLang(lang: string): Promise<boolean> {
    try {
      const response = await fetch(`${DEFAULT_TRANSLATIONS_URL}?lang=${encodeURIComponent(lang)}`);
      if (!response.ok) {
        console.warn("[trf-ui] translations fetch failed", {
          status: response.status,
          statusText: response.statusText
        });
        return false;
      }
      const data = (await response.json()) as TranslationsResponse;
      for (const entry of data.translations ?? []) {
        const { key, ...langs } = entry;
        this.map.set(key, { ...this.map.get(key), ...langs });
      }
      this.fetched.add(lang);
      return true;
    } catch (err) {
      console.warn("[trf-ui] translations fetch error", err);
      return false;
    }
  }

  translate(key: string, defaultText: string): string {
    const entry = this.map.get(key);
    if (entry) {
      return entry[this.lang] ?? entry["en"] ?? defaultText;
    }
    this.suggest(key, defaultText);
    return defaultText;
  }

  getLang(): string {
    return this.lang;
  }

  setLang(lang: string): void {
    this.lang = lang;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TranslationClient.LANG_KEY, lang);
    }
    const apex = typeof window !== "undefined" ? window.location.hostname.split(".").slice(-2).join(".") : "trf.is";
    fetch(`https://${apex}/setlang?lang=${lang}`, { credentials: "include" }).catch(() => {});
    // The new language is not in the map yet when the page loaded another one: fetch it
    // before telling the page, so it redraws once, in the new language.
    const ready = this.loadPromise
      ? this.loadPromise.then(() => (this.fetched.has(lang) ? undefined : this.fetchLang(lang)))
      : Promise.resolve();
    void ready.then(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("trf:lang-changed", { detail: lang }));
      }
    });
  }

  dump(): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const [key, langs] of this.map) {
      result[key] = { ...langs };
    }
    return result;
  }

  private suggest(key: string, defaultText: string): void {
    // Only suggest after the translation list has loaded. Before load completes,
    // the map is empty and every key would look missing — producing false suggestions.
    if (!this.loaded) {
      return;
    }
    if (this.suggested.has(key)) {
      return;
    }
    this.suggested.add(key);

    const token = this.getJwtToken();
    if (!token) {
      return;
    }

    fetch(DEFAULT_SUGGESTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ key, en: defaultText })
    }).catch(() => {});
  }

  private getJwtToken(): string | null {
    if (typeof document === "undefined" || typeof document.cookie !== "string") {
      return null;
    }

    const chunks = document.cookie.split(";");
    for (const chunk of chunks) {
      const [rawName, ...rawValueParts] = chunk.split("=");
      const name = (rawName ?? "").trim();
      if (name !== "jwt_token") {
        continue;
      }
      const value = rawValueParts.join("=").trim();
      return value || null;
    }

    return null;
  }
}
