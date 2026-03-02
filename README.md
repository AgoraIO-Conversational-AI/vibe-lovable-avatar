# Video Avatar AI Agent

A real-time video avatar AI agent powered by [Agora Conversational AI](https://www.agora.io/en/products/conversational-ai/), [OpenAI](https://platform.openai.com/) LLM, [ElevenLabs](https://elevenlabs.io/) TTS, and [Anam](https://www.anam.ai/) avatars. Built with Vite + React + TypeScript + Supabase Edge Functions.

## Prerequisites

- Node.js 18+
- An [Agora](https://console.agora.io/) account with Conversational AI enabled
- An [OpenAI](https://platform.openai.com/) API key
- An [ElevenLabs](https://elevenlabs.io/) API key and voice ID
- An [Anam](https://www.anam.ai/) account with an avatar created
- A [Supabase](https://supabase.com/) project (free tier works)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/AgoraIO-Conversational-AI/vibe-lovable-avatar.git
cd vibe-lovable-avatar
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com/) and create a new project
2. Note your **Project ID**, **URL**, and **anon/public key** from Settings > API

### 3. Set Supabase secrets

```bash
npx supabase secrets set \
  APP_ID=<your_agora_app_id> \
  APP_CERTIFICATE=<your_agora_app_certificate> \
  LLM_API_KEY=<your_openai_api_key> \
  TTS_KEY=<your_elevenlabs_api_key> \
  TTS_VOICE_ID=<your_elevenlabs_voice_id> \
  AVATAR_API_KEY=<your_anam_api_key> \
  AVATAR_ID=<your_anam_avatar_id>
```

Optional secrets:
- `LLM_URL` — defaults to `https://api.openai.com/v1/chat/completions`
- `LLM_MODEL` — defaults to `gpt-4o-mini`

### 4. Deploy edge functions

```bash
npx supabase link --project-ref <your_project_id>
npx supabase functions deploy start-video-agent
npx supabase functions deploy hangup-agent
npx supabase functions deploy check-env
npx supabase functions deploy health
```

### 5. Configure .env

Create `.env` in the project root:

```
VITE_SUPABASE_PROJECT_ID="<your_project_id>"
VITE_SUPABASE_PUBLISHABLE_KEY="<your_anon_key>"
VITE_SUPABASE_URL="https://<your_project_id>.supabase.co"
```

### 6. Run

```bash
npm run dev
```

Open http://localhost:8080

## Architecture

```
Browser (React + Agora RTC/RTM SDK)
  │
  ├── Supabase Edge Function: start-video-agent
  │     └── Agora ConvoAI API (with avatar config)
  │
  ├── Agora RTC: audio (UID 100) + video avatar (UID 102)
  │
  └── Agora RTM: text messaging
```

- **UID 100** — Agent audio
- **UID 101** — User
- **UID 102** — Agent video (avatar)

## Local Development

For running locally without Supabase, see [local.md](local.md).

## Supabase Secrets Reference

| Secret | Required | Description |
|--------|----------|-------------|
| `APP_ID` | Yes | Agora App ID |
| `APP_CERTIFICATE` | Yes | Agora App Certificate (32-char hex, for token gen and API auth) |
| `LLM_API_KEY` | Yes | OpenAI API key |
| `TTS_KEY` | Yes | ElevenLabs API key |
| `TTS_VOICE_ID` | Yes | ElevenLabs voice ID |
| `AVATAR_API_KEY` | Yes | Anam API key |
| `AVATAR_ID` | Yes | Anam avatar ID |
| `LLM_URL` | No | LLM endpoint URL (default: OpenAI) |
| `LLM_MODEL` | No | LLM model name (default: `gpt-4o-mini`) |
