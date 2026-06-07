/**
 * REST API server for chat history.
 * Extends the base agent's health server with conversation endpoints.
 *
 * Endpoints:
 *   GET /health                         - Health check (no auth)
 *   GET /api/conversations              - List conversations
 *   GET /api/conversations/search       - Search conversations
 *   GET /api/conversations/:id          - Get full transcript
 */

import http from 'http';

/**
 * Create and start the HTTP API server.
 * @param {import('./history-store.js').HistoryStore} store
 * @param {number} port
 * @param {string} apiKey
 * @param {string} agentId
 * @returns {http.Server}
 */
export function startHttpApi(store, port, apiKey, agentId) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Health check - no auth
    if (url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', agent: agentId });
      return;
    }

    // Auth check for all other endpoints
    if (!authenticate(req, apiKey)) {
      sendJson(res, 401, { error: 'Missing or invalid API key' });
      return;
    }

    try {
      // GET /api/conversations
      if (url.pathname === '/api/conversations' && req.method === 'GET') {
        const deviceType = url.searchParams.get('device_type') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const since = url.searchParams.get('since') || undefined;

        const result = store.listConversations({ deviceType, limit, offset, since });
        sendJson(res, 200, result);
        return;
      }

      // GET /api/conversations/search
      if (url.pathname === '/api/conversations/search' && req.method === 'GET') {
        const q = url.searchParams.get('q');
        if (!q) {
          sendJson(res, 400, { error: 'Missing required query parameter: q' });
          return;
        }

        const timeRange = url.searchParams.get('range') || undefined;
        const deviceType = url.searchParams.get('device_type') || undefined;

        const results = await store.searchConversations(q, { timeRange, deviceType });
        sendJson(res, 200, { results, count: results.length });
        return;
      }

      // GET /api/conversations/:id
      const conversationMatch = url.pathname.match(/^\/api\/conversations\/([a-f0-9-]+)$/);
      if (conversationMatch && req.method === 'GET') {
        const conversation = await store.getConversation(conversationMatch[1]);
        if (!conversation) {
          sendJson(res, 404, { error: 'Conversation not found' });
          return;
        }
        sendJson(res, 200, conversation);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error(`[http-api] Request error:`, err.message);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(port, () => {
    console.log(`[${agentId}] HTTP API server on port ${port}`);
  });

  return server;
}

/**
 * Check API key from request headers.
 * @param {http.IncomingMessage} req
 * @param {string} apiKey
 * @returns {boolean}
 */
function authenticate(req, apiKey) {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7) === apiKey;
  }
  if (apiKeyHeader) {
    return apiKeyHeader === apiKey;
  }
  return false;
}

/**
 * Send a JSON response.
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {object} data
 */
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
