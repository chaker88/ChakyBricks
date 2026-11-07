/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_PORT?: string;
  readonly VITE_BACKEND_TOKEN?: string;
}

declare module "plotly.js-dist-min" {
  interface PlotlyStatic {
    newPlot(
      element: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown>;
    purge(element: HTMLElement): void;
    Plots: { resize(element: HTMLElement): void };
  }
  const Plotly: PlotlyStatic;
  export default Plotly;
}
