import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ResultGrid } from "@/components/result-grid";
import { ResultsPanel } from "@/components/sql/results-panel";
import type { RunState } from "@/hooks/use-sql";
import type { QueryResult } from "@/lib/api-types";

const result: QueryResult = {
  query_id: "q1",
  columns: [
    { name: "الاسم", type: "VARCHAR" },
    { name: "amount", type: "DOUBLE" },
  ],
  rows: [
    ["أحمد", 1.5],
    ["سارة", null],
  ],
  row_count: 25000,
  truncated: true,
  elapsed_ms: 1234,
  statement_count: 1,
};

function wrap(node: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

const run = (state: Partial<RunState>): RunState => ({
  status: "done",
  queryId: "q1",
  sql: "SELECT 1",
  startedAt: Date.now(),
  ...state,
});

describe("results", () => {
  it("renders grid headers with names and types", () => {
    render(<ResultGrid data={result} />);
    expect(screen.getByText("الاسم")).toBeInTheDocument();
    expect(screen.getByText("DOUBLE")).toBeInTheDocument();
  });

  it("shows an empty grid message", () => {
    render(<ResultGrid data={{ columns: result.columns, rows: [] }} />);
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });

  it("prompts to run before any query", () => {
    render(wrap(<ResultsPanel onCancel={() => {}} />));
    expect(screen.getByText(/Run a query with/)).toBeInTheDocument();
  });

  it("shows truncated counts and actions for results", () => {
    render(wrap(<ResultsPanel run={run({ result })} onCancel={() => {}} />));
    expect(screen.getByText("25,000")).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save as table/ })).toBeInTheDocument();
  });

  it("shows errors and cancellation", () => {
    const { rerender } = render(
      wrap(
        <ResultsPanel
          run={run({ status: "error", error: "Catalog Error: nope" })}
          onCancel={() => {}}
        />,
      ),
    );
    expect(screen.getByText("Catalog Error: nope")).toBeInTheDocument();
    rerender(wrap(<ResultsPanel run={run({ status: "cancelled" })} onCancel={() => {}} />));
    expect(screen.getByText("Query cancelled")).toBeInTheDocument();
  });

  it("offers cancel while running", () => {
    render(wrap(<ResultsPanel run={run({ status: "running" })} onCancel={() => {}} />));
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
  });
});
