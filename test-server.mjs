// Local test server for vibe-lovable-avatar edge functions
// Run: node test-server.mjs
//
// Serves all edge functions on port 3001 at /functions/v1/<name>
// Set VITE_SUPABASE_URL=http://localhost:3001 in .env to use this

import { createServer } from "http";
import { webcrypto } from "crypto";

// Polyfill for older Node
const subtle = globalThis.crypto?.subtle || webcrypto.subtle;

// ---- Token gen (v007) ----

function packUint16(v) {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, v, true);
  return buf;
}
function packUint32(v) {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, v, true);
  return buf;
}
function packString(s) {
  const encoded = new TextEncoder().encode(s);
  return concat(packUint16(encoded.length), encoded);
}
function packMapUint32(map) {
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  const parts = [packUint16(keys.length)];
  for (const k of keys) { parts.push(packUint16(k), packUint32(map[k])); }
  return concat(...parts);
}
function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}
async function hmacSha256(key, message) {
  const keyData = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await subtle.sign("HMAC", cryptoKey, message);
  return new Uint8Array(sig);
}
async function deflateAsync(data) {
  const { promisify } = await import("zlib");
  const { deflate } = await import("zlib");
  return new Promise((resolve, reject) => {
    deflate(Buffer.from(data), (err, result) => {
      if (err) reject(err);
      else resolve(new Uint8Array(result));
    });
  });
}
function toBase64(data) {
  return Buffer.from(data).toString("base64");
}

async function buildToken(channelName, uid, appId, appCertificate, rtmUid) {
  const issueTs = Math.floor(Date.now() / 1000);
  const expire = 86400;
  const salt = Math.floor(Math.random() * 99999999) + 1;
  let signing = await hmacSha256(packUint32(issueTs), new TextEncoder().encode(appCertificate));
  signing = await hmacSha256(packUint32(salt), signing);
  const rtcPrivileges = { 1: expire, 2: expire, 3: expire, 4: expire };
  const rtcPacked = concat(packUint16(1), packMapUint32(rtcPrivileges), packString(channelName), packString(uid));
  const rtmPrivileges = { 1: expire };
  const rtmPacked = concat(packUint16(2), packMapUint32(rtmPrivileges), packString(rtmUid || uid));
  const signingInfo = concat(packString(appId), packUint32(issueTs), packUint32(expire), packUint32(salt), packUint16(2), rtcPacked, rtmPacked);
  const signature = await hmacSha256(signing, signingInfo);
  const content = concat(packUint16(signature.length), signature, signingInfo);
  const compressed = await deflateAsync(content);
  return "007" + toBase64(compressed);
}

async function buildAuthHeader(appId, appCertificate) {
  const token = await buildToken("", "", appId, appCertificate);
  return `agora token=${token}`;
}

// ---- Config ----

const APP_ID = process.env.APP_ID || "";
const APP_CERTIFICATE = process.env.APP_CERTIFICATE || "";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const LLM_URL = process.env.LLM_URL || "https://api.openai.com/v1/chat/completions";
const TTS_KEY = process.env.TTS_KEY || "";
const TTS_VOICE_ID = process.env.TTS_VOICE_ID || "";
const AVATAR_VENDOR = process.env.AVATAR_VENDOR || "anam";
const AVATAR_API_KEY = process.env.AVATAR_API_KEY || "";
const AVATAR_ID = process.env.AVATAR_ID || "";

const AGENT_UID = "100";
const USER_UID = "101";
const AGENT_VIDEO_UID = "102";

function generateChannel() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function buildTtsConfig(key, voiceId) {
  return { vendor: "elevenlabs", params: { key, model_id: "eleven_flash_v2_5", voice_id: voiceId, stability: 0.5, sample_rate: 24000 } };
}

