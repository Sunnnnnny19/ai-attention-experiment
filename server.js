import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const ALLOW_MOCK_AI = String(process.env.ALLOW_MOCK_AI || "true").toLowerCase() === "true";

const LLM_PROVIDER = (process.env.LLM_PROVIDER || "deepseek").toLowerCase();
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const ACTIVE_MODEL = LLM_PROVIDER === "deepseek" ? DEEPSEEK_MODEL : OPENAI_MODEL;
const ADMIN_EXPORT_KEY = process.env.ADMIN_EXPORT_KEY || "";

const EXPERIMENT_SYSTEM_PROMPT =
  process.env.EXPERIMENT_SYSTEM_PROMPT ||
  "You are the AI assistant embedded in a user attention experiment. Help the participant complete the task clearly and neutrally. Do not ask for personal sensitive data. Keep answers concise.";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const llmClient =
  LLM_PROVIDER === "deepseek"
    ? (
        process.env.DEEPSEEK_API_KEY
          ? new OpenAI({
              apiKey: process.env.DEEPSEEK_API_KEY,
              baseURL: DEEPSEEK_BASE_URL
            })
          : null
      )
    : (
        process.env.OPENAI_API_KEY
          ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
          : null
      );

const supabase = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false }
    })
  : null;

const TABLES = {
  participants: "participants.jsonl",
  sessions: "sessions.jsonl",
  events: "events.jsonl",
  chats: "chats.jsonl",
  surveys: "surveys.jsonl",
  reviews: "reviews.jsonl",
  media_records: "media_records.jsonl"
};


const MEDIA_BUCKET = process.env.MEDIA_BUCKET || "media-recordings";
const MEDIA_MAX_UPLOAD_MB = Number(process.env.MEDIA_MAX_UPLOAD_MB || 80);

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MEDIA_MAX_UPLOAD_MB * 1024 * 1024
  }
});

function mediaExtFromMime(mime) {
  const value = String(mime || "").toLowerCase();
  if (value.includes("webm")) return "webm";
  if (value.includes("mp4")) return "mp4";
  if (value.includes("ogg")) return "ogg";
  if (value.includes("mpeg")) return "mp3";
  if (value.includes("wav")) return "wav";
  return "bin";
}

function sanitizePathPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeRecord(record) {
  return safeJson({
    server_time: nowIso(),
    ...record
  });
}

function appendJsonl(table, record) {
  if (!TABLES[table]) throw new Error(`Unknown table: ${table}`);
  const fp = path.join(DATA_DIR, TABLES[table]);
  fs.appendFileSync(fp, JSON.stringify(normalizeRecord(record)) + "\n", "utf8");
}

async function insertRow(table, record) {
  if (!TABLES[table]) throw new Error(`Unknown table: ${table}`);

  const row = normalizeRecord(record);

  if (!USE_SUPABASE) {
    appendJsonl(table, row);
    return row;
  }

  const { error } = await supabase.from(table).insert(row);
  if (error) {
    console.error(`Supabase insert error on ${table}:`, error);
    throw error;
  }

  return row;
}

async function insertRows(table, records) {
  if (!TABLES[table]) throw new Error(`Unknown table: ${table}`);

  const rows = records.map(normalizeRecord);
  if (rows.length === 0) return rows;

  if (!USE_SUPABASE) {
    for (const row of rows) appendJsonl(table, row);
    return rows;
  }

  const { error } = await supabase.from(table).insert(rows);
  if (error) {
    console.error(`Supabase batch insert error on ${table}:`, error);
    throw error;
  }

  return rows;
}
function readJsonl(table) {
  if (!TABLES[table]) throw new Error(`Unknown table: ${table}`);
  const fp = path.join(DATA_DIR, TABLES[table]);
  if (!fs.existsSync(fp)) return [];

  return fs
    .readFileSync(fp, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parse_error: line };
      }
    });
}

