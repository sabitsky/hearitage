# 🎨 Hearitage — AI Museum Guide (M6)

> Production-first validation on Vercel: iPhone camera -> Claude Vision + Google Vision -> merged JSON result.

## Where To Put Anthropic Key (Best Practices)

1. Store `ANTHROPIC_API_KEY` only in Vercel Environment Variables.
2. Never use `NEXT_PUBLIC_ANTHROPIC_API_KEY`.
3. Do not commit keys to git or `.env` files in repo.
4. Use separate keys:
   - `Production`: main key with monitored budget.
   - `Preview`: separate key with lower limits.
5. Rotate keys if leakage is suspected; redeploy after updating env vars.

## Vercel Environment Setup

In Vercel Project -> Settings -> Environment Variables add:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (optional, default: `claude-sonnet-4-20250514`)
- `GOOGLE_CLOUD_VISION_KEY`
- `GOOGLE_VISION_MODE` (optional: `off|shadow|enrich`, default: `enrich`)

`GOOGLE_VISION_MODE` behavior:

- `off`: Claude only
- `shadow`: call Google Vision and log it, but return Claude-only output
- `enrich`: call Google Vision and run merge step (recommended for production)

Assign env scopes explicitly:

- `Production`
- `Preview`
- `Development` (optional for Vercel dev workflows)

After any env change: **redeploy**. Existing deployments do not automatically receive updated values.

## Vercel Production Validation (Primary)

### 1) Confirm deployment is current

1. Push latest `main`.
2. In Vercel dashboard open latest `Production` deployment.
3. Verify build commit hash matches local `main`.

### 2) Preflight API check against production URL

```bash
curl -i -X POST "https://<your-production-domain>/api/recognize" \
  -H "Content-Type: application/json" \
  -H "x-request-id: preflight-prod-001" \
  -d '{"imageBase64":"data:image/jpeg;base64,Zm9v"}'
```

Expected:

- `Content-Type: application/json`
- JSON body containing `requestId`
- On failure, JSON with `code` (no HTML interstitial)

### 3) iPhone production test

1. Open `https://<your-production-domain>` in Safari on iPhone.
2. Allow camera access.
3. Run test set of 5 paintings (from monitor/photo prints).
4. Capture `requestId` for each attempt from UI.

## API Contract (`POST /api/recognize`)

Success:

```json
{
  "painting": "string",
  "artist": "string",
  "year": "string",
  "museum": "string",
  "style": "string",
  "confidence": "high|medium|low",
  "reasoning": "string",
  "summary": "string",
  "requestId": "string"
}
```

Error:

```json
{
  "error": "string",
  "code": "bad_request|misconfigured_env|billing|timeout|upstream_error|non_json_response|network",
  "requestId": "string"
}
```

Response header always includes `x-request-id`.

## How To Prove Request Reached Pipeline (Vercel)

1. Copy `requestId` from UI.
2. In Vercel -> Project -> Logs, search by this `requestId`.
3. You should see:
   - `pipeline_start`
   - `claude_call_start`
   - `claude_call_end` or `claude_call_error`
   - `google_vision_start` and `google_vision_end` (if mode is not `off`)
   - `merge_start` and `merge_end` (if mode is `enrich` and Google had usable data)
   - `pipeline_end`

## Troubleshooting Matrix

| Symptom | Probable Cause | Action |
|---|---|---|
| `code=misconfigured_env` | `ANTHROPIC_API_KEY` missing in deployment env | Add key in Vercel env vars, redeploy |
| `code=billing` | Anthropic credits exhausted | Top up Anthropic account credits |
| `code=timeout` | Claude timeout / network latency | Retry request, verify network |
| `code=upstream_error` | Temporary upstream failure | Retry once; inspect Vercel logs |
| `code=non_json_response` | Proxy/tunnel returned HTML | Verify production URL and CDN path |
| `code=network` | Server-to-Claude networking issue | Check Vercel function logs and retry |

## M6 Validation Protocol (7 Paintings)

Goal: `>=5/7` correct recognitions on production.

| Painting input | requestId | HTTP status | result/error code | recognized name | pass/fail |
|---|---|---|---|---|---|
| Mona Lisa |  |  |  |  |  |
| The Starry Night |  |  |  |  |  |
| Self-Portrait with Daughters (Zinaida Serebriakova) |  |  |  |  |  |
| Girl with Peaches (Valentin Serov) |  |  |  |  |  |
| Black Square (Kazimir Malevich) |  |  |  |  |  |
| Lesser-known painting |  |  |  |  |  |
| Non-painting image |  |  |  |  |  |

## Local Development (Optional)

```bash
npm install
```

Local `.env.local` for development only:

```env
ANTHROPIC_API_KEY=sk-ant-your-real-key
# optional
# ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

For local iPhone checks (not production):

```bash
npm run dev:mobile
npm run tunnel:cloudflare
```
