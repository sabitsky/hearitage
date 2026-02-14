# 🎨 Hearitage — AI Museum Guide (M2)

> iPhone camera -> Claude Vision -> structured painting result.

## Quick Start

```bash
npm install
```

Configure `.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-your-real-key
# optional
# ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

## iPhone Runbook (Recommended: Cloudflare Tunnel)

### 1) Install cloudflared (without brew)

```bash
./scripts/install-cloudflared-macos.sh
```

If needed, add the install folder to PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 2) Start app + tunnel on Mac

Terminal A:

```bash
npm run dev:mobile
```

Terminal B:

```bash
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://...trycloudflare.com` URL and open it in Safari on iPhone.

### 3) Preflight check (must return JSON)

```bash
curl -i -X POST "https://<your-tunnel-domain>/api/recognize" \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"data:image/jpeg;base64,Zm9v"}'
```

Expected:
- `Content-Type: application/json`
- JSON body with either success payload or error payload

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
  "summary": "string",
  "requestId": "string"
}
```

Error:

```json
{
  "error": "string",
  "code": "bad_request|billing|timeout|upstream_error|non_json_response|network",
  "requestId": "string"
}
```

Every response also includes header `x-request-id`.

## How To Prove Request Reached Claude

1. In UI error/success state, copy `requestId`.
2. In dev server logs, find records with the same `requestId`.
3. Successful Claude path has stages:
   - `claude_call_start`
   - `claude_call_end`
4. Failed Claude path has:
   - `claude_call_error`

## Camera + Recognition Troubleshooting

| Symptom | Probable Cause | Action |
|---|---|---|
| Camera error says HTTPS required | Insecure context | Open only tunnel HTTPS URL |
| Green indicator, black preview | Playback/attachment issue | Tap `Retry camera`, keep page foregrounded |
| `code=billing` | Claude credits exhausted | Top up Anthropic credits |
| `code=timeout` | Upstream timeout | Retry once, verify network quality |
| `code=non_json_response` | Tunnel/proxy injected non-JSON page | Restart `cloudflared` and retry |
| `code=network` | Connectivity issue | Verify Mac internet and tunnel status |

## M2 Validation (5 paintings)

Target: at least `4/5` successful recognitions.

| Painting input | requestId | HTTP status | result/error code | recognized name | pass/fail |
|---|---|---|---|---|---|
| Mona Lisa |  |  |  |  |  |
| The Starry Night |  |  |  |  |  |
| The Scream |  |  |  |  |  |
| Girl with a Pearl Earring |  |  |  |  |  |
| The Night Watch |  |  |  |  |  |

## Legacy Fallback (not recommended)

`localtunnel` may require password and can return HTML interstitial responses:

```bash
npx localtunnel --port 3000
```
