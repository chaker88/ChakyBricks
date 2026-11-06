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
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
    }
    return (await response.json()) as T;
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
