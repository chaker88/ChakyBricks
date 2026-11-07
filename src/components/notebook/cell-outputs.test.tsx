import { render, screen } from "@testing-library/react";
import { CellOutputs } from "@/components/notebook/cell-outputs";
import { TABLE_MIME, type Output } from "@/lib/notebook";

describe("cell outputs", () => {
  it("renders streams, applying carriage returns", () => {
    render(
      <CellOutputs
        outputs={[
          { output_type: "stream", name: "stdout", text: "10%\r100%\nhello\n" },
          { output_type: "stream", name: "stderr", text: "warning!\n" },
        ]}
      />,
    );
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    expect(screen.queryByText(/10%/)).not.toBeInTheDocument();
    expect(screen.getByText(/warning!/)).toBeInTheDocument();
  });

  it("renders colored tracebacks without escape codes", () => {
    const { container } = render(
      <CellOutputs
        outputs={[
          {
            output_type: "error",
            ename: "ZeroDivisionError",
            evalue: "division by zero",
            traceback: ["\x1b[0;31mZeroDivisionError\x1b[0m: division by zero"],
          },
        ]}
      />,
    );
    const red = container.querySelector(".ansi-red");
    expect(red?.textContent).toBe("ZeroDivisionError");
    expect(container.textContent).not.toContain("\x1b");
  });

  it("renders DataFrames as the result grid with counts", () => {
    const outputs: Output[] = [
      {
        output_type: "execute_result",
        execution_count: 1,
        metadata: {},
        data: {
          [TABLE_MIME]: {
            columns: [{ name: "total", type: "DOUBLE" }],
            rows: [[6]],
            row_count: 5000,
            truncated: true,
          },
          "text/plain": "shape: (5000, 1)",
        },
      },
    ];
    render(<CellOutputs outputs={outputs} />);
    expect(screen.getByText("total")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 5,000 rows")).toBeInTheDocument();
    expect(screen.queryByText("shape: (5000, 1)")).not.toBeInTheDocument();
  });

  it("renders images and sanitizes html", () => {
    const { container } = render(
      <CellOutputs
        outputs={[
          { output_type: "display_data", metadata: {}, data: { "image/png": "iVBORw0KGgo=\n" } },
          {
            output_type: "display_data",
            metadata: {},
            data: { "text/html": '<b>bold</b><script>alert(1)</script><img src=x onerror="x()">' },
          },
          { output_type: "display_data", metadata: {}, data: { "text/plain": ["a", "b"] } },
        ]}
      />,
    );
    expect(container.querySelector("img[alt='Output']")?.getAttribute("src")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(container.querySelector("b")?.textContent).toBe("bold");
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
    expect(screen.getByText("ab")).toBeInTheDocument();
  });
});
