import { fireEvent, render, screen } from "@testing-library/react";
import { AddCellBar, InsertBar } from "@/components/notebook/add-cell";

describe("add cell buttons", () => {
  it("offers Code, SQL and Markdown at the bottom of the notebook", () => {
    const onInsert = vi.fn();
    render(<AddCellBar onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Code" }));
    fireEvent.click(screen.getByRole("button", { name: "+ SQL" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Markdown" }));
    expect(onInsert.mock.calls).toEqual([["python"], ["sql"], ["markdown"]]);
  });

  it("renders hover buttons between cells", () => {
    const onInsert = vi.fn();
    render(<InsertBar onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: "+ SQL" }));
    expect(onInsert).toHaveBeenCalledWith("sql");
  });
});
