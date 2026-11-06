import { useEffect, useState, type ReactNode } from "react";
import { BackendClient, loadBackendInfo, waitForBackend } from "@/lib/backend";
import { BackendContext, type BackendState } from "@/lib/backend-context";

export function BackendProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BackendState>({ status: "connecting" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = new BackendClient(await loadBackendInfo());
        const health = await waitForBackend(client);
        if (!cancelled) setState({ status: "ready", client, health });
      } catch (error) {
        if (!cancelled) setState({ status: "error", error: String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <BackendContext.Provider value={state}>{children}</BackendContext.Provider>;
}
