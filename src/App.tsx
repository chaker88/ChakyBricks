import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import { HashRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/app-shell";
import { BackendProvider } from "@/components/backend-provider";
import { ImportProvider } from "@/components/import/import-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CatalogHome, CatalogLayout } from "@/routes/catalog";
import { HomePage } from "@/routes/home";
import { NotebooksPage } from "@/routes/notebooks";
import { DashboardsPage, JobsPage } from "@/routes/sections";
import { SettingsPage } from "@/routes/settings";
import { TablePage } from "@/routes/table-page";

const SqlPage = lazy(() => import("@/routes/sql"));
const NotebookPage = lazy(() => import("@/routes/notebook"));

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
                    <Route
                      path="sql"
                      element={
                        <Suspense fallback={<PageSkeleton />}>
                          <SqlPage />
                        </Suspense>
                      }
                    />
                    <Route path="notebooks" element={<NotebooksPage />} />
                    <Route
                      path="notebooks/:name"
                      element={
                        <Suspense fallback={<PageSkeleton />}>
                          <NotebookPage />
                        </Suspense>
                      }
                    />
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

function PageSkeleton() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
