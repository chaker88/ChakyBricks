import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AboutDialog } from "@/components/about-dialog";
import { APP_LINKS } from "@/lib/about";

describe("AboutDialog", () => {
  it("shows the app name, version and author with the profile links", () => {
    render(<AboutDialog open onOpenChange={() => undefined} />);
    expect(screen.getByText("ChakyBricks")).toBeInTheDocument();
    expect(screen.getByText(/^Version \d/)).toBeInTheDocument();
    expect(screen.getByText("Chaker Saidi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Website/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /LinkedIn/ })).toBeInTheDocument();
    expect(APP_LINKS.website).toBe("https://chakybricks.pages.dev/");
    expect(APP_LINKS.github).toBe("https://github.com/chaker88");
    expect(APP_LINKS.linkedin).toBe("https://linkedin.com/in/chaker-saidi");
  });
});
