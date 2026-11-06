import { createContext, useContext } from "react";

export interface ImportContextValue {
  openImport: () => void;
  trackJob: (jobId: string) => void;
}

export const ImportContext = createContext<ImportContextValue>({
  openImport: () => {},
  trackJob: () => {},
});

export function useImport(): ImportContextValue {
  return useContext(ImportContext);
}
