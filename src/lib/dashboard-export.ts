import { toPng } from "html-to-image";
import type { BackendClient } from "@/lib/backend";
import { pickExportPath } from "@/lib/files";

export type ExportFormat = "png" | "pdf";

const PIXEL_RATIO = 2;

function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

export async function renderPng(node: HTMLElement, background: string): Promise<string> {
  await nextFrame();
  return toPng(node, {
    pixelRatio: PIXEL_RATIO,
    backgroundColor: background,
    cacheBust: false,
    filter: (element) =>
      !(element instanceof HTMLElement && element.classList.contains("no-export")),
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The dashboard image could not be read"));
    image.src = url;
  });
}

async function pdfBase64(pngUrl: string): Promise<string> {
  const [{ jsPDF }, image] = await Promise.all([import("jspdf"), loadImage(pngUrl)]);
  const width = image.naturalWidth / PIXEL_RATIO;
  const height = image.naturalHeight / PIXEL_RATIO;
  const pdf = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
    compress: true,
  });
  pdf.addImage(pngUrl, "PNG", 0, 0, width, height, undefined, "FAST");
  const dataUri = pdf.output("datauristring");
  return dataUri.slice(dataUri.indexOf(",") + 1);
}

function downloadInBrowser(name: string, base64: string, mime: string): void {
  const link = document.createElement("a");
  link.href = `data:${mime};base64,${base64}`;
  link.download = name;
  link.click();
}

/** Renders the dashboard, asks where to save it, and writes the file; returns the path or null. */
export async function exportDashboard(
  client: BackendClient,
  node: HTMLElement,
  background: string,
  name: string,
  format: ExportFormat,
): Promise<string | null> {
  const png = await renderPng(node, background);
  const base64 = format === "png" ? png.slice(png.indexOf(",") + 1) : await pdfBase64(png);
  const fileName = `${name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "dashboard"}.${format}`;
  const path = await pickExportPath(fileName, format);
  if (path === undefined) {
    downloadInBrowser(fileName, base64, format === "png" ? "image/png" : "application/pdf");
    return fileName;
  }
  if (path === null) return null;
  await client.post("/api/export/file", { path, data_base64: base64 });
  return path;
}