async function readRows(table) {
  if (!TABLES[table]) throw new Error(`Unknown table: ${table}`);

  if (!USE_SUPABASE) return readJsonl(table);

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order("id", { ascending: true })
    .limit(50000);

  if (error) throw error;
  return data || [];
}

function flattenForCsv(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;

    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenForCsv(v, key, out);
    } else if (Array.isArray(v)) {
      out[key] = JSON.stringify(v);
    } else {
      out[key] = v ?? "";
    }
  }
  return out;
}

function toCsv(rows) {
  const flatRows = rows.map((r) => flattenForCsv(r));
  const headers = Array.from(new Set(flatRows.flatMap((r) => Object.keys(r))));

  const esc = (val) => {
    const s = String(val ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  return [
    headers.join(","),
    ...flatRows.map((r) => headers.map((h) => esc(r[h])).join(","))
  ].join("\n");
}

function requireSession(req, res, next) {
  const { participant_id, session_id } = req.body || {};
  if (!participant_id || !session_id) {
    return res.status(400).json({
      error: "participant_id and session_id are required"
    });
  }
  next();
}

function createMockAnswer(messages) {
  const last = messages?.filter((m) => m.role === "user").at(-1)?.content || "";
  return `【模拟AI回复】我已收到你的问题：“${last.slice(0, 80)}”。在正式实验中，这里会由OpenAI模型生成回复。`;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    time: nowIso(),
    provider: LLM_PROVIDER,
    model: ACTIVE_MODEL,
    mock_ai: ALLOW_MOCK_AI,
    data_store: USE_SUPABASE ? "supabase" : "local_jsonl",
    supabase_connected: USE_SUPABASE,
    data_dir: USE_SUPABASE ? null : DATA_DIR
  });
});
app.post("/api/login", async (req, res) => {
  try {
    const participant_id = req.body?.participant_id || `P_${uuidv4()}`;
    const session_id = `S_${uuidv4()}`;
    const group_condition =
      req.body?.group_condition ||
      ["control", "ai_assist"][Math.floor(Math.random() * 2)];

    const participant = {
      participant_id,
      login_code: req.body?.login_code || null,
      group_condition,
      consent: false,
      user_agent: req.headers["user-agent"] || "",
      client_meta: req.body?.client_meta || {}
    };

    const session = {
      session_id,
      participant_id,
      group_condition,
      start_time: nowIso(),
      completion_status: "started"
    };

    await insertRow("participants", participant);
    await insertRow("sessions", session);

    res.json({ participant_id, session_id, group_condition });
  } catch (err) {
    res.status(500).json({
      error: "Login failed",
      detail: err?.message || String(err)
    });
  }
});

app.post("/api/consent", requireSession, async (req, res) => {
  try {
    await insertRow("events", {
      participant_id: req.body.participant_id,
      session_id: req.body.session_id,
      event_type: "consent",
      event_target: "consent_form",
      event_value: req.body.consent === true ? "accepted" : "declined",
      payload: { consent: req.body.consent === true }
    });

    if (USE_SUPABASE && req.body.consent === true) {
      await supabase
        .from("participants")
        .update({ consent: true })
        .eq("participant_id", req.body.participant_id);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: "Consent save failed",
      detail: err?.message || String(err)
    });
  }
});

app.post("/api/event", requireSession, async (req, res) => {
  try {
    await insertRow("events", {
      participant_id: req.body.participant_id,
      session_id: req.body.session_id,
      event_type: req.body.event_type || "unknown",
      event_target: req.body.event_target || "",
      event_value: req.body.event_value == null ? null : String(req.body.event_value),
      timestamp_client: req.body.timestamp_client || null,
      page: req.body.page || null,
      payload: req.body.payload || {}
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: "Event save failed",
      detail: err?.message || String(err)
    });
  }
});

