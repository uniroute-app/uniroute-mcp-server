#!/usr/bin/env node
/**
 * Zero-dependency Model Context Protocol (MCP) stdio server for UniRoute Media APIs.
 * Implements JSON-RPC 2.0 MCP lifecycle (initialize, tools/list, tools/call).
 * Docs: https://uniroute.app/docs/media-quickstart
 */
import readline from "node:readline";
import { UniRouteMediaClient } from "./client.js";

const SERVER_INFO = { name: "uniroute-mcp-server", version: "0.1.0" };
const PROTOCOL_VERSION = "2024-11-05";

export const TOOLS = [
  {
    name: "uniroute_list_media_models",
    description: "List available UniRoute image, video, and music generation models and their supported options.",
    inputSchema: {
      type: "object",
      properties: {
        media_kind: {
          type: "string",
          enum: ["image", "video", "music"],
          description: "Optional filter by media kind.",
        },
      },
    },
  },
  {
    name: "uniroute_quote_media",
    description: "Get an exact USD quote from UniRoute before creating an image, video, or music generation task.",
    inputSchema: {
      type: "object",
      required: ["model", "option"],
      properties: {
        model: { type: "string", description: "Model ID from uniroute_list_media_models (e.g. z-image, bytedance/seedance-1.5-pro)." },
        option: { type: "string", description: "Option value from the model catalog (e.g. 16:9, 480p:5)." },
      },
    },
  },
  {
    name: "uniroute_create_media_task",
    description: "Submit an asynchronous image, video, or music generation task on UniRoute with an explicit max_cost_usd ceiling and idempotency key.",
    inputSchema: {
      type: "object",
      required: ["media_type", "model", "option", "prompt", "max_cost_usd"],
      properties: {
        media_type: { type: "string", enum: ["image", "video", "music"] },
        model: { type: "string" },
        option: { type: "string" },
        prompt: { type: "string" },
        max_cost_usd: { type: "string", description: "Exact decimal USD string returned by uniroute_quote_media." },
        idempotency_key: { type: "string", description: "Optional UUID for safe replay." },
        image_url: { type: "string", description: "Optional input image URL for image-to-image or image-to-video models." },
      },
    },
  },
  {
    name: "uniroute_get_media_task",
    description: "Poll status, billing state, and output asset URLs for an existing UniRoute media task.",
    inputSchema: {
      type: "object",
      required: ["task_id"],
      properties: {
        task_id: { type: "string", description: "Task ID returned by uniroute_create_media_task." },
      },
    },
  },
];

const client = new UniRouteMediaClient();

export async function handleRpc(msg) {
  const { id, method, params = {} } = msg;
  if (method === "notifications/initialized") return null;

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }
    if (method === "tools/call") {
      const { name, arguments: args = {} } = params;
      let data;
      if (name === "uniroute_list_media_models") {
        data = await client.listModels({ mediaKind: args.media_kind });
      } else if (name === "uniroute_quote_media") {
        data = await client.quote({ model: args.model, option: args.option });
      } else if (name === "uniroute_create_media_task") {
        const extraParams = args.image_url ? { image_url: args.image_url } : {};
        data = await client.createTask({
          mediaType: args.media_type,
          model: args.model,
          option: args.option,
          prompt: args.prompt,
          maxCostUsd: args.max_cost_usd,
          idempotencyKey: args.idempotency_key,
          extraParams,
        });
      } else if (name === "uniroute_get_media_task") {
        data = await client.getTask({ taskId: args.task_id });
      } else {
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        },
      };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (err) {
    if (method === "tools/call") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: String(err?.message || err) }],
        },
      };
    }
    return { jsonrpc: "2.0", id, error: { code: -32603, message: String(err?.message || err) } };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      const res = await handleRpc(msg);
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    } catch (e) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
    }
  });
}