// ---- Helpers ----

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { ...corsHeaders, "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

// ---- Handlers ----

async function handleHealth(_req, res) {
  jsonResponse(res, { status: "ok" });
}

async function handleCheckEnv(_req, res) {
  const requiredVars = ["APP_ID", "APP_CERTIFICATE", "LLM_API_KEY", "TTS_KEY", "TTS_VOICE_ID", "AVATAR_API_KEY", "AVATAR_ID"];
  const optionalVars = ["LLM_URL", "LLM_MODEL"];
  const configured = {};
  const missing = [];
  for (const v of requiredVars) { const isSet = !!process.env[v]; configured[v] = isSet; if (!isSet) missing.push(v); }
  for (const v of optionalVars) { configured[v] = !!process.env[v]; }
  jsonResponse(res, { configured, ready: missing.length === 0, missing });
}

async function handleStartVideoAgent(req, res) {
  const body = await readBody(req);
  const prompt = body.prompt || "You are a friendly voice assistant. Keep responses concise, around 10 to 20 words. Be helpful and conversational.";
  const greeting = body.greeting || "Hi there! How can I help you today?";

  const channel = generateChannel();
  const agentRtmUid = `${AGENT_UID}-${channel}`;
  let userToken = "", agentToken = "", videoToken = "";
  const hasCertificate = APP_CERTIFICATE && /^[0-9a-f]{32}$/i.test(APP_CERTIFICATE);
  if (hasCertificate) {
    userToken = await buildToken(channel, USER_UID, APP_ID, APP_CERTIFICATE);
    agentToken = await buildToken(channel, AGENT_UID, APP_ID, APP_CERTIFICATE, agentRtmUid);
    videoToken = await buildToken(channel, AGENT_VIDEO_UID, APP_ID, APP_CERTIFICATE);
  }

  const ttsConfig = buildTtsConfig(TTS_KEY, TTS_VOICE_ID);
  const payload = {
    name: channel,
    properties: {
      channel, token: agentToken || APP_ID, agent_rtc_uid: AGENT_UID, agent_rtm_uid: agentRtmUid,
      remote_rtc_uids: [USER_UID], enable_string_uid: false, idle_timeout: 120,
      advanced_features: { enable_bhvs: true, enable_rtm: true, enable_aivad: true, enable_sal: true },
      llm: { url: LLM_URL, api_key: LLM_API_KEY, system_messages: [{ role: "system", content: prompt }], greeting_message: greeting, failure_message: "Sorry, something went wrong", max_history: 32, params: { model: LLM_MODEL }, style: "openai" },
      vad: { silence_duration_ms: 300 }, asr: { vendor: "ares", language: "en-US" }, tts: ttsConfig,
      avatar: {
        vendor: AVATAR_VENDOR,
        enable: true,
        params: {
          anam_api_key: AVATAR_API_KEY,
          agora_uid: AGENT_VIDEO_UID,
          agora_token: videoToken || APP_ID,
          anam_avatar_id: AVATAR_ID,
          anam_base_url: "https://api.anam.ai/v1",
        },
      },
      parameters: { transcript: { enable: true, protocol_version: "v2", enable_words: false } },
    },
  };

  const authHeader = await buildAuthHeader(APP_ID, APP_CERTIFICATE);
  console.log("Auth header type:", authHeader.startsWith("agora token=") ? "token-based" : "basic");
  console.log("Avatar vendor:", AVATAR_VENDOR, "| Avatar ID:", AVATAR_ID);
  console.log("\n=== FULL PAYLOAD TO AGORA ===");
  console.log(JSON.stringify(payload, null, 2));
  console.log("=== END PAYLOAD ===\n");

  const agoraRes = await fetch(`https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(payload),
  });
  const responseBody = await agoraRes.text();
  console.log("\n=== AGORA RESPONSE (status:", agoraRes.status, ") ===");
  console.log(responseBody);
  console.log("=== END RESPONSE ===\n");
  if (!agoraRes.ok) {
    res.writeHead(502, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(responseBody);
    return;
  }
  const agoraData = JSON.parse(responseBody);
  console.log("Agent started:", agoraData.agent_id || agoraData.id);

  jsonResponse(res, {
    appId: APP_ID, channel, token: userToken || APP_ID, uid: USER_UID,
    agentUid: AGENT_UID, agentVideoUid: AGENT_VIDEO_UID, agentRtmUid, agentId: agoraData.agent_id || agoraData.id, success: true,
  });
}

async function handleHangup(req, res) {
  const body = await readBody(req);
  if (!body.agentId) { jsonResponse(res, { error: "agentId is required" }, 400); return; }
  const authHeader = await buildAuthHeader(APP_ID, APP_CERTIFICATE);
  const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/agents/${body.agentId}/leave`;
  const agoraRes = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: authHeader } });
  const data = await agoraRes.text();
  console.log("Hangup:", body.agentId, "status:", agoraRes.status);
  res.writeHead(agoraRes.status, { ...corsHeaders, "Content-Type": "application/json" });
  res.end(data);
}

// ---- Router ----

console.log("Starting avatar test server on http://localhost:3001");
console.log(`APP_ID: ${APP_ID}`);
console.log(`APP_CERTIFICATE: ${APP_CERTIFICATE ? APP_CERTIFICATE.slice(0, 8) + "..." : "(empty)"}`);
console.log(`AVATAR_VENDOR: ${AVATAR_VENDOR}`);
console.log(`AVATAR_ID: ${AVATAR_ID || "(empty)"}`);

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost:3001").pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(200, corsHeaders);
    res.end("ok");
    return;
  }

  console.log(`→ ${req.method} ${path}`);

  try {
    if (path === "/functions/v1/health") return await handleHealth(req, res);
    if (path === "/functions/v1/check-env") return await handleCheckEnv(req, res);
    if (path === "/functions/v1/start-video-agent") return await handleStartVideoAgent(req, res);
    if (path === "/functions/v1/hangup-agent") return await handleHangup(req, res);
    jsonResponse(res, { error: `unknown function: ${path}` }, 404);
  } catch (err) {
    console.error("Error:", err);
    jsonResponse(res, { error: err.message, success: false }, 500);
  }
});

server.listen(3001, () => {
  console.log("Listening on http://localhost:3001");
});
