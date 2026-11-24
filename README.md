# UniRoute MCP Server

A lightweight, zero-dependency [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for calling [UniRoute](https://uniroute.app) unified image, video, and music generation APIs (Seedance, Kling, Veo, Wan, Seedream, Qwen Image Edit, Suno, and more) from Claude Desktop, Claude Code, Cursor, or any MCP-compatible client.

## Features

- **Exact pre-flight quoting**: call `uniroute_quote_media` before creating tasks so agents never spend unexpectedly.
- **Explicit cost ceiling & idempotency**: `uniroute_create_media_task` sends `max_cost_usd` and an `Idempotency-Key` header.
- **Zero third-party dependencies**: pure Node.js 20+ stdio MCP server.
- **Bring your own API key**: reads `UNIROUTE_API_KEY` from the local environment. Get a key at [uniroute.app/console/api-keys](https://uniroute.app/console/api-keys).

## Tools

| Tool | Description |
| --- | --- |
| `uniroute_list_media_models` | List available image, video, and music models and option presets |
| `uniroute_quote_media` | Request an exact USD quote for a model + option pair |
| `uniroute_create_media_task` | Submit an async image/video/music generation task with `max_cost_usd` |
| `uniroute_get_media_task` | Poll task status, billing state, and output URLs |

## Quickstart (Claude Desktop / Cursor / Claude Code)

```json
{
  "mcpServers": {
    "uniroute": {
      "command": "node",
      "args": ["/path/to/uniroute-mcp-server/src/index.js"],
      "env": {
        "UNIROUTE_API_KEY": "YOUR_UNIROUTE_API_KEY"
      }
    }
  }
}
```

## Development

```bash
npm run check
npm test
```

## Links

- Website: [uniroute.app](https://uniroute.app)
- Model catalog & Playground: [uniroute.app/models](https://uniroute.app/models)
- Media API Quickstart: [uniroute.app/docs/media-quickstart](https://uniroute.app/docs/media-quickstart)
