import crypto from "node:crypto";

const DEFAULT_BASE_URL = "https://api.uniroute.app";

export class UniRouteMediaClient {
  constructor({ apiKey = process.env.UNIROUTE_API_KEY, baseUrl = process.env.UNIROUTE_BASE_URL || DEFAULT_BASE_URL } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  _requireKey() {
    if (!this.apiKey) {
      throw new Error("UNIROUTE_API_KEY environment variable is required. Create a key at https://uniroute.app/console/api-keys");
    }
    return this.apiKey;
  }

  async _request(path, { method = "GET", body, headers = {} } = {}) {
    const key = this._requireKey();
    const res = await fetch(`${this.baseUrl}${path}`, {
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
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      throw new Error(`UniRoute API ${res.status}: ${json?.message || json?.error?.message || text.slice(0, 300)}`);
    }
    return json;
  }

  async listModels({ mediaKind } = {}) {
    const res = await this._request("/v1/media/catalog");
    const models = res?.data?.models || [];
    const filtered = mediaKind ? models.filter((m) => m.mediaKind === mediaKind) : models;
    return {
      currency: res?.data?.currency || "USD",
      count: filtered.length,
      models: filtered.map((m) => ({
        modelId: m.modelId,
        mediaKind: m.mediaKind,
        provider: m.provider,
        unit: m.unit,
        options: (m.param?.options || []).map((o) => o.value),
        input_fields: m.input_fields || [],
      })),
    };
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
}
