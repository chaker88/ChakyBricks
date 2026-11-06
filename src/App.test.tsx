import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "@/App";

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("App shell", () => {
  it("renders home and navigates with Ctrl+number", async () => {
    render(<App />);
    expect(screen.getByText("Welcome to ChakyBricks")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  it("shows the engine as offline outside the desktop app", async () => {
    render(<App />);
    expect(await screen.findByText("Offline")).toBeInTheDocument();
  });
});
