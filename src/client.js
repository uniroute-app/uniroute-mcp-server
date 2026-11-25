import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.uniroute.app";
const DEFAULT_MAX_BUDGET_USD = 0.5;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_WAIT_TIMEOUT_MS = 180_000;

export function resolveApiKey({ apiKey, keyFile, homeDir = os.homedir() } = {}) {
  const direct = apiKey || process.env.UNIROUTE_API_KEY;
  if (direct && direct.trim()) return { key: direct.trim(), source: "env" };

  const candidates = [
    keyFile || process.env.UNIROUTE_KEY_FILE,
    path.join(homeDir, ".config", "uniroute", "api-key"),
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const val = fs.readFileSync(filePath, "utf8").trim();
        if (val) return { key: val, source: filePath };
      }
    } catch {
      // ignore unreadable candidate and try next
    }
  }
  return { key: "", source: null };
}

export class UniRouteMediaClient {
  constructor({
    apiKey,
    keyFile,
    homeDir = os.homedir(),
    baseUrl = process.env.UNIROUTE_BASE_URL || DEFAULT_BASE_URL,
  } = {}) {
    this._explicitApiKey = apiKey;
    this._keyFile = keyFile;
    this._homeDir = homeDir;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  _requireKey() {
    const { key } = resolveApiKey({
      apiKey: this._explicitApiKey,
      keyFile: this._keyFile,
      homeDir: this._homeDir,
    });
    if (!key) {
      throw new Error(
        "UniRoute API key not found. Set UNIROUTE_API_KEY or save your key to ~/.config/uniroute/api-key (chmod 600). Create a key at https://uniroute.app/console/api-keys"
      );
    }
    return key;
  }

  async _request(endpoint, { method = "GET", body, headers = {} } = {}) {
    const key = this._requireKey();
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      throw new Error(
        `UniRoute API ${res.status}: ${json?.message || json?.error?.message || text.slice(0, 300)}`
      );
    }
    if (json && typeof json.code === "number" && json.code !== 0) {
      throw new Error(`UniRoute API error (${json.code}): ${json.message || text.slice(0, 300)}`);
    }
    return json;
  }

  async listModels({ mediaKind, query } = {}) {
    const res = await this._request("/v1/media/catalog");
    let models = res?.data?.models || [];
    if (mediaKind) {
      models = models.filter((m) => m.mediaKind === mediaKind);
    }
    if (query) {
      const q = query.trim().toLowerCase();
      models = models.filter(
        (m) =>
          (m.modelId || "").toLowerCase().includes(q) ||
          (m.name || "").toLowerCase().includes(q) ||
          (m.provider || "").toLowerCase().includes(q)
      );
    }
    return {
      currency: res?.data?.currency || "USD",
      count: models.length,
      models: models.map((m) => ({
        modelId: m.modelId,
        name: m.name || m.modelId,
        mediaKind: m.mediaKind,
        provider: m.provider,
        unit: m.unit,
        starting_price_usd: m.price_usd || null,
        options: (m.param?.options || []).map((o) => ({
          value: o.value,
          label: o.label || o.value,
          quote_usd: m.option_quote_usd?.[o.value] || m.option_price_usd?.[o.value] || null,
        })),
        input_fields: m.input_fields || [],
      })),
    };
  }

  async resolveModelAndOption({ mediaType, model, option }) {
    const catalog = await this.listModels({ mediaKind: mediaType });
    if (!catalog.models.length) {
      throw new Error(`No ${mediaType} models are currently available for your API key.`);
    }
    let picked = null;
    if (model) {
      const target = model.trim().toLowerCase();
      picked =
        catalog.models.find((m) => m.modelId.toLowerCase() === target) ||
        catalog.models.find((m) => m.name.toLowerCase() === target) ||
        catalog.models.find(
          (m) => m.modelId.toLowerCase().includes(target) || m.name.toLowerCase().includes(target)
        );
      if (!picked) {
        const sample = catalog.models.slice(0, 6).map((m) => m.modelId).join(", ");
        throw new Error(`Model "${model}" not found for media_type="${mediaType}". Available examples: ${sample}`);
      }
    } else {
      // Pick the cheapest available model as safe default when model is omitted
      picked = [...catalog.models].sort((a, b) => {
        const pa = parseFloat(a.starting_price_usd || "999");
        const pb = parseFloat(b.starting_price_usd || "999");
        return pa - pb;
      })[0];
    }

    const optionValues = picked.options.map((o) => o.value);
    let resolvedOption = option;
    if (!resolvedOption) {
      resolvedOption = optionValues[0];
    } else if (!optionValues.includes(resolvedOption)) {
      const fuzzy = picked.options.find(
        (o) =>
          o.value.toLowerCase() === resolvedOption.toLowerCase() ||
          o.label.toLowerCase() === resolvedOption.toLowerCase()
      );
      if (fuzzy) resolvedOption = fuzzy.value;
      else {
        throw new Error(
          `Option "${option}" is not valid for ${picked.modelId}. Valid options: ${optionValues.join(", ")}`
        );
      }
    }

    return { model: picked, option: resolvedOption };
  }

