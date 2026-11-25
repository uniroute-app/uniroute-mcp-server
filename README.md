# UniRoute MCP Server

Zero-dependency [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for calling **63+ multimodal AI models** (image, video, and music: Seedream 5.0, Seedance, Kling, Veo 3.1, Wan, Nano Banana, Flux 2, Suno, and more) through [UniRoute](https://uniroute.app) from **Claude Code, Claude Desktop, Cursor, or Codex CLI**.

## 30-Second Setup (Lowest Friction)

### Option A: One-command auto-setup (recommended)

1. Create an API key at [uniroute.app/console/api-keys](https://uniroute.app/console/api-keys).
2. Run one command for your client (`claude`, `claude-desktop`, `cursor`, or `codex`):

```bash
git clone https://github.com/uniroute-app/uniroute-mcp-server.git ~/.uniroute-mcp
UNIROUTE_API_KEY="YOUR_KEY" node ~/.uniroute-mcp/src/index.js setup claude
```

This automatically:
- Saves your key to `~/.config/uniroute/api-key` (`chmod 600` — never writes your raw key into client JSON/TOML configs!)
- Backs up your existing config and merges the `uniroute` MCP server entry
- Works immediately on next launch

3. Verify connectivity in 1 second:

```bash
node ~/.uniroute-mcp/src/index.js check
```

### Option B: Claude Code native CLI one-liner

```bash
claude mcp add uniroute -e UNIROUTE_API_KEY="YOUR_KEY" -- node ~/.uniroute-mcp/src/index.js
```

## Tools (5)

| Tool | Best For |
| --- | --- |
| **`uniroute_generate_media`** | **One-shot generation** — supports short model names (`seedream`, `z-image`, `veo`, `seedance`, `suno`), auto-quotes exact USD cost, enforces `max_budget_usd` safety cap (default `$0.50`), polls automatically, and returns ready-to-use asset URLs |
| `uniroute_list_media_models` | List & search available image, video, and music models with live per-option USD prices and `input_fields` |
| `uniroute_quote_media` | Request an exact USD quote before submitting a task |
| `uniroute_create_media_task` | Low-level idempotent task submission with explicit `max_cost_usd` |
| `uniroute_get_media_task` | Poll task status, billing state, and output URLs |

## Example Prompts After Setup

- *"Generate a 1:1 minimalist lighthouse vector illustration with z-image (budget max $0.02)."*
- *"List all Seedream image models and their current USD prices on UniRoute."*
- *"Create a 5-second video with Seedance 2 Mini of rain falling on a neon street."*

## Security & Budget Safety

- **Zero third-party npm dependencies**: pure Node.js 20+ stdio server.
- **No raw keys in config files**: `setup` stores keys in `chmod 600 ~/.config/uniroute/api-key` and references `UNIROUTE_KEY_FILE`.
- **Pre-flight cost guard**: `uniroute_generate_media` quotes exact USD cost first and aborts before charging if it exceeds `max_budget_usd`.

## Links

- Website: [uniroute.app](https://uniroute.app)
- Model catalog & Playground: [uniroute.app/models](https://uniroute.app/models)
- Media API Quickstart: [uniroute.app/docs/media-quickstart](https://uniroute.app/docs/media-quickstart)
