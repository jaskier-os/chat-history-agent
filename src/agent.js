/**
 * ChatHistoryAgent - conversation history agent with PTC tools and REST API.
 *
 * Tools (for LLM-routed queries via ToolCallingClient):
 *   - list_conversations: list recent conversations
 *   - search_conversations: search by text query with optional time range
 *   - get_conversation: get full transcript by ID
 *
 * REST API (direct client access on health port):
 *   - GET /api/conversations
 *   - GET /api/conversations/search
 *   - GET /api/conversations/:id
 */

import { BaseAgent, ToolCallingClient } from '@orchestrator/sdk';
import { startHttpApi } from './http-api.js';

export class ChatHistoryAgent extends BaseAgent {
  /**
   * @param {object} options
   * @param {string} options.orchestratorUrl
   * @param {string} options.communicatorUrl
   * @param {string} options.apiKey
   * @param {string} options.model
   * @param {import('./history-store.js').HistoryStore} options.store
   * @param {number} [options.healthPort]
   */
  constructor(options) {
    super(
      {
        id: 'chat-history',
        name: 'Conversation History Agent',
        capabilities: [
          'conversation history',
          'chat history',
          'what did we talk about',
          'recent conversations',
          'search conversations',
          'previous discussion',
          'past chats'
        ],
        inputTypes: ['text'],
        healthEndpoint: '/health'
      },
      {
        orchestratorUrl: options.orchestratorUrl,
        healthPort: 0 // We use our own HTTP server instead
      }
    );

    this.store = options.store;
    this.apiKey = options.apiKey;
    this.httpPort = options.healthPort || 10014;

    this.client = new ToolCallingClient({
      communicatorUrl: options.communicatorUrl,
      apiKey: options.apiKey,
      model: options.model
    });
  }

  /**
   * Override start to also launch the HTTP API server.
   */
  async start() {
    this.httpServer = startHttpApi(this.store, this.httpPort, this.apiKey, this.manifest.id);
    this.connect();
    this.setupGracefulShutdown();
  }

  buildSystemPrompt() {
    return `You are a conversation history agent. You help users find and review their past conversations.

Rules:
- When listing conversations, present them clearly with date, device, turn count, and first message preview.
- When searching, highlight which parts matched the query.
- When showing a full conversation, present turns chronologically with user messages and assistant responses.
- Format times in a human-friendly way (e.g. "2 hours ago", "yesterday at 3pm").
- Be concise. Summarize rather than dumping raw data.
- If no results found, say so clearly and suggest broadening the search.`;
  }

  /**
   * Handle an incoming request from the orchestrator.
   * @param {import('@orchestrator/sdk/types.js').AgentRequest} request
   */
  async handle(request) {
    const { requestId, text, context } = request;
    console.log(`[chat-history] Handling request ${requestId}: ${text}`);

    try {
      const messages = this.buildMessagesWithHistory(this.buildSystemPrompt(), text || 'List my recent conversations', context?.sessionHistory, context?.globalInstructions, context?.autonomousInstructions);
      const result = await this.client.execute({
        messages,
        tools: TOOLS,
        toolExecutor: (name, input) => this.executeTool(name, input)
      });

      return {
        requestId,
        status: 'success',
        text: result.text
      };
    } catch (err) {
      console.error(`[chat-history] Handle error:`, err.message);
      return {
        requestId,
        status: 'error',
        text: `Failed to process history request: ${err.message}`
      };
    }
  }

  /**
   * Execute a history tool.
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<string>}
   */
  async executeTool(toolName, args) {
    switch (toolName) {
      case 'list_conversations': {
        const result = this.store.listConversations({
          deviceType: args.device_type,
          limit: args.limit || 20,
          offset: args.offset || 0
        });

        if (result.conversations.length === 0) return 'No conversations found.';
        return JSON.stringify(result, null, 2);
      }

      case 'search_conversations': {
        if (!args.query) return 'Error: missing "query" argument';
        const results = await this.store.searchConversations(args.query, {
          timeRange: args.time_range,
          deviceType: args.device_type
        });

        if (results.length === 0) return 'No conversations matching the query were found.';
        return JSON.stringify(results, null, 2);
      }

      case 'get_conversation': {
        if (!args.conversation_id) return 'Error: missing "conversation_id" argument';
        const conversation = await this.store.getConversation(args.conversation_id);
        if (!conversation) return `Conversation ${args.conversation_id} not found.`;
        return JSON.stringify(conversation, null, 2);
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  }
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_conversations',
      description: 'List recent conversations, optionally filtered by device type. Returns conversations sorted by most recent activity.',
      parameters: {
        type: 'object',
        properties: {
          device_type: { type: 'string', description: 'Filter by device type: "pc", "phone", or "glasses"' },
          limit: { type: 'number', description: 'Max conversations to return (default: 20)' },
          offset: { type: 'number', description: 'Offset for pagination (default: 0)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_conversations',
      description: 'Search across conversations by text content. Searches both user messages and assistant responses.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for in conversations' },
          time_range: { type: 'string', description: 'Time range filter: "3h" (3 hours), "3d" (3 days), "1w" (1 week), "1m" (1 month)' },
          device_type: { type: 'string', description: 'Filter by device type' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_conversation',
      description: 'Get the full transcript of a specific conversation by its ID.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string', description: 'The conversation UUID' }
        },
        required: ['conversation_id']
      }
    }
  }
];
