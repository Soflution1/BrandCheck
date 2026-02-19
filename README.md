# 🔍 brandcheck

**Check brand name availability everywhere in one shot.**

Domains, social media, app stores, trademarks, and dev platforms — all checked in parallel.

## Install in Cursor

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=brandcheck&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImJyYW5kY2hlY2tAbGF0ZXN0Il19)

Or manually add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "brandcheck": {
      "command": "npx",
      "args": ["-y", "brandcheck@latest"]
    }
  }
}
```

## What it checks

| Category | Platforms |
|----------|-----------|
| 🌐 Domains | `.com` `.fr` `.io` `.co` `.app` `.ai` `.dev` `.org` `.net` `.eu` |
| 📱 Social | X, Instagram, TikTok, LinkedIn, Facebook, YouTube, Threads, Pinterest, Reddit, Snapchat, Bluesky |
| 📲 App Stores | Apple App Store, Google Play |
| ⚖️ Trademarks | INPI (French trademark registry) |
| 💻 Tech | npm, GitHub |

## Tools

### `brandcheck`

Full audit across all platforms. One command, everything checked in parallel.

```
"Check if the name Luminova is available"
```

Returns a complete report:

```
# 🔍 Brand Check: "luminova"

**Résumé:** ✅ 18 dispo · ❌ 7 pris · ❓ 2 incertain

## 🌐 Noms de domaine

| Plateforme | Statut | URL |
|------------|--------|-----|
| .com | ❌ Pris | https://luminova.com |
| .fr | ✅ Dispo | https://luminova.fr |
| .io | ✅ Dispo | https://luminova.io |
| .ai | ✅ Dispo | https://luminova.ai |
...

## 📱 Réseaux sociaux

| Plateforme | Statut | URL |
|------------|--------|-----|
| Instagram | ❌ Pris | https://instagram.com/luminova |
| TikTok | ✅ Dispo | https://tiktok.com/@luminova |
| LinkedIn | ✅ Dispo | https://linkedin.com/company/luminova |
...

## 💡 Recommandation

⚠️ Le .com est pris mais le .fr est dispo. Envisage une variante.
✅ Aucune marque identique trouvée à l'INPI.
```

### `brandcheck_domains`

Domain-only check. Fast.

```
"Check domains for roompilot"
```

### `brandcheck_social`

Social media handles only.

```
"Is the handle 'clickstay' available on social media?"
```

## How it works

All checks run **in parallel** using DNS lookups (domains), HTTP HEAD requests (social media), and public APIs (App Store, npm, INPI). A full brand check completes in ~5-10 seconds.

**No API keys required.** Everything uses public endpoints.

## Limitations

- Social media checks rely on HTTP status codes (200 = taken, 404 = available). Some platforms may rate-limit or return ambiguous results.
- INPI check is a basic name search, not a full trademark similarity analysis. Always consult a lawyer before filing.
- App Store results are keyword-based, not exact name matching on the store listing.

## License

MIT
