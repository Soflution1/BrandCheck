#!/usr/bin/env node
/**
 * brandcheck MCP: Check brand name availability everywhere
 * 
 * Checks: domains, social media, app stores, trademark (INPI), tech platforms
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve4 } from "dns/promises";

const SERVER_NAME = "brandcheck";
const SERVER_VERSION = "1.0.0";

// ─── Types ────────────────────────────────────────────────────────────

interface CheckResult {
  platform: string;
  category: string;
  url: string;
  available: boolean | null; // null = could not determine
  status: string; // "available", "taken", "error", "unknown"
  detail?: string;
}

// ─── HTTP Helper ──────────────────────────────────────────────────────

async function httpCheck(url: string, timeoutMs = 8000): Promise<{ status: number; ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    });
    clearTimeout(timer);
    return { status: res.status, ok: res.ok };
  } catch (err: any) {
    clearTimeout(timer);
    // Some sites block HEAD, try GET
    try {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), timeoutMs);
      const res = await fetch(url, {
        method: "GET",
        signal: controller2.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "text/html",
        },
      });
      clearTimeout(timer2);
      // Read a bit of body to check content
      const text = await res.text().catch(() => "");
      return { status: res.status, ok: res.ok };
    } catch (err2: any) {
      return { status: 0, ok: false, error: err2.message || "timeout" };
    }
  }
}

// ─── Domain Check (DNS) ───────────────────────────────────────────────

async function checkDomain(name: string, tld: string): Promise<CheckResult> {
  const domain = `${name}.${tld}`;
  try {
    await resolve4(domain);
    return { platform: `.${tld}`, category: "domain", url: `https://${domain}`, available: false, status: "taken" };
  } catch (err: any) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      return { platform: `.${tld}`, category: "domain", url: `https://${domain}`, available: true, status: "available" };
    }
    return { platform: `.${tld}`, category: "domain", url: `https://${domain}`, available: null, status: "unknown", detail: err.code };
  }
}

// ─── Social Media Check ───────────────────────────────────────────────

async function checkSocial(name: string, platform: string, urlTemplate: string): Promise<CheckResult> {
  const url = urlTemplate.replace("{name}", name);
  try {
    const { status, ok, error } = await httpCheck(url);
    if (status === 404 || status === 410) {
      return { platform, category: "social", url, available: true, status: "available" };
    }
    if (ok || status === 200 || status === 301 || status === 302) {
      return { platform, category: "social", url, available: false, status: "taken" };
    }
    // 403/429 = rate limited, can't determine
    if (status === 403 || status === 429) {
      return { platform, category: "social", url, available: null, status: "unknown", detail: `HTTP ${status} (rate limited)` };
    }
    return { platform, category: "social", url, available: null, status: "unknown", detail: `HTTP ${status}` };
  } catch (err: any) {
    return { platform, category: "social", url, available: null, status: "error", detail: err.message };
  }
}

// ─── App Store Check ──────────────────────────────────────────────────

async function checkAppStore(name: string): Promise<CheckResult> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&limit=5&country=fr`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json() as { resultCount: number; results: Array<{ trackName: string; bundleId: string }> };
    const exact = data.results?.find((r: any) =>
      r.trackName?.toLowerCase() === name.toLowerCase() ||
      r.bundleId?.toLowerCase().includes(name.toLowerCase())
    );
    if (exact) {
      return { platform: "App Store", category: "app", url: `https://apps.apple.com/search?term=${name}`, available: false, status: "taken", detail: `"${exact.trackName}" (${exact.bundleId})` };
    }
    return { platform: "App Store", category: "app", url: `https://apps.apple.com/search?term=${name}`, available: true, status: "available", detail: `${data.resultCount} partial matches` };
  } catch (err: any) {
    return { platform: "App Store", category: "app", url: "", available: null, status: "error", detail: err.message };
  }
}

// ─── Google Play Check ────────────────────────────────────────────────

async function checkGooglePlay(name: string): Promise<CheckResult> {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(name)}&c=apps`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", "Accept-Language": "fr" },
    });
    clearTimeout(timer);
    const html = await res.text();
    const lowerName = name.toLowerCase();
    // Check if exact name appears in results
    const hasExact = html.toLowerCase().includes(`>${lowerName}<`) || html.toLowerCase().includes(`"${lowerName}"`);
    if (hasExact) {
      return { platform: "Google Play", category: "app", url, available: false, status: "taken" };
    }
    return { platform: "Google Play", category: "app", url, available: true, status: "available", detail: "No exact match found" };
  } catch (err: any) {
    return { platform: "Google Play", category: "app", url, available: null, status: "error", detail: err.message };
  }
}

// ─── INPI Trademark Check (France) ────────────────────────────────────

async function checkINPI(name: string): Promise<CheckResult> {
  // INPI public search API
  const url = `https://data.inpi.fr/api/v1/marques?q=${encodeURIComponent(name)}&rows=5`;
  const searchUrl = `https://data.inpi.fr/recherche?q=${encodeURIComponent(name)}&type=marques`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "depsonar/1.0", "Accept": "application/json" },
    });
    clearTimeout(timer);

    if (!res.ok) {
      // Fallback: try the search page directly
      return { platform: "INPI (marques FR)", category: "trademark", url: searchUrl, available: null, status: "unknown", detail: `Vérifier manuellement: ${searchUrl}` };
    }

    const data = await res.json() as any;
    const results = data?.results || data?.response?.docs || [];
    const lowerName = name.toLowerCase();
    const exact = results.find((r: any) => {
      const markName = (r.denomination || r.name || r.nomMarque || "").toLowerCase();
      return markName === lowerName || markName.includes(lowerName);
    });

    if (exact) {
      const detail = exact.denomination || exact.name || exact.nomMarque || "";
      return { platform: "INPI (marques FR)", category: "trademark", url: searchUrl, available: false, status: "taken", detail: `Marque déposée: "${detail}"` };
    }
    return { platform: "INPI (marques FR)", category: "trademark", url: searchUrl, available: true, status: "available", detail: `${results.length} résultats partiels` };
  } catch (err: any) {
    return { platform: "INPI (marques FR)", category: "trademark", url: searchUrl, available: null, status: "unknown", detail: `Vérifier manuellement: ${searchUrl}` };
  }
}

// ─── npm Check ────────────────────────────────────────────────────────

async function checkNpm(name: string): Promise<CheckResult> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 404) {
      return { platform: "npm", category: "tech", url: `https://www.npmjs.com/package/${name}`, available: true, status: "available" };
    }
    if (res.ok) {
      const data = await res.json() as any;
      return { platform: "npm", category: "tech", url: `https://www.npmjs.com/package/${name}`, available: false, status: "taken", detail: `${data.description || ""}`.slice(0, 80) };
    }
    return { platform: "npm", category: "tech", url: `https://www.npmjs.com/package/${name}`, available: null, status: "unknown" };
  } catch {
    return { platform: "npm", category: "tech", url: `https://www.npmjs.com/package/${name}`, available: null, status: "error" };
  }
}

// ─── GitHub Check ─────────────────────────────────────────────────────

async function checkGitHub(name: string): Promise<CheckResult> {
  const url = `https://github.com/${name}`;
  try {
    const { status } = await httpCheck(url);
    if (status === 404) {
      return { platform: "GitHub (org)", category: "tech", url, available: true, status: "available" };
    }
    return { platform: "GitHub (org)", category: "tech", url, available: false, status: "taken" };
  } catch {
    return { platform: "GitHub (org)", category: "tech", url, available: null, status: "error" };
  }
}

// ─── Main Brand Check ─────────────────────────────────────────────────

async function brandCheck(name: string, options: { domains?: boolean; social?: boolean; apps?: boolean; trademark?: boolean; tech?: boolean }): Promise<CheckResult[]> {
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const promises: Promise<CheckResult>[] = [];

  // Domains
  if (options.domains !== false) {
    for (const tld of ["com", "fr", "io", "co", "app", "ai", "dev", "org", "net", "eu"]) {
      promises.push(checkDomain(cleanName, tld));
    }
  }

  // Social Media
  if (options.social !== false) {
    const socials: [string, string][] = [
      ["X (Twitter)", "https://x.com/{name}"],
      ["Instagram", "https://www.instagram.com/{name}/"],
      ["TikTok", "https://www.tiktok.com/@{name}"],
      ["LinkedIn (company)", "https://www.linkedin.com/company/{name}/"],
      ["Facebook", "https://www.facebook.com/{name}"],
      ["YouTube", "https://www.youtube.com/@{name}"],
      ["Threads", "https://www.threads.net/@{name}"],
      ["Pinterest", "https://www.pinterest.com/{name}/"],
      ["Reddit", "https://www.reddit.com/r/{name}"],
      ["Snapchat", "https://www.snapchat.com/add/{name}"],
      ["Bluesky", "https://bsky.app/profile/{name}.bsky.social"],
    ];
    for (const [platform, template] of socials) {
      promises.push(checkSocial(cleanName, platform, template));
    }
  }

  // App Stores
  if (options.apps !== false) {
    promises.push(checkAppStore(name));
    promises.push(checkGooglePlay(name));
  }

  // Trademark
  if (options.trademark !== false) {
    promises.push(checkINPI(name));
  }

  // Tech platforms
  if (options.tech !== false) {
    promises.push(checkNpm(cleanName));
    promises.push(checkGitHub(cleanName));
  }

  // Run all in parallel
  return Promise.all(promises);
}

// ─── Format Results ───────────────────────────────────────────────────

function formatResults(name: string, results: CheckResult[]): string {
  const lines: string[] = [];
  lines.push(`# 🔍 Brand Check: "${name}"\n`);

  // Summary
  const available = results.filter(r => r.available === true).length;
  const taken = results.filter(r => r.available === false).length;
  const unknown = results.filter(r => r.available === null).length;
  lines.push(`**Résumé:** ✅ ${available} dispo · ❌ ${taken} pris · ❓ ${unknown} incertain\n`);

  // Group by category
  const categories: Record<string, CheckResult[]> = {};
  for (const r of results) {
    if (!categories[r.category]) categories[r.category] = [];
    categories[r.category].push(r);
  }

  const categoryLabels: Record<string, string> = {
    domain: "🌐 Noms de domaine",
    social: "📱 Réseaux sociaux",
    app: "📲 App Stores",
    trademark: "⚖️ Marques déposées",
    tech: "💻 Tech / Dev",
  };

  for (const [cat, items] of Object.entries(categories)) {
    lines.push(`\n## ${categoryLabels[cat] || cat}\n`);
    lines.push("| Plateforme | Statut | URL |");
    lines.push("|------------|--------|-----|");
    for (const r of items) {
      const icon = r.available === true ? "✅ Dispo" : r.available === false ? "❌ Pris" : "❓ Incertain";
      const detail = r.detail ? ` — ${r.detail}` : "";
      lines.push(`| ${r.platform} | ${icon}${detail} | ${r.url} |`);
    }
  }

  // Recommendations
  lines.push("\n## 💡 Recommandation\n");
  const domainResults = results.filter(r => r.category === "domain");
  const comResult = domainResults.find(r => r.platform === ".com");
  const frResult = domainResults.find(r => r.platform === ".fr");

  if (comResult?.available && frResult?.available) {
    lines.push("✅ **.com** et **.fr** sont tous les deux disponibles. Fonce !");
  } else if (comResult?.available === false && frResult?.available) {
    lines.push("⚠️ Le **.com** est pris mais le **.fr** est dispo. Envisage une variante ou sécurise le .fr.");
  } else if (comResult?.available === false && frResult?.available === false) {
    lines.push("❌ Le **.com** et le **.fr** sont pris. Il faudrait trouver une variante du nom.");
  }

  const inpi = results.find(r => r.category === "trademark");
  if (inpi?.available === false) {
    lines.push("\n⚠️ **Attention:** Une marque similaire est déposée à l'INPI. Consulte un avocat en propriété intellectuelle avant d'utiliser ce nom.");
  } else if (inpi?.available === true) {
    lines.push("\n✅ Aucune marque identique trouvée à l'INPI (vérification de base). Pour un dépôt officiel, fais une recherche approfondie sur data.inpi.fr.");
  }

  return lines.join("\n");
}

// ─── MCP Server ───────────────────────────────────────────────────────

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

server.tool(
  "brandcheck",
  "Vérifie la disponibilité d'un nom de marque partout : domaines (.com, .fr, .io, .ai, etc.), réseaux sociaux (X, Instagram, TikTok, LinkedIn, Facebook, YouTube, Threads, Pinterest, Reddit, Snapchat, Bluesky), App Store, Google Play, INPI (marques françaises), npm, GitHub. Lance tous les checks en parallèle et retourne un rapport complet.",
  {
    name: z.string().describe("Le nom de marque à vérifier (ex: 'roompilot', 'clickstay', 'depsonar')"),
    domains: z.boolean().optional().describe("Vérifier les noms de domaine (défaut: true)"),
    social: z.boolean().optional().describe("Vérifier les réseaux sociaux (défaut: true)"),
    apps: z.boolean().optional().describe("Vérifier les app stores (défaut: true)"),
    trademark: z.boolean().optional().describe("Vérifier les marques INPI (défaut: true)"),
    tech: z.boolean().optional().describe("Vérifier npm et GitHub (défaut: true)"),
  },
  async ({ name, domains, social, apps, trademark, tech }) => {
    try {
      const results = await brandCheck(name, { domains, social, apps, trademark, tech });
      const report = formatResults(name, results);
      return { content: [{ type: "text" as const, text: report }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Erreur: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "brandcheck_domains",
  "Vérifie uniquement la disponibilité des noms de domaine pour un nom donné. Check rapide sur .com, .fr, .io, .co, .app, .ai, .dev, .org, .net, .eu",
  {
    name: z.string().describe("Le nom à vérifier"),
    tlds: z.array(z.string()).optional().describe("TLDs spécifiques à vérifier (ex: ['com', 'fr', 'io']). Par défaut: com, fr, io, co, app, ai, dev, org, net, eu"),
  },
  async ({ name, tlds }) => {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const extensions = tlds || ["com", "fr", "io", "co", "app", "ai", "dev", "org", "net", "eu"];
    const results = await Promise.all(extensions.map(tld => checkDomain(cleanName, tld)));
    const lines = [`# 🌐 Domaines pour "${name}"\n`];
    for (const r of results) {
      const icon = r.available === true ? "✅" : r.available === false ? "❌" : "❓";
      lines.push(`${icon} **${cleanName}${r.platform}** ${r.available ? "— DISPO" : "— pris"}`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "brandcheck_social",
  "Vérifie uniquement la disponibilité d'un pseudo sur les réseaux sociaux : X, Instagram, TikTok, LinkedIn, Facebook, YouTube, Threads, Pinterest, Reddit, Snapchat, Bluesky",
  {
    name: z.string().describe("Le pseudo à vérifier"),
  },
  async ({ name }) => {
    const results = await brandCheck(name, { domains: false, social: true, apps: false, trademark: false, tech: false });
    const report = formatResults(name, results);
    return { content: [{ type: "text" as const, text: report }] };
  }
);

// ─── Start ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
