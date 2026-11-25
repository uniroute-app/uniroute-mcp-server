import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleRpc, TOOLS } from "../src/index.js";
import { UniRouteMediaClient } from "../src/client.js";
import { runSetup } from "../src/setup.js";

test("initialize responds with protocol version and tools capability", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(res.id, 1);
  assert.equal(res.result.serverInfo.name, "uniroute-mcp-server");
  assert.equal(res.result.serverInfo.version, "0.2.0");
  assert.ok(res.result.capabilities.tools);
});

test("tools/list exposes 5 tools starting with one-shot uniroute_generate_media", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(res.result.tools.length, TOOLS.length);
  assert.equal(res.result.tools.length, 5);
  assert.equal(res.result.tools[0].name, "uniroute_generate_media");
});

test("tools/call returns actionable error when no API key is configured", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "uniroute-mcp-nokey-"));
  const prevEnv = process.env.UNIROUTE_API_KEY;
  const prevFile = process.env.UNIROUTE_KEY_FILE;
  delete process.env.UNIROUTE_API_KEY;
  delete process.env.UNIROUTE_KEY_FILE;
  try {
    const client = new UniRouteMediaClient({ homeDir: tmpHome });
    const res = await handleRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "uniroute_list_media_models", arguments: {} },
      },
      client
    );
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /uniroute\.app\/console\/api-keys/);
  } finally {
    if (prevEnv !== undefined) process.env.UNIROUTE_API_KEY = prevEnv;
    if (prevFile !== undefined) process.env.UNIROUTE_KEY_FILE = prevFile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("setup command writes clean Claude Code and Codex configs in an isolated home", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "uniroute-mcp-setup-"));
  try {
    const claudeRes = await runSetup({
      client: "claude",
      apiKey: "sk_test_dummy_key_not_real",
      homeDir: tmpHome,
      entryScript: "/abs/src/index.js",
    });
    assert.ok(fs.existsSync(claudeRes.configPath));
    assert.ok(fs.existsSync(claudeRes.keyFile));
    const claudeJson = JSON.parse(fs.readFileSync(claudeRes.configPath, "utf8"));
    assert.equal(claudeJson.mcpServers.uniroute.args[0], "/abs/src/index.js");
    assert.equal(claudeJson.mcpServers.uniroute.env.UNIROUTE_KEY_FILE, claudeRes.keyFile);

    const codexRes = await runSetup({
      client: "codex",
      keyFile: claudeRes.keyFile,
      homeDir: tmpHome,
      entryScript: "/abs/src/index.js",
    });
    const toml = fs.readFileSync(codexRes.configPath, "utf8");
    assert.match(toml, /\[mcp_servers\.uniroute\]/);
    assert.match(toml, /UNIROUTE_KEY_FILE/);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
