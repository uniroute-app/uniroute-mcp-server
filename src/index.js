#!/usr/bin/env node
/**
 * Zero-dependency Model Context Protocol (MCP) stdio server & one-command setup CLI
 * for UniRoute Media APIs (image, video, and music generation).
 * Docs: https://uniroute.app/docs/media-quickstart
 */
import fs from "node:fs";
import os from "node:os";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { UniRouteMediaClient } from "./client.js";
import { runHealthCheck, runSetup } from "./setup.js";

const SERVER_INFO = { name: "uniroute-mcp-server", version: "0.2.0" };
const PROTOCOL_VERSION = "2024-11-05";

export const TOOLS = [
  {
    name: "uniroute_generate_media",
    description:
      "Recommended one-shot tool: generate an image, video, or music track on UniRoute. Automatically resolves the model (supports short names like 'seedream', 'z-image', 'veo', 'seedance', 'suno'), quotes exact USD cost, enforces max_budget_usd safety cap (default $0.50), submits an idempotent task, polls until complete, and returns ready-to-use asset URLs.",
    inputSchema: {
      type: "object",
      required: ["media_type", "prompt"],
      properties: {
        media_type: { type: "string", enum: ["image", "video", "music"] },
        prompt: { type: "string", description: "Detailed generation prompt." },
        model: {
          type: "string",
          description:
            "Optional model ID or short name (e.g. 'z-image', 'seedream', 'nano-banana-2-lite', 'veo-3-1', 'seedance', 'suno'). Defaults to the lowest-cost available model for that media_type.",
        },
        option: {
          type: "string",
          description:
            "Optional preset such as '1:1', '16:9', '720p:4', or 'lofi, chill, mellow'. Defaults to the model's first supported option.",
        },
        max_budget_usd: {
          type: "number",
          description: "Safety ceiling in USD (default 0.50). Request is aborted before charging if quote exceeds this.",
        },
        wait_for_result: {
          type: "boolean",
          description: "Wait and poll until finished (default true). Set false to return task_id immediately.",
        },
        first_frame_url: { type: "string", description: "Optional start frame HTTPS URL for image-to-video models." },
        last_frame_url: { type: "string", description: "Optional end frame HTTPS URL for supported video models." },
        image_urls: {
          type: "array",
          items: { type: "string" },
          description: "Optional reference image HTTPS URLs for models supporting multi-image input.",
        },
        aspect_ratio: { type: "string", description: "Optional aspect ratio override for models supporting aspect_ratio." },
        seed: { type: "integer", description: "Optional seed for reproducible generation." },
      },
    },
  },
  {
    name: "uniroute_list_media_models",
    description:
      "List available UniRoute image, video, and music generation models with live per-option USD prices and supported input fields.",
    inputSchema: {
      type: "object",
      properties: {
        media_kind: {
          type: "string",
          enum: ["image", "video", "music"],
          description: "Optional filter by media kind.",
        },
        query: {
          type: "string",
          description: "Optional substring filter by model ID, name, or provider (e.g. 'seedream', 'google', 'suno').",
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
        model: { type: "string", description: "Model ID from uniroute_list_media_models (e.g. z-image, bytedance/seedance-2-mini)." },
        option: { type: "string", description: "Option value from the model catalog (e.g. 1:1, 16:9, 5)." },
      },
    },
  },
  {
    name: "uniroute_create_media_task",
    description:
      "Low-level task submission with explicit max_cost_usd ceiling and idempotency key. Prefer uniroute_generate_media unless you need custom polling.",
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
        first_frame_url: { type: "string" },
        last_frame_url: { type: "string" },
        image_urls: { type: "array", items: { type: "string" } },
        aspect_ratio: { type: "string" },
        seed: { type: "integer" },
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
        task_id: { type: "string", description: "Task ID returned by uniroute_create_media_task or uniroute_generate_media." },
      },
    },
  },
];

function extractExtraParams(args) {
  const extra = {};
  for (const field of ["first_frame_url", "last_frame_url", "image_urls", "aspect_ratio", "seed"]) {
    if (args[field] !== undefined) extra[field] = args[field];
  }
  return extra;
}

const defaultClient = new UniRouteMediaClient();

export async function handleRpc(msg, client = defaultClient) {
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
      if (name === "uniroute_generate_media") {
        data = await client.generateMedia({
          mediaType: args.media_type,
          prompt: args.prompt,
          model: args.model,
          option: args.option,
          maxBudgetUsd: args.max_budget_usd,
          waitForResult: args.wait_for_result ?? true,
          extraParams: extractExtraParams(args),
        });
      } else if (name === "uniroute_list_media_models") {
        data = await client.listModels({ mediaKind: args.media_kind, query: args.query });
      } else if (name === "uniroute_quote_media") {
        data = await client.quote({ model: args.model, option: args.option });
      } else if (name === "uniroute_create_media_task") {
        data = await client.createTask({
          mediaType: args.media_type,
          model: args.model,
          option: args.option,
          prompt: args.prompt,
          maxCostUsd: args.max_cost_usd,
          idempotencyKey: args.idempotency_key,
          extraParams: extractExtraParams(args),
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

function parseCliArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) opts[k] = true;
      else {
        opts[k] = next;
        i++;
      }
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`UniRoute MCP Server v${SERVER_INFO.version}

Usage:
  uniroute-mcp                               Start stdio MCP server (for MCP clients)
  uniroute-mcp setup <client> [options]      Configure Claude Code, Claude Desktop, Cursor, or Codex in one command
  uniroute-mcp check [--key-file PATH]       Verify API key and print available media model counts

Clients: claude | claude-desktop | cursor | codex
Options:
  --key-file PATH      Use an existing UniRoute API key file (default: ~/.config/uniroute/api-key)
  --home PATH          Override home directory (useful for isolated testing)
  --npx                Write npx -y @uniroute/mcp-server as command instead of current script path
  --dry-run            Preview config without writing files
`);
}

const currentFile = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === currentFile) {
  const args = parseCliArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === "--help" || cmd === "-h" || cmd === "help" || args.help) {
    printHelp();
    process.exit(0);
  }

  if (cmd === "setup") {
    const clientName = args._[1];
    runSetup({
      client: clientName,
      apiKey: process.env.UNIROUTE_API_KEY,
      keyFile: args["key-file"],
      homeDir: args.home || os.homedir(),
      claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
      entryScript: currentFile,
      useNpx: Boolean(args.npx),
      dryRun: Boolean(args["dry-run"]),
    })
      .then((res) => {
        console.log(JSON.stringify(res, null, 2));
        process.exit(0);
      })
      .catch((e) => {
        console.error(e.message);
        process.exit(1);
      });
  } else if (cmd === "check") {
    runHealthCheck({ homeDir: args.home || os.homedir(), keyFile: args["key-file"] })
      .then((res) => {
        console.log(JSON.stringify(res, null, 2));
        process.exit(res.ok ? 0 : 1);
      })
      .catch((e) => {
        console.error(e.message);
        process.exit(1);
      });
  } else {
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        const res = await handleRpc(msg);
        if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
      } catch {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`
        );
      }
    });
  }
}
