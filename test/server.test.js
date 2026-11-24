import test from "node:test";
import assert from "node:assert/strict";
import { handleRpc, TOOLS } from "../src/index.js";

test("initialize responds with protocol version and tools capability", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(res.id, 1);
  assert.equal(res.result.serverInfo.name, "uniroute-mcp-server");
  assert.ok(res.result.capabilities.tools);
});

test("tools/list returns 4 UniRoute media tools", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(res.result.tools.length, TOOLS.length);
  assert.equal(res.result.tools.length, 4);
});

test("tools/call returns structured error when API key is missing", async () => {
  const prev = process.env.UNIROUTE_API_KEY;
  delete process.env.UNIROUTE_API_KEY;
  try {
    const res = await handleRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "uniroute_list_media_models", arguments: {} },
    });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /UNIROUTE_API_KEY/);
  } finally {
    if (prev !== undefined) process.env.UNIROUTE_API_KEY = prev;
  }
});
