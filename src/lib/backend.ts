import { invoke, isTauri } from "@tauri-apps/api/core";

export interface BackendInfo {
  port: number;
  token: string;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  uptime_seconds: number;
}

export const TOKEN_HEADER = "X-ChakyBricks-Token";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static async from(response: Response): Promise<ApiError> {
    const text = await response.text().catch(() => "");
    return new ApiError(response.status, parseErrorDetail(text) || response.statusText);
  }
}

export function parseErrorDetail(text: string): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((d: { msg?: string; loc?: unknown[] }) =>
          [d.loc?.slice(1).join("."), d.msg].filter(Boolean).join(": "),
        )
        .join("; ");
    }
  } catch {
    // not JSON
  }
  return text;
}

export class BackendClient {
  readonly baseUrl: string;

  constructor(private readonly info: BackendInfo) {
    this.baseUrl = `http://127.0.0.1:${info.port}`;
  }

  url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  wsUrl(path: string): string {
    const url = new URL(this.url(path));
    url.protocol = "ws:";
    url.searchParams.set("token", this.info.token);
    return url.toString();
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set(TOKEN_HEADER, this.info.token);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(this.url(path), { ...init, headers });
    if (!response.ok) throw await ApiError.from(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PUT", body: JSON.stringify(body) });
  }

  delete(path: string): Promise<void> {
    return this.request<void>(path, { method: "DELETE" });
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/health");
  }
}

export async function loadBackendInfo(): Promise<BackendInfo> {
  if (isTauri()) return invoke<BackendInfo>("backend_info");
  const port = Number(import.meta.env.VITE_BACKEND_PORT);
  const token = import.meta.env.VITE_BACKEND_TOKEN as string | undefined;
  if (!port || !token) throw new Error("Backend is only available inside the ChakyBricks app");
  return { port, token };
}

export async function waitForBackend(
  client: BackendClient,
  { attempts = 60, intervalMs = 250 } = {},
): Promise<HealthResponse> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.health();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Backend did not start");
}
