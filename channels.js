// backend/routes/channels.js
// FIXED: Generates a FRESH play_token every time by calling create_link on the MAG server

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const axios = require('axios');
const Playlist = require('../models/Playlist');

// ─── helpers ─────────────────────────────────────────────────────────────────

const MAG_USER_AGENT =
  'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';

function magHeaders(macAddress, token, baseUrl) {
  const headers = {
    'User-Agent': MAG_USER_AGENT,
    'X-User-Agent': 'Model: MAG250; Link: WiFi',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    Connection: 'keep-alive',
    Cookie: `mac=${macAddress}; stb_lang=en; timezone=GMT`,
  };
  if (token && token !== 'no_token_required') {
    headers.Authorization = `Bearer ${token}`;
    headers.Cookie += `; token=${token}`;
  }
  try {
    const u = new URL(baseUrl);
    headers.Referer = `${u.protocol}//${u.host}/c/`;
  } catch (_) {}
  return headers;
}

function parseMAGResponse(data) {
  if (typeof data !== 'string') return data;
  const m = data.match(/^\w+\(({.*})\);?$/s) || data.match(/({.*})/s);
  if (m) {
    try { return JSON.parse(m[1]); } catch (_) {}
  }
  try { return JSON.parse(data); } catch (_) {}
  return { js: data };
}

const API_PATHS = [
  '/server/load.php',
  '/c/server/load.php',
  '/stalker_portal/server/load.php',
  '/portal/server/load.php',
];

async function magHandshake(baseUrl, macAddress) {
  for (const path of API_PATHS) {
    try {
      const res = await axios.get(`${baseUrl}${path}`, {
        params: { type: 'stb', action: 'handshake', token: '', JsHttpRequest: '1-xml' },
        headers: magHeaders(macAddress, null, baseUrl),
        timeout: 8000,
      });
      const d = parseMAGResponse(res.data);
      const token = d?.js?.token || d?.token;
      if (token) {
        console.log(`✅ MAG handshake OK on ${path}, token: ${token}`);
        return { token, apiPath: path };
      }
    } catch (_) {}
  }
  console.log('⚠️  MAG handshake failed – continuing without token');
  return { token: null, apiPath: '/server/load.php' };
}

async function magCreateLink(baseUrl, apiPath, macAddress, token, cmd) {
  try {
    const res = await axios.get(`${baseUrl}${apiPath}`, {
      params: {
        type: 'itv',
        action: 'create_link',
        cmd,
        series: 0,
        forced_storage: 0,
        disable_ad: 0,
        JsHttpRequest: '1-xml',
        ...(token && { token }),
      },
      headers: magHeaders(macAddress, token, baseUrl),
      timeout: 10000,
    });
    const d = parseMAGResponse(res.data);
    const freshCmd = d?.js?.cmd || d?.js?.url;
    console.log('🔗 create_link response cmd:', freshCmd);
    return freshCmd || null;
  } catch (err) {
    console.error('create_link error:', err.message);
    return null;
  }
}

function extractUrl(raw) {
  if (!raw) return null;
  // Strip ffmpeg / ffrt prefix
  const cleaned = raw.replace(/^ff(mpeg|rt)\s+/i, '').replace(/[\t\n\r]/g, '').trim();
  const m = cleaned.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

// ─── route ───────────────────────────────────────────────────────────────────

router.post('/get-stream', auth, async (req, res) => {
  try {
    const { playlistId, channelId, cmd } = req.body;

    console.log('🎬 get-stream called for channelId:', channelId);
    console.log('   cmd:', cmd);

    // ── 1. Look up the playlist to get type + MAG credentials ──────────────
    const playlist = await Playlist.findById(playlistId).lean();

    if (!playlist) {
      console.warn('⚠️  Playlist not found:', playlistId);
    }

    const isMag =
      playlist && (playlist.type === 'mag' || playlist.type === 'stalker');

    // ── 2. For MAG/Stalker: get a FRESH token via create_link ───────────────
    if (isMag && playlist.sourceUrl && playlist.macAddress) {
      console.log('📡 MAG playlist detected – generating fresh stream link...');

      const baseUrl = playlist.sourceUrl.replace(/\/+$/, '');
      const macAddress = playlist.macAddress;

      // Handshake → fresh auth token
      const { token, apiPath } = await magHandshake(baseUrl, macAddress);

      // The cmd stored in the Channel document (e.g. "ffmpeg http://…/play/live.php?…&stream=1134458")
      // We only need the raw cmd value (not the full URL) for create_link
      // MAG create_link expects the cmd exactly as stored in the channel list
      const rawCmd = cmd; // e.g. "ffmpeg http://host/play/live.php?mac=…&stream=ID&extension=ts"

      // Try create_link with the full cmd first
      let freshCmd = await magCreateLink(baseUrl, apiPath, macAddress, token, rawCmd);

      // If that didn't work, try with just the stream path
      if (!freshCmd) {
        const streamIdMatch = rawCmd.match(/stream=(\d+)/);
        if (streamIdMatch) {
          const altCmd = `ffmpeg http://${new URL(extractUrl(rawCmd) || baseUrl).host}/play/live.php?mac=${macAddress}&stream=${streamIdMatch[1]}&extension=ts`;
          freshCmd = await magCreateLink(baseUrl, apiPath, macAddress, token, altCmd);
        }
      }

      if (freshCmd) {
        const freshUrl = extractUrl(freshCmd);
        if (freshUrl) {
          console.log('✅ Fresh MAG URL:', freshUrl);
          return res.json({ success: true, url: freshUrl });
        }
      }

      console.warn('⚠️  create_link failed – falling back to stored cmd URL');
    }

    // ── 3. Fallback: extract URL straight from the stored cmd ───────────────
    const fallbackUrl = extractUrl(cmd);

    if (!fallbackUrl) {
      return res.status(400).json({
        success: false,
        message: 'No valid URL found in cmd',
      });
    }

    console.log('ℹ️  Returning stored URL (may have stale token):', fallbackUrl);
    return res.json({ success: true, url: fallbackUrl });

  } catch (error) {
    console.error('Error in get-stream:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;