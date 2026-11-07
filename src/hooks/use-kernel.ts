import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "@/hooks/use-api";
import type { Output } from "@/lib/notebook";

export type KernelStatus =
  "connecting" | "starting" | "idle" | "busy" | "restarting" | "dead" | "disconnected" | "error";

export type KernelEvent =
  | { type: "status"; state: KernelStatus }
  | { type: "queued"; cell_id: string }
  | { type: "started"; cell_id: string; execution_count: number | null }
  | { type: "output"; cell_id: string; output: Output }
  | { type: "clear_output"; cell_id: string; wait: boolean }
  | {
      type: "done";
      cell_id: string;
      status: "ok" | "error" | "aborted";
      duration_ms: number | null;
    }
  | { type: "error"; cell_id: string | null; message: string }
  | {
      type: "complete_reply";
      request_id: number;
      matches: string[];
      cursor_start: number;
      cursor_end: number;
    };

export interface Completion {
  matches: string[];
  cursorStart: number;
  cursorEnd: number;
}

interface KernelInfo {
  id: string;
  notebook: string;
  status: KernelStatus;
}

const RECONNECT_MS = 1500;

export function useKernel(notebook: string, onEvent: (event: KernelEvent) => void) {
  const client = useClient();
  const [kernelId, setKernelId] = useState<string | null>(null);
  const [status, setStatus] = useState<KernelStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onEvent);
  const pending = useRef(new Map<number, (completion: Completion) => void>());
  const requestId = useRef(0);

  useEffect(() => {
    handlerRef.current = onEvent;
  });

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.post<KernelInfo>("/api/kernels", { notebook }).then(
      (info) => {
        if (cancelled) return;
        setError(null);
        setKernelId(info.id);
        setStatus(info.status);
      },
      (err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, notebook, attempt]);

  const start = useCallback(() => {
    setStatus("starting");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!client || !kernelId) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const socket = new WebSocket(client.wsUrl(`/ws/kernels/${kernelId}`));
      socketRef.current = socket;
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as KernelEvent;
        if (event.type === "status") setStatus(event.state);
        if (event.type === "complete_reply") {
          pending.current.get(event.request_id)?.({
            matches: event.matches,
            cursorStart: event.cursor_start,
            cursorEnd: event.cursor_end,
          });
          pending.current.delete(event.request_id);
          return;
        }
        handlerRef.current(event);
      };
      socket.onclose = (event) => {
        if (closed) return;
        if (event.code === 4404) {
          setStatus("dead");
          return;
        }
        setStatus("disconnected");
        timer = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [client, kernelId]);

  const send = useCallback((message: Record<string, unknown>): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const execute = useCallback(
    (cellId: string, code: string) => send({ type: "execute", cell_id: cellId, code }),
    [send],
  );

  const complete = useCallback(
    (code: string, cursorPos: number): Promise<Completion> =>
      new Promise((resolve) => {
        const id = ++requestId.current;
        pending.current.set(id, resolve);
        if (!send({ type: "complete", request_id: id, code, cursor_pos: cursorPos })) {
          pending.current.delete(id);
          resolve({ matches: [], cursorStart: cursorPos, cursorEnd: cursorPos });
        }
        setTimeout(() => {
          if (pending.current.delete(id)) {
            resolve({ matches: [], cursorStart: cursorPos, cursorEnd: cursorPos });
          }
        }, 5000);
      }),
    [send],
  );

  const interrupt = useCallback(async () => {
    if (client && kernelId) await client.post(`/api/kernels/${kernelId}/interrupt`);
  }, [client, kernelId]);

  const restart = useCallback(async () => {
    if (!client || !kernelId) return;
    setStatus("restarting");
    try {
      await client.post(`/api/kernels/${kernelId}/restart`);
      setStatus("idle");
    } catch {
      start();
    }
  }, [client, kernelId, start]);

  const ready = status === "idle" || status === "busy";
  return { kernelId, status, error, ready, execute, complete, interrupt, restart, start };
}
