# 🎨 Hearitage — AI Museum Guide

> Point your camera at any painting. Get an instant AI-powered audio guide.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Add your Claude API key
# Edit .env.local and replace sk-ant-your-key-here with your real key
# Get one at https://console.anthropic.com/

# 3. Run locally
npm run dev

# 4. Test on phone (same WiFi network)
npm run dev:mobile
# Then open http://YOUR_LOCAL_IP:3000 on your phone
```

## Tech Stack

- **Next.js 14** — App Router + API Routes
- **PWA** — Installable, works offline (cached results)
- **Claude API** — Vision (identify paintings) + Text (generate descriptions)
- **Web Speech API** — Free text-to-speech
- **Tailwind CSS** — Dark, elegant UI

## Deploy

```bash
vercel deploy
```
