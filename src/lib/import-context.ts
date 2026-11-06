import { createContext, useContext } from "react";

export interface ImportContextValue {
  openImport: () => void;
}

export const ImportContext = createContext<ImportContextValue>({ openImport: () => {} });

export function useImport(): ImportContextValue {
  return useContext(ImportContext);
}