app.post("/api/batch-events", requireSession, async (req, res) => {
  try {
    const events = Array.isArray(req.body.events) ? req.body.events : [];

    const rows = events.map((ev) => ({
      participant_id: req.body.participant_id,
      session_id: req.body.session_id,
      event_type: ev.event_type || "unknown",
      event_target: ev.event_target || "",
      event_value: ev.event_value == null ? null : String(ev.event_value),
      timestamp_client: ev.timestamp_client || null,
      page: ev.page || null,
      payload: ev.payload || {}
    }));

    await insertRows("events", rows);

    res.json({ ok: true, count: rows.length });
  } catch (err) {
    res.status(500).json({
      error: "Batch events save failed",
      detail: err?.message || String(err)
    });
  }
});
app.post("/api/chat", requireSession, async (req, res) => {
  const started = Date.now();
  const { participant_id, session_id } = req.body;
  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-12) : [];
  const turn_id = req.body.turn_id || null;
  const client_payload = req.body.payload || {};
  const userPrompt = messages.filter((m) => m.role === "user").at(-1)?.content || "";

  try {
    let answer = "";
    let usage = null;
    let raw_id = null;

    if (ALLOW_MOCK_AI || !llmClient) {
      answer = createMockAnswer(messages);
      usage = { mock: true };
    } else {
      const chatMessages = [
        { role: "system", content: EXPERIMENT_SYSTEM_PROMPT },
        ...messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content || "")
        }))
      ];

      const response = await llmClient.chat.completions.create({
        model: ACTIVE_MODEL,
        messages: chatMessages,
        temperature: 0.7,
        max_tokens: 700
      });

      answer = response.choices?.[0]?.message?.content || "";
      usage = response.usage || null;
      raw_id = response.id || null;
    }

    const latency_ms = Date.now() - started;

    await insertRow("chats", {
      participant_id,
      session_id,
      turn_id,
      model_name: ACTIVE_MODEL,
      mock_ai: ALLOW_MOCK_AI || !llmClient,
      user_prompt: userPrompt,
      model_response: answer,
      latency_ms,
      usage,
      raw_response_id: raw_id,
      client_payload
    });

    res.json({ ok: true, answer, latency_ms, usage });
  } catch (err) {
    try {
      await insertRow("chats", {
        participant_id,
        session_id,
        turn_id,
        model_name: ACTIVE_MODEL,
        user_prompt: userPrompt,
        error: err?.message || String(err),
        client_payload
      });
    } catch {}

    res.status(500).json({
      error: "AI request failed",
      detail: err?.message || String(err)
    });
  }
});

app.post("/api/survey", requireSession, async (req, res) => {
  try {
    await insertRow("surveys", {
      participant_id: req.body.participant_id,
      session_id: req.body.session_id,
      survey_name: req.body.survey_name || "unknown",
      answers: req.body.answers || {},
      meta: req.body.meta || {}
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: "Survey save failed",
      detail: err?.message || String(err)
    });
  }
});

app.post("/api/review", requireSession, async (req, res) => {
  try {
    const review_text = String(req.body.review_text || "");

    await insertRow("reviews", {
      participant_id: req.body.participant_id,
      session_id: req.body.session_id,
      review_text,
      word_count: review_text.trim()
        ? review_text.trim().split(/\s+/).length
        : 0,
      char_count: review_text.length,
      meta: req.body.meta || {}
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: "Review save failed",
      detail: err?.message || String(err)
    });
  }
});

app.post("/api/finish", requireSession, async (req, res) => {
  try {
    await insertRow("sessions", {
      participant_id: req.body.participant_id,
      session_id: req.body.session_id,
      end_time: nowIso(),
      completion_status: "completed",
      total_duration_ms: req.body.total_duration_ms || null,
      payload: req.body.payload || {}
    });

    await insertRow("events", {
      participant_id: req.body.participant_id,
      session_id: req.body.session_id,
      event_type: "session_finish",
      event_target: "experiment",
      payload: req.body.payload || {}
    });

    if (USE_SUPABASE) {
      await supabase
        .from("sessions")
        .update({
          end_time: nowIso(),
          completion_status: "completed",
          total_duration_ms: req.body.total_duration_ms || null,
          payload: req.body.payload || {}
        })
        .eq("session_id", req.body.session_id);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: "Finish save failed",
      detail: err?.message || String(err)
    });
  }
});

