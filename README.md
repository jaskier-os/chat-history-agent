# chat-history-agent

> **Docs & wiki:** [github.com/jaskier-os/docs/wiki](https://github.com/jaskier-os/docs/wiki)

Read-only access to past conversations, for the orchestrator. It exposes the same data
two ways: as LLM tools registered with the orchestrator (`list_conversations`,
`search_conversations`, `get_conversation`) and as a REST API on its own HTTP port.
Conversation data is read from a directory of NDJSON transcripts plus an `index.json`
manifest; the agent only reads, never writes. Entry point is `src/agent-entry.js`.

## Build / run

```bash
npm install

npm run agent    # connects to orchestrator + serves REST API on HEALTH_PORT
npm run dev      # auto-reload via nodemon
```

Docker:

```bash
docker build -f Dockerfile.agent -t chat-history-agent .
docker run --env-file .env -p 10014:10014 chat-history-agent
```

REST API (all routes except `/health` need the API key via `Authorization: Bearer <key>`
or `x-api-key`): `GET /health`, `GET /api/conversations`,
`GET /api/conversations/search?q=...`, `GET /api/conversations/:id`.

## Configuration

Config is env vars; `.env.example` is the source of truth. Copy it to `.env` and edit.
Key vars:

- `ORCHESTRATOR_URL` -- orchestrator WebSocket URL
- `COMMUNICATOR_URL` -- LLM gateway for tool-calling
- `API_KEY` -- authenticates to the communicator and protects this agent's REST API
- `MODEL`, `HEALTH_PORT`
- `CHAT_HISTORY_DIR` -- where `index.json` + NDJSON transcripts live

## Dependencies

Node 20+ (ES modules). No model weights. `@orchestrator/sdk` is vendored in
`./vendor/orchestrator-sdk` (`file:./vendor/orchestrator-sdk`): a point-in-time copy of
the SDK from the `jaskier-os/orchestrator` repo, not a published package.
