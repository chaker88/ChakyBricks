import { BackendClient, TOKEN_HEADER, parseErrorDetail, waitForBackend } from "@/lib/backend";

const info = { port: 51234, token: "secret" };

describe("BackendClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds http and websocket urls", () => {
    const client = new BackendClient(info);
    expect(client.url("/api/health")).toBe("http://127.0.0.1:51234/api/health");
    expect(client.url("api/health")).toBe("http://127.0.0.1:51234/api/health");
    expect(client.wsUrl("/ws/echo")).toBe("ws://127.0.0.1:51234/ws/echo?token=secret");
  });

  it("sends the session token on every request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    await new BackendClient(info).health();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:51234/api/health");
    expect(new Headers(init?.headers).get(TOKEN_HEADER)).toBe("secret");
  });

  it("throws on non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 401, statusText: "Unauthorized" }),
    );
    await expect(new BackendClient(info).health()).rejects.toThrow("nope");
  });

  it("retries until the backend is healthy", async () => {
    const health = { status: "ok", version: "1.0.0", uptime_seconds: 0 };
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockResolvedValueOnce(new Response(JSON.stringify(health), { status: 200 }));
    await expect(
      waitForBackend(new BackendClient(info), { attempts: 3, intervalMs: 1 }),
    ).resolves.toEqual(health);
  });

  it("gives up after the configured attempts", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connection refused"));
    await expect(
      waitForBackend(new BackendClient(info), { attempts: 2, intervalMs: 1 }),
    ).rejects.toThrow("connection refused");
  });
});

describe("parseErrorDetail", () => {
  it("extracts FastAPI error details", () => {
    expect(parseErrorDetail('{"detail":"Table exists"}')).toBe("Table exists");
    expect(
      parseErrorDetail('{"detail":[{"loc":["body","memory_limit_mb"],"msg":"too small"}]}'),
    ).toBe("memory_limit_mb: too small");
    expect(parseErrorDetail("plain text")).toBe("plain text");
  });

  it("returns undefined for 204 responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(new BackendClient(info).delete("/api/tables/a/b")).resolves.toBeUndefined();
  });
});