app.post("/api/media/upload", mediaUpload.single("media"), async (req, res) => {
  try {
    const participant_id = req.body.participant_id;
    const session_id = req.body.session_id;

    if (!participant_id || !session_id) {
      return res.status(400).json({
        error: "participant_id and session_id are required"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "No media file uploaded. Use form field name: media"
      });
    }

    const media_type = req.body.media_type || "unknown";
    const recording_stage = req.body.recording_stage || "media_test";
    const duration_ms = req.body.duration_ms ? Number(req.body.duration_ms) : null;
    const started_at = req.body.started_at || null;
    const ended_at = req.body.ended_at || null;

    const ext = mediaExtFromMime(req.file.mimetype);
    const pid = sanitizePathPart(participant_id);
    const sid = sanitizePathPart(session_id);
    const stage = sanitizePathPart(recording_stage);
    const filename = `${Date.now()}_${sanitizePathPart(media_type)}.${ext}`;
    const storage_path = `${pid}/${sid}/${stage}/${filename}`;

    if (USE_SUPABASE) {
      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(storage_path, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) {
        console.error("Supabase media upload error:", uploadError);
        throw uploadError;
      }
    } else {
      const mediaDir = path.join(DATA_DIR, "media", pid, sid, stage);
      fs.mkdirSync(mediaDir, { recursive: true });
      fs.writeFileSync(path.join(mediaDir, filename), req.file.buffer);
    }

    const record = {
      participant_id,
      session_id,
      media_type,
      recording_stage,
      mime_type: req.file.mimetype,
      storage_bucket: USE_SUPABASE ? MEDIA_BUCKET : "local",
      storage_path,
      file_size_bytes: req.file.size,
      duration_ms,
      started_at,
      ended_at,
      meta: {
        original_name: req.file.originalname || null,
        user_agent: req.headers["user-agent"] || "",
        source: "media-test-page"
      }
    };

    await insertRow("media_records", record);

    await insertRow("events", {
      participant_id,
      session_id,
      event_type: "media_upload",
      event_target: recording_stage,
      event_value: String(req.file.size),
      payload: {
        media_type,
        mime_type: req.file.mimetype,
        storage_bucket: record.storage_bucket,
        storage_path,
        duration_ms
      }
    });

    res.json({
      ok: true,
      storage_bucket: record.storage_bucket,
      storage_path,
      file_size_bytes: req.file.size,
      duration_ms
    });
  } catch (err) {
    res.status(500).json({
      error: "Media upload failed",
      detail: err?.message || String(err)
    });
  }
});

app.get("/api/export/:table", async (req, res) => {
  try {
    if (!ADMIN_EXPORT_KEY || req.query.key !== ADMIN_EXPORT_KEY) {
      return res.status(403).json({ error: "Forbidden: invalid export key" });
    }

    const table = req.params.table;
    if (!TABLES[table]) {
      return res.status(404).json({ error: "Unknown table" });
    }

    const rows = await readRows(table);
    const format = String(req.query.format || "jsonl").toLowerCase();

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${table}.csv"`);
      return res.send(toCsv(rows));
    }

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${table}.jsonl"`);
    return res.send(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  } catch (err) {
    res.status(500).json({
      error: "Export failed",
      detail: err?.message || String(err)
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Attention Experiment MVP running at http://localhost:${PORT}`);
  console.log(`LLM provider: ${LLM_PROVIDER}`);
  console.log(`Mock AI: ${ALLOW_MOCK_AI}`);
  console.log(`Data store: ${USE_SUPABASE ? "Supabase" : "Local JSONL"}`);
  if (!USE_SUPABASE) {
    console.log(`Data dir: ${DATA_DIR}`);
  }
});
