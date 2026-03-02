# Local Development

Run the video avatar agent locally without deploying to Supabase or Lovable.

## Prerequisites

- Node.js 20+ (`nvm use 20`)
- Agora credentials (`APP_ID`, `APP_CERTIFICATE`)
- LLM API key, TTS credentials, and avatar credentials

## Setup

```bash
npm install
```

### 1. Configure `.env`

Point the Supabase client at the local test server:

```
VITE_SUPABASE_PROJECT_ID="local"
VITE_SUPABASE_PUBLISHABLE_KEY="local"
VITE_SUPABASE_URL="http://localhost:3001"
```

### 2. Start the test server

`test-server.mjs` is included in the repo — it's a Node.js server that mimics Supabase Edge Functions locally.

```bash
APP_ID=<your_app_id> \
APP_CERTIFICATE=<your_app_certificate> \
LLM_API_KEY=<your_llm_key> \
TTS_VENDOR=elevenlabs \
TTS_KEY=<your_elevenlabs_key> \
TTS_VOICE_ID=<your_voice_id> \
AVATAR_API_KEY=<your_anam_key> \
AVATAR_ID=<your_avatar_id> \
node test-server.mjs
```

Starts on port 3001.

### 3. Start the Vite dev server (separate terminal)

```bash
npm run dev
```

Open http://localhost:8080

## How it works

Since Supabase Edge Functions (Deno) can't easily run locally, `test-server.mjs` is a Node.js server that mimics the edge function endpoints:

```
Browser (Vite, port 8080)
  └── VITE_SUPABASE_URL → test-server (port 3001)
        ├── /functions/v1/check-env
        ├── /functions/v1/start-video-agent
        └── /functions/v1/hangup-agent
```

Credentials are passed as environment variables to the test server, not stored in files.

## Troubleshooting

- **"Configuration Required"** — The test server is missing credentials. Check it printed all required vars on startup.
- **`crypto.getRandomValues` error** — You need Node.js 20+. Run `nvm use 20`.
- **Port in use** — `lsof -ti:3001 | xargs kill` or `lsof -ti:8080 | xargs kill`