  async quote({ model, option }) {
    const res = await this._request("/v1/media/quote", {
      method: "POST",
      body: { model, option },
    });
    return res?.data || res;
  }

  async createTask({ mediaType, model, option, prompt, maxCostUsd, idempotencyKey, extraParams = {} }) {
    const key = idempotencyKey || crypto.randomUUID();
    const payload = {
      media_type: mediaType,
      model,
      option,
      prompt,
      max_cost_usd: String(maxCostUsd),
      ...extraParams,
    };
    const res = await this._request("/v1/media/tasks", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: payload,
    });
    return { idempotency_key: key, ...(res?.data || res) };
  }

  async getTask({ taskId }) {
    if (!/^[a-zA-Z0-9_-]{4,128}$/.test(String(taskId || ""))) {
      throw new Error("Invalid task_id format");
    }
    const res = await this._request(`/v1/media/tasks/${encodeURIComponent(taskId)}`);
    return res?.data || res;
  }

  async generateMedia({
    mediaType,
    prompt,
    model,
    option,
    maxBudgetUsd = DEFAULT_MAX_BUDGET_USD,
    waitForResult = true,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    extraParams = {},
  }) {
    const { model: resolvedModel, option: resolvedOption } = await this.resolveModelAndOption({
      mediaType,
      model,
      option,
    });
    const quote = await this.quote({ model: resolvedModel.modelId, option: resolvedOption });
    const quotedUsd = quote?.quoted_usd;
    if (!quotedUsd) {
      throw new Error(`Missing quoted_usd from /v1/media/quote: ${JSON.stringify(quote)}`);
    }
    if (parseFloat(quotedUsd) > Number(maxBudgetUsd)) {
      throw new Error(
        `Quoted cost $${quotedUsd} USD for ${resolvedModel.modelId} (${resolvedOption}) exceeds max_budget_usd ($${maxBudgetUsd}). Pass a higher max_budget_usd to proceed.`
      );
    }

    const created = await this.createTask({
      mediaType,
      model: resolvedModel.modelId,
      option: resolvedOption,
      prompt,
      maxCostUsd: quotedUsd,
      extraParams,
    });
    const taskId = created.task_id;
    if (!waitForResult || !taskId) {
      return {
        status: created.status || "submitted",
        task_id: taskId,
        model: resolvedModel.modelId,
        option: resolvedOption,
        quoted_usd: quotedUsd,
        idempotency_key: created.idempotency_key,
      };
    }

    const deadline = Date.now() + Number(timeoutMs);
    let latest = created;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS));
      latest = await this.getTask({ taskId });
      const st = String(latest?.status || "").toLowerCase();
      if (["success", "succeeded", "completed"].includes(st)) {
        return {
          status: "success",
          task_id: taskId,
          model: resolvedModel.modelId,
          option: resolvedOption,
          quoted_usd: quotedUsd,
          billing: latest.billing || null,
          urls: latest.urls || [],
        };
      }
      if (["failed", "error", "canceled", "cancelled"].includes(st)) {
        throw new Error(
          `Media task ${taskId} ended with status="${latest.status}": ${latest.error || latest.message || "unknown error"}`
        );
      }
    }
    return {
      status: latest?.status || "pending",
      timed_out_waiting: true,
      task_id: taskId,
      model: resolvedModel.modelId,
      option: resolvedOption,
      quoted_usd: quotedUsd,
      message: `Task ${taskId} is still running. Call uniroute_get_media_task with task_id="${taskId}" to check progress.`,
    };
  }
}
