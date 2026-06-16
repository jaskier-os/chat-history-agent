/**
 * HistoryStore - read-only access to conversation NDJSON files and index.
 *
 * Loads index.json on startup and refreshes periodically.
 * Provides list, search, and get operations.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Fold a conversation's raw NDJSON events into client-facing turns. The
 * orchestrator persists a turn in two phases: a `turn` line (user half, written
 * at request start) and a later `turn_response` line (AI half) sharing the same
 * requestId. This merges them into one object preserving file order, so a turn
 * whose response has not arrived yet surfaces with response: null (a pending
 * turn the client renders as "thinking"). A `turn_response` with no preceding
 * `turn` becomes a standalone turn so the AI text is never dropped.
 *
 * Kept in sync with the orchestrator's chat-store.js mergeTurnEvents; this is a
 * separate service over the same on-disk format, so the logic is duplicated
 * rather than imported.
 * @param {object[]} events - parsed NDJSON lines in file order
 * @returns {object[]} merged turns in original order
 */
export function mergeTurnEvents(events) {
  const turns = [];
  const byRequestId = new Map();

  for (const e of events) {
    if (e.type === 'turn') {
      // Collapse a duplicate pending turn for the same requestId (transport
      // resend). The existing pending turn is the merge target; drop the dup.
      if (e.requestId && byRequestId.has(e.requestId)) {
        continue;
      }
      const turn = {
        type: 'turn',
        ts: e.ts,
        requestId: e.requestId,
        userText: e.userText ?? null,
        userImage: e.userImage ?? null,
        classification: e.classification ?? null,
        response: e.response ?? null,
        usage: e.usage ?? null,
        toolCalls: e.toolCalls ?? null
      };
      turns.push(turn);
      if (turn.response == null && turn.requestId) {
        byRequestId.set(turn.requestId, turn);
      }
    } else if (e.type === 'turn_response') {
      const pending = e.requestId ? byRequestId.get(e.requestId) : null;
      if (pending) {
        pending.ts = e.ts ?? pending.ts;
        pending.classification = e.classification ?? null;
        pending.response = e.response ?? null;
        pending.usage = e.usage ?? null;
        pending.toolCalls = e.toolCalls ?? null;
        byRequestId.delete(e.requestId);
      } else {
        turns.push({
          type: 'turn',
          ts: e.ts,
          requestId: e.requestId,
          userText: null,
          userImage: null,
          classification: e.classification ?? null,
          response: e.response ?? null,
          usage: e.usage ?? null,
          toolCalls: e.toolCalls ?? null
        });
      }
    }
  }

  return turns;
}

export class HistoryStore {
  /**
   * @param {string} dataDir - Root directory for chat history data
   * @param {number} [refreshIntervalMs=30000] - How often to reload index
   */
  constructor(dataDir, refreshIntervalMs = 30_000) {
    this.dataDir = dataDir;
    this.refreshIntervalMs = refreshIntervalMs;
    /** @type {Array<object>} */
    this.entries = [];
    this.refreshTimer = null;
  }

