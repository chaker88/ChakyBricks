import { HashRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/app-shell";
import { BackendProvider } from "@/components/backend-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HomePage } from "@/routes/home";
import { CatalogPage, DashboardsPage, JobsPage, NotebooksPage, SqlPage } from "@/routes/sections";
import { SettingsPage } from "@/routes/settings";

export function App() {
  return (
    <ThemeProvider>
      <BackendProvider>
        <TooltipProvider delayDuration={300}>
          <HashRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<HomePage />} />
                <Route path="catalog" element={<CatalogPage />} />
                <Route path="sql" element={<SqlPage />} />
                <Route path="notebooks" element={<NotebooksPage />} />
                <Route path="dashboards" element={<DashboardsPage />} />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </HashRouter>
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </BackendProvider>
    </ThemeProvider>
  );
}
