/**
 * Entry point for the chat-history agent.
 * Initializes the history store and starts the agent.
 */

import 'dotenv/config';
import { HistoryStore } from './history-store.js';
import { ChatHistoryAgent } from './agent.js';

const config = {
  orchestratorUrl: process.env.ORCHESTRATOR_URL || 'ws://localhost:10001',
  communicatorUrl: process.env.COMMUNICATOR_URL || 'http://localhost:10000',
  apiKey: process.env.API_KEY || '',
  model: process.env.MODEL || 'sonnet',
  healthPort: parseInt(process.env.HEALTH_PORT || '10014', 10),
  chatHistoryDir: process.env.CHAT_HISTORY_DIR || './data/chat-history'
};

console.log('[chat-history] Starting agent');
console.log(`[chat-history] Orchestrator: ${config.orchestratorUrl}`);
console.log(`[chat-history] Communicator: ${config.communicatorUrl}`);
console.log(`[chat-history] Data dir: ${config.chatHistoryDir}`);

const store = new HistoryStore(config.chatHistoryDir);
await store.init();

console.log(`[chat-history] History store initialized`);

const agent = new ChatHistoryAgent({
  ...config,
  store
});

await agent.start();

console.log('[chat-history] Agent started and connected to orchestrator');
