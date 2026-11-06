import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { HashRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/app-shell";
import { BackendProvider } from "@/components/backend-provider";
import { ImportProvider } from "@/components/import/import-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CatalogHome, CatalogLayout } from "@/routes/catalog";
import { HomePage } from "@/routes/home";
import { DashboardsPage, JobsPage, NotebooksPage, SqlPage } from "@/routes/sections";
import { SettingsPage } from "@/routes/settings";
import { TablePage } from "@/routes/table-page";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
    },
  });
}

export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider>
      <BackendProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={300}>
            <HashRouter>
              <ImportProvider>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route index element={<HomePage />} />
                    <Route path="catalog" element={<CatalogLayout />}>
                      <Route index element={<CatalogHome />} />
                      <Route path=":schema/:table" element={<TablePage />} />
                    </Route>
                    <Route path="sql" element={<SqlPage />} />
                    <Route path="notebooks" element={<NotebooksPage />} />
                    <Route path="dashboards" element={<DashboardsPage />} />
                    <Route path="jobs" element={<JobsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                </Routes>
              </ImportProvider>
            </HashRouter>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </QueryClientProvider>
      </BackendProvider>
    </ThemeProvider>
  );
}
