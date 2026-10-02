import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());



const GUILD_ID = process.env.GUILD_ID;
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;

// ===== КЭШ =====
const CACHE_TTL_MS = 60_000; // 60 сек
let cachedEvents = null;
let cachedAt = 0;

// ===== СТАТЫ (движок интереса + базовые числа из Discord) =====
// interests[id] = { baseGoing, baseInterested, going, interested }
// base* — числа из Discord (user_count / interested_user_count)
// going/interested — локальные голоса через /interest
const interests = {};

function ensureStats(id, baseGoing = 0, baseInterested = 0) {
  if (!interests[id]) {
    interests[id] = { baseGoing: 0, baseInterested: 0, going: 0, interested: 0 };
  }
  if (baseGoing || baseInterested) {
    interests[id].baseGoing = baseGoing;
    interests[id].baseInterested = baseInterested;
  }
  return interests[id];
}

function getStatsTotals(id, baseGoing = 0, baseInterested = 0) {
  const s = ensureStats(id, baseGoing, baseInterested);
  return {
    going: s.baseGoing + s.going,
    interested: s.baseInterested + s.interested,
  };
}

// ---------- Тип события по хэштегам ----------
function detectType(name, description) {
  const text = `${name}\n${description || ""}`.toUpperCase();

  if (text.includes("#IRL")) return "irl";
  if (text.includes("#VR") || text.includes("#VIRTUAL")) return "virtual";
  if (text.includes("#RADIO")) return "radio";

  return "other";
}

// ---------- Лейблы для ссылок ----------
function labelForUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube";
    if (host.includes("twitch.tv")) return "Twitch";
    if (host.includes("spotify.com")) return "Spotify";
    if (host.includes("soundcloud.com")) return "SoundCloud";
    if (host.includes("mixcloud.com")) return "Mixcloud";
    if (host.includes("bandcamp.com")) return "Bandcamp";
    if (host.includes("tiktok.com")) return "TikTok";
    if (host.includes("facebook.com")) return "Facebook";
    if (host.includes("instagram.com")) return "Instagram";
    if (
      host.includes("vrchat.com") ||
      host.includes("vrc.group")
      ) return "VRChat";


    // твои радио-домены
    if (
      host.includes("hpsbassline.club") ||
      host.includes("azura.hpsbassline.club") ||
      host.includes("radio")
    ) {
      return "Radio";
    }

    return host.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

