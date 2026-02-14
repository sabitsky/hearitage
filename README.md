# 🎨 Hearitage — AI Museum Guide (M1)

> Point your camera at a painting and get an AI response.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
# Edit .env.local and set a real Anthropic key
# ANTHROPIC_API_KEY=sk-ant-...
# Optional:
# ANTHROPIC_MODEL=claude-sonnet-4-20250514

# 3. Run desktop dev
npm run dev

# 4. Run for phone in local network
npm run dev:mobile
```

## M1 iPhone Test Runbook

### 1. Prepare local environment

```bash
npm install
```

Edit `.env.local`:

```env
ANTHROPIC_API_KEY=sk-ant-your-real-key
# optional:
# ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Restart dev server after env changes.

### 2. Start server for mobile access

```bash
npm run dev:mobile
```

Find your Mac LAN IP:

```bash
ipconfig getifaddr en0
```

If empty, try:

```bash
ipconfig getifaddr en1
```

### 3. Open app on iPhone

1. Connect iPhone and Mac to the same Wi-Fi.
2. Open Safari on iPhone.
3. Go to `http://YOUR_LAN_IP:3000`.
4. Allow camera access when prompted.

### 4. Execute milestone scenario

1. Point camera at painting image on monitor.
2. Tap `Scan Painting`.
3. Tap `Recognize Painting`.
4. Wait for result card (title, artist, year, museum, style, summary).

## HTTPS fallback for iPhone camera restrictions

If iPhone blocks camera in LAN HTTP context, run an HTTPS tunnel and open that URL:

```bash
npx localtunnel --port 3000
```

Use the `https://...` URL from localtunnel in Safari on iPhone.

If localtunnel asks for a password on iPhone, get it on Mac:

```bash
curl https://loca.lt/mytunnelpassword
```

Enter that value into the `Tunnel password` prompt.

## Camera Troubleshooting (iPhone)

When camera preview is black or unavailable:

1. Open the app only via `https://...loca.lt` URL (not `http://192.168...`).
2. Use Safari first (disable in-app browsers).
3. Close apps that can hold camera (Camera, Telegram, Zoom, Meet).
4. Tap `Retry camera`.
5. If still broken, reload page once and allow camera again.

## Camera Diagnostics Matrix

| Symptom | Probable Cause | Action |
|---|---|---|
| "Camera requires HTTPS..." error | Insecure context | Open tunnel URL `https://...loca.lt` |
| Permission prompt appears, then error about denied access | Permission denied in browser settings | Enable camera for site in Safari settings, then `Retry camera` |
| Green camera indicator but black preview | Stream attached late / playback issue | Tap `Retry camera`; keep page in foreground; reopen in Safari |
| Error says camera busy | Another app is using camera | Close other camera apps, then `Retry camera` |
| Rear camera constraint fails | Device/browser cannot satisfy `facingMode` | App auto-falls back to generic camera (`video: true`) |

## M1 Acceptance Checklist

- `npm run build` succeeds.
- iPhone opens app and requests camera permission.
- Scan -> Recognize returns non-empty AI response in UI.
- User sees clear error and can retry on failure.

## Negative Tests

### Empty payload (expect 400)

```bash
curl -i -X POST http://127.0.0.1:3000/api/recognize \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Invalid data URL format (expect 400)

```bash
curl -i -X POST http://127.0.0.1:3000/api/recognize \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"not-a-data-url"}'
```

### Missing/invalid API key (expect 500 for missing placeholder, 502 for bad key)

Set bad key in `.env.local`, restart server, then run a recognition request.

## Tech Stack

- **Next.js 14** — App Router + Route Handlers
- **PWA (Serwist)** — installable shell + offline page
- **Claude API** — vision recognition via `@anthropic-ai/sdk`
- **Tailwind CSS** — mobile-first UI