  async init() {
    await this.loadIndex();
    this.refreshTimer = setInterval(() => {
      this.loadIndex().catch(err => {
        console.error('[history-store] Index refresh failed:', err.message);
      });
    }, this.refreshIntervalMs);
  }

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async loadIndex() {
    const indexPath = path.join(this.dataDir, 'index.json');
    try {
      const raw = await fs.readFile(indexPath, 'utf-8');
      this.entries = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.entries = [];
      } else {
        console.error('[history-store] Failed to load index:', err.message);
      }
    }
  }

  /**
   * List conversations with optional filters.
   * @param {object} [filters]
   * @param {string} [filters.deviceType]
   * @param {string} [filters.since] - ISO timestamp
   * @param {number} [filters.limit=50]
   * @param {number} [filters.offset=0]
   * @returns {object}
   */
  listConversations(filters = {}) {
    let results = [...this.entries];

    if (filters.deviceType) {
      results = results.filter(e => e.deviceType === filters.deviceType);
    }

    if (filters.since) {
      const sinceDate = new Date(filters.since);
      results = results.filter(e => new Date(e.lastActivityAt) >= sinceDate);
    }

    // Sort by most recent activity
    results.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));

    const total = results.length;
    const offset = filters.offset || 0;
    const limit = filters.limit || 50;

    return {
      conversations: results.slice(offset, offset + limit),
      total,
      offset,
      limit
    };
  }

  /**
   * Search conversations by text query across NDJSON files.
   * @param {string} query - Text to search for (case-insensitive)
   * @param {object} [options]
   * @param {string} [options.timeRange] - "3h", "3d", "1w", "1m"
   * @param {string} [options.deviceType]
   * @returns {Promise<Array<object>>}
   */
  async searchConversations(query, options = {}) {
    const queryLower = query.toLowerCase();
    let candidates = [...this.entries];

    if (options.deviceType) {
      candidates = candidates.filter(e => e.deviceType === options.deviceType);
    }

    if (options.timeRange) {
      const cutoff = this.parseTimeRange(options.timeRange);
      if (cutoff) {
        candidates = candidates.filter(e => new Date(e.lastActivityAt) >= cutoff);
      }
    }

    // Sort by most recent first
    candidates.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));

    const matches = [];

    for (const entry of candidates) {
      // Quick check: does firstUserMessage match?
      if (entry.firstUserMessage && entry.firstUserMessage.toLowerCase().includes(queryLower)) {
        matches.push({ ...entry, matchType: 'index' });
        continue;
      }

      // Deep scan: read NDJSON file
      try {
        const fullPath = path.join(this.dataDir, entry.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.trim().split('\n');

        let matched = false;
        const matchingTurns = [];

        for (const line of lines) {
          const parsed = JSON.parse(line);
          // userText lives on `turn` lines; response.text may live on a legacy
          // `turn` line or a two-phase `turn_response` line.
          if (parsed.type !== 'turn' && parsed.type !== 'turn_response') continue;

          const userText = parsed.userText || '';
          const responseText = parsed.response?.text || '';

          if (userText.toLowerCase().includes(queryLower) || responseText.toLowerCase().includes(queryLower)) {
            matched = true;
            matchingTurns.push({
              ts: parsed.ts,
              userText: userText.substring(0, 200),
              responsePreview: responseText.substring(0, 200)
            });
          }
        }

        if (matched) {
          matches.push({ ...entry, matchType: 'content', matchingTurns: matchingTurns.slice(0, 3) });
        }
      } catch (err) {
        // Skip unreadable files
      }

      if (matches.length >= 20) break;
    }

    return matches;
  }

  /**
   * Get a full conversation transcript.
   * @param {string} conversationId
   * @returns {Promise<object|null>}
   */
  async getConversation(conversationId) {
    const entry = this.entries.find(e => e.id === conversationId);
    if (!entry) return null;

    try {
      const fullPath = path.join(this.dataDir, entry.path);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      const events = lines.map(line => JSON.parse(line));
      const header = events.find(e => e.type === 'header');
      const turns = mergeTurnEvents(events);
      const close = events.find(e => e.type === 'close');

      return {
        ...entry,
        header,
        turns,
        close: close || null
      };
    } catch (err) {
      console.error(`[history-store] Failed to read conversation ${conversationId}:`, err.message);
      return null;
    }
  }

  /**
   * Parse a time range string into a Date cutoff.
   * @param {string} range - e.g. "3h", "3d", "1w", "1m"
   * @returns {Date|null}
   */
  parseTimeRange(range) {
    const match = range.match(/^(\d+)([hdwm])$/);
    if (!match) return null;

    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const now = Date.now();

    const ms = {
      h: amount * 60 * 60 * 1000,
      d: amount * 24 * 60 * 60 * 1000,
      w: amount * 7 * 24 * 60 * 60 * 1000,
      m: amount * 30 * 24 * 60 * 60 * 1000
    };

    return new Date(now - (ms[unit] || 0));
  }
}
