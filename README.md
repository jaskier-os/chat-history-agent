# chat-history-agent

A conversation history agent for the orchestrator platform. It provides read-only
access to past conversations through two interfaces:

- An LLM tool interface (registered with the orchestrator) exposing
  `list_conversations`, `search_conversations`, and `get_conversation` so the
  orchestrator can route natural-language history queries to this agent.
- A REST API on its own HTTP port for direct programmatic access to the same data.

Conversation data is read from a directory of NDJSON transcript files plus an
`index.json` manifest; the agent never writes to that data, it only reads and
serves it.

## Prerequisites

- Node.js 20 or newer
- An orchestrator instance to register with (WebSocket endpoint)
- A communicator / LLM gateway instance (HTTP endpoint) for tool-calling
- A directory of conversation history data (`index.json` + NDJSON files)

The orchestrator SDK this agent depends on is vendored under
`vendor/orchestrator-sdk`, so the project builds standalone with no access to the
original monorepo.

## Setup

1. Copy the example environment file and fill in the values:

   ```bash
   cp .env.example .env
   ```

   Variables:

   - `ORCHESTRATOR_URL` - WebSocket URL of the orchestrator (e.g. `ws://localhost:10001`).
   - `COMMUNICATOR_URL` - HTTP URL of the communicator / LLM gateway.
   - `API_KEY` - shared key used to authenticate to the communicator and to protect
     this agent's REST API. Set a strong random value.
   - `MODEL` - model identifier passed to the communicator for tool-calling.
   - `HEALTH_PORT` - port for this agent's REST API and `/health` endpoint.
   - `CHAT_HISTORY_DIR` - directory holding `index.json` and the NDJSON transcripts.

2. Install dependencies:

   ```bash
   npm install
   ```

## Build

This is a plain Node.js (ES modules) project with no compile step. Installing
dependencies is all that is required.

## Run

```bash
npm run agent
```

Or for auto-reload during development:

```bash
npm run dev
```

On start the agent connects to the orchestrator, launches its REST API on
`HEALTH_PORT`, and loads the conversation index.

### REST API

All endpoints except `/health` require the API key via `Authorization: Bearer <key>`
or an `x-api-key` header.

- `GET /health` - health check (no auth).
- `GET /api/conversations` - list conversations (`device_type`, `limit`, `offset`, `since`).
- `GET /api/conversations/search?q=...` - search (`range`, `device_type`).
- `GET /api/conversations/:id` - full transcript by conversation ID.

### Docker

A `Dockerfile.agent` is provided. It copies the vendored SDK and `src/`, installs
production dependencies, and runs the agent:

```bash
docker build -f Dockerfile.agent -t chat-history-agent .
docker run --env-file .env -p 10014:10014 chat-history-agent
```

## TLS / VPN

This agent uses plain HTTP/WS connections by default and requires no certificate or
VPN to run. Secure transport, if desired, should be terminated by a reverse proxy or
provided by the orchestrator/communicator endpoints you point it at via the
`*_URL` environment variables; no certificate files are bundled or required.

## Model weights

This project contains no model weights or large binaries. The model used for
tool-calling is selected by the `MODEL` env var and served by the external
communicator.
