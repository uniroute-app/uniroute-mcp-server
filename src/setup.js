import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UniRouteMediaClient, resolveApiKey } from "./client.js";

function readJsonOrEmpty(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function writeJsonWithBackup(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    const bak = `${filePath}.uniroute-${Date.now()}.bak`;
    fs.copyFileSync(filePath, bak);
  }
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function saveKeyFile({ apiKey, homeDir = os.homedir() }) {
  const keyPath = path.join(homeDir, ".config", "uniroute", "api-key");
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, `${apiKey.trim()}\n`, { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  return keyPath;
}

export function buildServerEntry({ entryScript, useNpx = false, keyFile }) {
  const env = keyFile ? { UNIROUTE_KEY_FILE: keyFile } : {};
  if (useNpx) {
    return {
      command: "npx",
      args: ["-y", "@uniroute/mcp-server"],
      ...(Object.keys(env).length ? { env } : {}),
    };
  }
  return {
    command: process.execPath,
    args: [entryScript],
    ...(Object.keys(env).length ? { env } : {}),
  };
}

export async function runSetup({
  client,
  apiKey,
  keyFile,
  homeDir = os.homedir(),
  claudeConfigDir,
  entryScript,
  useNpx = false,
  dryRun = false,
}) {
  const target = (client || "").toLowerCase();
  if (!["claude", "claude-desktop", "cursor", "codex"].includes(target)) {
    throw new Error(
      `Unsupported client "${client}". Use one of: claude, claude-desktop, cursor, codex`
    );
  }

  let resolvedKeyFile = keyFile;
  if (apiKey && !dryRun) {
    resolvedKeyFile = saveKeyFile({ apiKey, homeDir });
  } else if (!resolvedKeyFile) {
    const found = resolveApiKey({ homeDir });
    if (found.source && found.source !== "env") {
      resolvedKeyFile = found.source;
    } else if (found.key && !dryRun) {
      resolvedKeyFile = saveKeyFile({ apiKey: found.key, homeDir });
    }
  }

  const serverEntry = buildServerEntry({
    entryScript,
    useNpx,
    keyFile: resolvedKeyFile,
  });

  if (target === "codex") {
    const codexPath = path.join(homeDir, ".codex", "config.toml");
    const block = [
      "",
      "[mcp_servers.uniroute]",
      `command = ${JSON.stringify(serverEntry.command)}`,
      `args = ${JSON.stringify(serverEntry.args)}`,
      ...(serverEntry.env?.UNIROUTE_KEY_FILE
        ? [
            "[mcp_servers.uniroute.env]",
            `UNIROUTE_KEY_FILE = ${JSON.stringify(serverEntry.env.UNIROUTE_KEY_FILE)}`,
          ]
        : []),
      "",
    ].join("\n");
    if (!dryRun) {
      fs.mkdirSync(path.dirname(codexPath), { recursive: true });
      const prev = fs.existsSync(codexPath) ? fs.readFileSync(codexPath, "utf8") : "";
      if (prev.includes("[mcp_servers.uniroute]")) {
        // replace existing section cleanly
        const cleaned = prev.replace(
          /\n?\[mcp_servers\.uniroute\][\s\S]*?(?=\n\[(?!mcp_servers\.uniroute)|\s*$)/,
          ""
        );
        fs.writeFileSync(codexPath, `${cleaned.trimEnd()}\n${block}`);
      } else {
        fs.writeFileSync(codexPath, `${prev.trimEnd()}${prev.trim() ? "\n" : ""}${block}`);
      }
    }
    return { client: target, configPath: codexPath, keyFile: resolvedKeyFile, dryRun, serverEntry };
  }

  let configPath;
  if (target === "claude") {
    configPath = claudeConfigDir
      ? path.join(claudeConfigDir, ".claude.json")
      : path.join(homeDir, ".claude.json");
  } else if (target === "claude-desktop") {
    configPath =
      process.platform === "darwin"
        ? path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : path.join(homeDir, ".config", "Claude", "claude_desktop_config.json");
  } else {
    configPath = path.join(homeDir, ".cursor", "mcp.json");
  }

  const existing = readJsonOrEmpty(configPath);
  const next = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers || {}),
      uniroute: serverEntry,
    },
  };
  if (!dryRun) {
    writeJsonWithBackup(configPath, next);
  }
  return { client: target, configPath, keyFile: resolvedKeyFile, dryRun, serverEntry };
}

export async function runHealthCheck({ homeDir = os.homedir(), keyFile } = {}) {
  const { key, source } = resolveApiKey({ keyFile, homeDir });
  if (!key) {
    return {
      ok: false,
      error: "No API key found (checked UNIROUTE_API_KEY, UNIROUTE_KEY_FILE, ~/.config/uniroute/api-key).",
    };
  }
  const client = new UniRouteMediaClient({ apiKey: key });
  const catalog = await client.listModels();
  const counts = { image: 0, video: 0, music: 0 };
  for (const m of catalog.models) {
    if (counts[m.mediaKind] !== undefined) counts[m.mediaKind]++;
  }
  return {
    ok: true,
    keySource: source,
    currency: catalog.currency,
    totalModels: catalog.count,
    breakdown: counts,
  };
}
