import assert from "node:assert/strict";
import test from "node:test";
import { TranslationClient } from "../src/translationClient";

const MOCK_TRANSLATIONS = {
  translations: [
    { key: "<trn-create-organization>", en: "Create organization", ee: "Loo organisatsioon" },
    { key: "<trn-save>", en: "Save", ee: "Salvesta" },
    { key: "<trn-en-only>", en: "English only" }
  ]
};

function withFetch(impl: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function withDocumentCookie(cookie: string, fn: () => void) {
  const original = (globalThis as { document?: unknown }).document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: { cookie }
  });
  try {
    fn();
  } finally {
    if (typeof original === "undefined") {
      delete (globalThis as { document?: unknown }).document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        writable: true,
        value: original
      });
    }
  }
}

function makeFetchOk(body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
}

test("load() populates map from fetch response", async () => {
  const client = new TranslationClient("ee");
  await withFetch(makeFetchOk(MOCK_TRANSLATIONS), async () => {
    await client.load();
  });
  assert.equal(client.translate("<trn-create-organization>", "Create organization"), "Loo organisatsioon");
});

test("load() is idempotent — second call is a no-op", async () => {
  let fetchCallCount = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCallCount++;
    return new Response(JSON.stringify(MOCK_TRANSLATIONS), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new TranslationClient("ee");
  await withFetch(fetchImpl, async () => {
    await client.load();
    await client.load();
  });

  assert.equal(fetchCallCount, 1);
});

test("translate() returns correct lang text when key exists", async () => {
  const client = new TranslationClient("ee");
  await withFetch(makeFetchOk(MOCK_TRANSLATIONS), async () => {
    await client.load();
  });
  assert.equal(client.translate("<trn-save>", "Save"), "Salvesta");
});

test("translate() falls back to 'en' when requested lang is missing", async () => {
  const client = new TranslationClient("fi");
  await withFetch(makeFetchOk(MOCK_TRANSLATIONS), async () => {
    await client.load();
  });
  assert.equal(client.translate("<trn-en-only>", "English only"), "English only");
});

test("translate() returns defaultText when key is missing", async () => {
  const client = new TranslationClient("ee");
  await withFetch(makeFetchOk(MOCK_TRANSLATIONS), async () => {
    await client.load();
  });
  withDocumentCookie("", () => {
    assert.equal(client.translate("<trn-unknown>", "Unknown label"), "Unknown label");
  });
});

test("suggest() deduplicates — only one POST per unique missing key", async () => {
  let postCount = 0;
  const originalFetch = globalThis.fetch;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") {
      postCount++;
    }
    return new Response(JSON.stringify(MOCK_TRANSLATIONS), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  globalThis.fetch = fetchImpl;
  try {
    const client = new TranslationClient("ee");
    await client.load();

    withDocumentCookie("jwt_token=test-token", () => {
      // Call translate three times with the same missing key
      client.translate("<trn-dedup>", "Missing");
      client.translate("<trn-dedup>", "Missing");
      client.translate("<trn-dedup>", "Missing");
    });

    // Wait for fire-and-forget POSTs to settle
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(postCount, 1);
});

test("suggest() skips silently when no jwt_token cookie", async () => {
  let postCount = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") {
      postCount++;
    }
    return new Response(JSON.stringify(MOCK_TRANSLATIONS), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new TranslationClient("ee");
  await withFetch(fetchImpl, async () => {
    await client.load();
  });

  withDocumentCookie("other_cookie=abc", () => {
    client.translate("<trn-missing-no-auth>", "Missing no auth");
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(postCount, 0);
});

test("suggest() skips silently in SSR (no document)", async () => {
  let postCount = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") {
      postCount++;
    }
    return new Response(JSON.stringify(MOCK_TRANSLATIONS), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new TranslationClient("ee");
  await withFetch(fetchImpl, async () => {
    await client.load();
  });

  const originalDocument = (globalThis as { document?: unknown }).document;
  delete (globalThis as { document?: unknown }).document;
  try {
    client.translate("<trn-ssr-missing>", "SSR missing");
  } finally {
    if (typeof originalDocument !== "undefined") {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        writable: true,
        value: originalDocument
      });
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(postCount, 0);
});

test("load() survives network failure without throwing", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("network failure");
  };

  const client = new TranslationClient("en");
  await withFetch(fetchImpl, async () => {
    await assert.doesNotReject(() => client.load());
  });

  // translate still works, returns defaultText
  assert.equal(client.translate("<trn-any>", "Fallback"), "Fallback");
});

// One response per ?lang=, the way services narrows each key to that language and English.
function makeFetchByLang(calls: string[]): typeof fetch {
  return async (input) => {
    const url = String(input);
    calls.push(url);
    const lang = new URL(url, "https://services-api.trf.is").searchParams.get("lang");
    const translations = MOCK_TRANSLATIONS.translations.map(({ key, en, ...rest }) => {
      const row: Record<string, string> = { key, en };
      const text = (rest as Record<string, string>)[lang ?? ""];
      if (text) row[lang!] = text;
      if (lang === "lv" && key === "<trn-save>") row.lv = "Saglabāt";
      return row;
    });
    return new Response(JSON.stringify({ translations }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
}

test("load() asks only for the client's language", async () => {
  const calls: string[] = [];
  const client = new TranslationClient("ee");
  await withFetch(makeFetchByLang(calls), async () => {
    await client.load();
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/v1\/translations\?lang=ee$/);
  assert.equal(client.translate("<trn-save>", "Save"), "Salvesta");
});

test("setLang() fetches a language not loaded yet, once, and keeps the one already there", async () => {
  const calls: string[] = [];
  const client = new TranslationClient("ee");
  await withFetch(makeFetchByLang(calls), async () => {
    await client.load();
    client.setLang("lv");
    await new Promise((resolve) => setTimeout(resolve, 10));
    client.setLang("ee");
    client.setLang("lv");
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const translationCalls = calls.filter((u) => u.includes("/v1/translations"));
  assert.deepEqual(
    translationCalls.map((u) => new URL(u, "https://services-api.trf.is").searchParams.get("lang")),
    ["ee", "lv"]
  );
  assert.equal(client.translate("<trn-save>", "Save"), "Saglabāt");
  client.setLang("ee");
  assert.equal(client.translate("<trn-save>", "Save"), "Salvesta");
});

// A page with @trf/ui2 in it: a window that hears trf:org-token, on a staging host.
async function withWindow(fn: (win: EventTarget) => Promise<void>): Promise<void> {
  const g = globalThis as { window?: unknown };
  const original = g.window;
  const win = Object.assign(new EventTarget(), { location: { hostname: "invoices.trf.is" } });
  g.window = win;
  try {
    await fn(win);
  } finally {
    if (typeof original === "undefined") delete g.window;
    else g.window = original;
  }
}

function orgToken(country: string): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ o: { c: country, n: "Näide OÜ" } })}.sig`;
}

function announce(win: EventTarget, token: string): void {
  win.dispatchEvent(new CustomEvent("trf:org-token", { detail: { slug: "naide", token } }));
}

test("an org token sets the language by the organisation's country when nobody picked one", async () => {
  const calls: string[] = [];
  await withWindow(async (win) => {
    await withFetch(makeFetchByLang(calls), async () => {
      const client = new TranslationClient();
      await client.load();
      announce(win, orgToken("EE"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(client.getLang(), "ee");
      assert.equal(client.translate("<trn-save>", "Save"), "Salvesta");
      // Kept the way a pick is, so the other apps open in it.
      assert.ok(calls.some((u) => u === "https://trf.is/setlang?lang=ee"));
      // Only the first token decides.
      announce(win, orgToken("LV"));
      assert.equal(client.getLang(), "ee");
    });
  });
});

test("an organisation that still carries the country's name gets its language too", async () => {
  await withWindow(async (win) => {
    await withFetch(makeFetchByLang([]), async () => {
      const client = new TranslationClient();
      announce(win, orgToken("Latvia"));
      assert.equal(client.getLang(), "lv");
    });
  });
});

test("a country without a language leaves English, and a later token can still decide", async () => {
  await withWindow(async (win) => {
    await withFetch(makeFetchByLang([]), async () => {
      const client = new TranslationClient();
      announce(win, orgToken("DE"));
      assert.equal(client.getLang(), "en");
      announce(win, orgToken("FI"));
      assert.equal(client.getLang(), "fi");
    });
  });
});

test("a language the user picked is never replaced by the organisation's", async () => {
  await withWindow(async (win) => {
    await withFetch(makeFetchByLang([]), async () => {
      let client: TranslationClient | undefined;
      withDocumentCookie("lang=en", () => {
        client = new TranslationClient();
      });
      announce(win, orgToken("EE"));
      assert.equal(client!.getLang(), "en");
    });
  });
});