// ---------- Вытаскиваем ссылки и хэштеги ----------
function extractLinksTags(description) {
  if (!description) return { links: [], tags: [] };

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const links = [];
  const matches = description.match(urlRegex) || [];

  for (const m of matches) {
    links.push({ url: m, label: labelForUrl(m) });
  }

  const tagMatches = [...description.matchAll(/#(\w+)/g)];
  const tags = tagMatches
    .map((m) => m[1].toUpperCase())
    .filter((t) => !["IRL", "VR", "VIRTUAL", "RADIO"].includes(t));

  return { links, tags };
}

// ---------- Discord timestamp конвертер ----------
// Парсит <t:TIMESTAMP:F> форматы в читаемые даты
// F = f, F, d, D, t, T, R
const DISCORD_TIMESTAMP_REGEX = /<t:(-?\d+)(?::([fdDtTR]))?>/g;

const discordFormatLabels = {
  t: "Short Time",
  T: "Long Time",
  d: "Short Date",
  D: "Long Date",
  f: "Short Date/Time",
  F: "Long Date/Time",
  R: "Relative"
};

function parseDiscordTimestamps(text) {
  if (!text) return { text, timestamps: [] };

  const timestamps = [];
  const parsed = text.replace(DISCORD_TIMESTAMP_REGEX, (match, unix, format) => {
    const unixMs = parseInt(unix, 10) * 1000;
    if (isNaN(unixMs)) return match;

    const date = new Date(unixMs);
    if (format && format.toLowerCase() === 'r') {
      const diff = date - Date.now();
      const absDiff = Math.abs(diff);
      const isFuture = diff > 0;
      
      const seconds = Math.floor(absDiff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const weeks = Math.floor(days / 7);
      const months = Math.floor(days / 30);
      const years = Math.floor(days / 365);

      let relative;
      if (years > 0) relative = `${years} year${years > 1 ? 's' : ''}`;
      else if (months > 0) relative = `${months} month${months > 1 ? 's' : ''}`;
      else if (weeks > 0) relative = `${weeks} week${weeks > 1 ? 's' : ''}`;
      else if (days > 0) relative = `${days} day${days > 1 ? 's' : ''}`;
      else if (hours > 0) relative = `${hours} hour${hours > 1 ? 's' : ''}`;
      else if (minutes > 0) relative = `${minutes} minute${minutes > 1 ? 's' : ''}`;
      else relative = `${seconds} second${seconds !== 1 ? 's' : ''}`;

      return isFuture ? `in ${relative}` : `${relative} ago`;
    }

    const formatDate = (opts) => date.toLocaleString(undefined, opts);
    
    const formatMap = {
      t: { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' },
      T: { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' },
      d: { year: 'numeric', month: '2-digit', day: '2-digit' },
      D: { year: 'numeric', month: 'long', day: 'numeric' },
      f: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
      F: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    };

    return formatMap[format] ? formatDate(formatMap[format]) : formatDate(formatMap['f']);
  });

  return { text: parsed, timestamps };
}

// ---------- Статус события ----------
// Логика: только upcoming и live
function getStatus(startIso, endIso, discordStatus) {
  const now = Date.now();
  const startMs = startIso ? new Date(startIso).getTime() : null;
  const endMs = endIso ? new Date(endIso).getTime() : null;

  // Discord говорит ACTIVE (запущено) → live
  if (discordStatus === 2) {
    return { code: "live", label: "live" };
  }

  // Отменено (3) или завершено (4) → upcoming
  if (discordStatus === 3 || discordStatus === 4) {
    return { code: "upcoming", label: "upcoming" };
  }

  // Нет времени начала → upcoming
  if (!startMs || Number.isNaN(startMs)) {
    return { code: "upcoming", label: "upcoming" };
  }

  // Определяем конец события (если не указан, то +3 часа от начала)
  const eventEnd = !endMs || Number.isNaN(endMs) ? startMs + 3 * 3600_000 : endMs;

  // Если сейчас между началом и концом → live
  if (now >= startMs && now <= eventEnd) {
    return { code: "live", label: "live" };
  }

  // Иначе → upcoming
  return { code: "upcoming", label: "upcoming" };
}

// ---------- Обновить статус события (свежий расчет) ----------
function updateEventStatusFresh(event) {
  const { _discordStatus, ...rest } = event;
  return {
    ...rest,
    status: getStatus(event.start, event.end, _discordStatus),
  };
}

// ---------- Тип сущности Discord ----------
const ENTITY_TYPES = {
  1: "stage",
  2: "voice",
  3: "external",
};

// ---------- Общая нормализация ивента ----------
// Сохраняем ВСЕ полезные данные из Discord + вычисленные поля.
function normalizeEvent(e) {
  const type = detectType(e.name, e.description);
  const { links, tags } = extractLinksTags(e.description || "");
  const status = getStatus(e.scheduled_start_time, e.scheduled_end_time, e.status);

  const startMs = e.scheduled_start_time
    ? new Date(e.scheduled_start_time).getTime()
    : null;
  const endMs = e.scheduled_end_time
    ? new Date(e.scheduled_end_time).getTime()
    : null;

  const durationMinutes =
    startMs && endMs ? Math.round((endMs - startMs) / 60000) : null;

  let imageUrl = null;
  if (e.image) {
    if (typeof e.image === "string" && e.image.startsWith("http")) {
      imageUrl = e.image;
    } else {
      imageUrl = `https://cdn.discordapp.com/guild-events/${e.id}/${e.image}.webp?size=1024`;
    }
  }

  const parsedDescription = parseDiscordTimestamps(e.description || "");
  const parsedName = parseDiscordTimestamps(e.name);

  const discordLink = GUILD_ID
    ? `https://discord.com/events/${GUILD_ID}/${e.id}`
    : "#";

  const creator = e.creator
    ? {
        id: e.creator.id,
        username: e.creator.username,
        globalName: e.creator.global_name || null,
        avatar: e.creator.avatar
          ? `https://cdn.discordapp.com/avatars/${e.creator.id}/${e.creator.avatar}.png`
          : null,
      }
    : null;

  return {
    // --- базовые/вычисленные поля (обратная совместимость) ---
    id: e.id,
    name: parsedName.text,
    description: parsedDescription.text,
    descriptionRaw: e.description || null,
    image: imageUrl,
    start: e.scheduled_start_time,
    end: e.scheduled_end_time,
    startUnix: startMs,
    endUnix: endMs,
    durationMinutes,
    type,
    location: e.entity_metadata?.location || null,
    link: discordLink,
    links,
    tags,
    status,
    stats: getStatsTotals(e.id, e.user_count || 0, e.interested_user_count || 0),
    _discordStatus: e.status,

    // --- полные данные из Discord ---
    guildId: e.guild_id || null,
    channelId: e.channel_id || null,
    creatorId: e.creator_id || null,
    creator,
    host: creator ? creator.globalName || creator.username : null,
    entityType: e.entity_type || null,
    entityTypeLabel: e.entity_type ? ENTITY_TYPES[e.entity_type] || "unknown" : null,
    entityId: e.entity_id || null,
    entityMetadata: e.entity_metadata || null,
    privacyLevel: e.privacy_level ?? null,
    userCount: e.user_count || 0,
    interestedCount: e.interested_user_count || 0,
    recurringRule: e.recurring_rule || null,
  };
}

// ---------- МОК для локальных тестов (если нет токена/ID) ----------
function getMockEvents() {
  const now = Date.now();

  const mock = [
    {
      id: "1",
      name: "Street Session: Downtown Vibes #IRL #DNB",
      description:
        "Open DJ set in the city center.\n#IRL #DNB\nhttps://hpsbassline.club/",
      scheduled_start_time: new Date(now + 30 * 60_000).toISOString(),
      scheduled_end_time: new Date(now + 2 * 3600_000).toISOString(),
      entity_metadata: { location: "Haapsalu" },
      image:
        "https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg",
    },
    {
      id: "2",
      name: "VR Club Showcase #VR #HARDCORE",
      description:
        "Immersive VR experience.\n#VR #HARDCORE\nhttps://twitch.tv/hps_bassline",
      scheduled_start_time: new Date(now + 3 * 3600_000).toISOString(),
      scheduled_end_time: null,
      entity_metadata: { location: "VRChat" },
      image:
        "https://images.pexels.com/photos/3404200/pexels-photo-3404200.jpeg",
    },
    {
      id: "3",
      name: "Midnight Stream <t:1776765840:f> #VIRTUAL",
      description:
        "Live stream event!\nFormat examples:\n" +
        "<t:1776765840:t> - Short time\n" +
        "<t:1776765840:d> - Short date\n" +
        "<t:1776765840:f> - Full date/time\n" +
        "<t:1776765840:R> - Relative\n#VIRTUAL",
      scheduled_start_time: new Date(now + 5 * 3600_000).toISOString(),
      scheduled_end_time: null,
      entity_metadata: { location: "Twitch" },
      image: null,
    },
  ];

  const mapped = mock.map(normalizeEvent);

  mapped.sort((a, b) => {
    if (a.startUnix == null && b.startUnix == null) return 0;
    if (a.startUnix == null) return 1;
    if (b.startUnix == null) return -1;
    return a.startUnix - b.startUnix;
  });

  return mapped;
}

// ---------- Получить ивенты из Discord + кэш ----------
async function fetchDiscordEvents({ ignoreCache = false } = {}) {
  if (!GUILD_ID || !DISCORD_TOKEN) {
    console.warn("No GUILD_ID or DISCORD_BOT_TOKEN — using mock data");
    return getMockEvents();
  }

  const now = Date.now();

  if (!ignoreCache && cachedEvents && now - cachedAt < CACHE_TTL_MS) {
    return cachedEvents;
  }

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${GUILD_ID}/scheduled-events`,
    {
      headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
    }
  );

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    console.warn("Discord API rate limited:", data);

    if (cachedEvents) {
      console.log("Returning cached events from cache");
      return cachedEvents;
    }

    throw new Error("Rate limited by Discord and no cache available");
  }

  if (!res.ok) {
    console.error("Discord API error:", await res.text());
    throw new Error("Failed to fetch events from Discord");
  }

  const events = await res.json();
  const mapped = events.map(normalizeEvent);

  mapped.sort((a, b) => {
    if (a.startUnix == null && b.startUnix == null) return 0;
    if (a.startUnix == null) return 1;
    if (b.startUnix == null) return -1;
    return a.startUnix - b.startUnix;
  });

  cachedEvents = mapped;
  cachedAt = Date.now();
  return mapped;
}

// ---------- API: список ивентов с фильтрами ----------
app.get("/api/events", async (req, res) => {
  const filterType = (req.query.type || "").toLowerCase(); // irl / virtual / radio / other
  const filterStatus = (req.query.status || "").toLowerCase(); // live / upcoming / past
  const ignoreCache = req.query.force === "1";
  const sort = (req.query.sort || "start_asc").toLowerCase(); // start_asc | start_desc
  const limit = parseInt(req.query.limit, 10);

  try {
    let events = await fetchDiscordEvents({ ignoreCache });
    
    // Пересчитываем статус для каждого события
    events = events.map(updateEventStatusFresh);

    // фильтр по типу (#IRL / #VR / #RADIO / other)
    if (filterType) {
      events = events.filter((e) => e.type === filterType);
    }

    // фильтр по статусу
    if (filterStatus === "live") {
      events = events.filter((e) => e.status.code === "live");
    } else if (filterStatus === "upcoming") {
      events = events.filter((e) => e.status.code === "upcoming");
    } else {
      // По умолчанию: показываем всё (только Будет и Проходит)
      // Прошедшие события всё равно больше не существуют в новой логике
    }

    // сортировка
    if (sort === "start_desc") {
      events = [...events].sort((a, b) => (b.startUnix || 0) - (a.startUnix || 0));
    } else {
      events = [...events].sort((a, b) => (a.startUnix || 0) - (b.startUnix || 0));
    }

    // лимит
    if (!Number.isNaN(limit) && limit > 0) {
      events = events.slice(0, limit);
    }

    res.json(events);
  } catch (err) {
    console.error(err);

    if (cachedEvents) {
      console.log("Returning cached events due to error (with filters)");

      let events = cachedEvents.map(updateEventStatusFresh);

      if (filterType) {
        events = events.filter((e) => e.type === filterType);
      }

      if (filterStatus === "live") {
        events = events.filter((e) => e.status.code === "live");
      } else if (filterStatus === "upcoming") {
        events = events.filter((e) => e.status.code === "upcoming");
      } else {
        // По умолчанию: показываем всё
      }

      if (sort === "start_desc") {
        events = [...events].sort(
          (a, b) => (b.startUnix || 0) - (a.startUnix || 0)
        );
      } else {
        events = [...events].sort(
          (a, b) => (a.startUnix || 0) - (b.startUnix || 0)
        );
      }

      if (!Number.isNaN(limit) && limit > 0) {
        events = events.slice(0, limit);
      }

      return res.json(events);
    }

    res.status(500).json({ error: "Failed to load events" });
  }
});

// ---------- API: только live-ивенты ----------
app.get("/api/events/live", async (req, res) => {
  try {
    const events = await fetchDiscordEvents({ ignoreCache: false });
    const live = events
      .map(updateEventStatusFresh)
      .filter((e) => e.status.code === "live");
    res.json(live);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load live events" });
  }
});

// ---------- API: один ивент по ID ----------
app.get("/api/events/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const events = await fetchDiscordEvents({ ignoreCache: false });
    const ev = events.find((e) => e.id === id);

    if (!ev) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json(updateEventStatusFresh(ev));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load event" });
  }
});

// ---------- API: интерес / going ----------
app.post("/api/events/:id/interest", (req, res) => {
  const id = req.params.id;
  const { action } = req.body || {};

  if (action !== "going" && action !== "interested") {
    return res.status(400).json({ error: "Invalid action" });
  }

  const s = ensureStats(id);
  s[action] += 1;

  return res.json({
    going: s.baseGoing + s.going,
    interested: s.baseInterested + s.interested,
  });
});

// ---------- Статика ----------
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Events API running at http://localhost:${PORT}`);
});
