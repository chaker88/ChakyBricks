import type { PreviewResponse } from "@/lib/api-types";
import {
  buildImportRequest,
  columnErrors,
  createDraft,
  draftErrors,
  fileName,
  identifierError,
  isTerminal,
  typeOptions,
} from "@/lib/import";

const preview: PreviewResponse = {
  path: "C:\\data\\Sales 2024.csv",
  format: "csv",
  file_size: 100,
  suggested_table: "sales_2024",
  estimated_rows: 4,
  source_columns: [
    { source: "Order ID", name: "order_id", type: "BIGINT" },
    { source: "Region", name: "region", type: "VARCHAR" },
  ],
  editable_types: ["VARCHAR", "BIGINT", "DOUBLE"],
  sample: { columns: [], rows: [] },
};

describe("import draft", () => {
  it("starts from the preview with every column included", () => {
    const draft = createDraft(preview);
    expect(draft.schema).toBe("main");
    expect(draft.table).toBe("sales_2024");
    expect(draft.columns.every((c) => c.include)).toBe(true);
    expect(draftErrors(draft)).toEqual([]);
  });

  it("validates identifiers", () => {
    expect(identifierError("sales", "table name")).toBeNull();
    expect(identifierError("", "table name")).toMatch(/Enter/);
    expect(identifierError("Sales", "table name")).not.toBeNull();
    expect(identifierError("1x", "table name")).not.toBeNull();
    expect(identifierError("__x", "table name")).not.toBeNull();
    expect(identifierError("temp", "schema name")).toMatch(/reserved/);
  });

  it("flags bad and duplicate column names among included columns", () => {
    const draft = createDraft(preview);
    draft.columns[1].name = "Order_ID";
    expect(columnErrors(draft.columns).get(1)).toBe("Duplicate name");
    draft.columns[1].include = false;
    expect(columnErrors(draft.columns).size).toBe(0);
    draft.columns[0].name = "order id";
    expect(columnErrors(draft.columns).get(0)).toMatch(/Letters, digits/);
  });

  it("accepts Arabic, accented and mixed column names", () => {
    const draft = createDraft(preview);
    draft.columns[0].name = "الاسم";
    draft.columns[1].name = "Prénom";
    expect(columnErrors(draft.columns).size).toBe(0);
    expect(draftErrors({ ...draft, partitionBy: "الاسم" })).toEqual([]);

    draft.columns[1].name = "الاسم الكامل";
    expect(columnErrors(draft.columns).get(1)).toMatch(/Letters, digits/);
    draft.columns[0].name = "prénom";
    draft.columns[1].name = "PRÉNOM";
    expect(columnErrors(draft.columns).get(1)).toBe("Duplicate name");
    draft.columns[1].name = "date(naissance)";
    expect(columnErrors(draft.columns).get(1)).toMatch(/Letters, digits/);
    for (const bad of ["a-b", "price?", "2nd", ""]) {
      draft.columns[1].name = bad;
      expect(columnErrors(draft.columns).get(1)).toMatch(/Letters, digits/);
    }
    for (const good of ["مُحَمَّد", "_x", "c_2nd", "ça_va", "الاسم_الكامل"]) {
      draft.columns[1].name = good;
      expect(columnErrors(draft.columns).has(1)).toBe(false);
    }
  });

  it("requires columns and a valid partition column", () => {
    const draft = createDraft(preview);
    draft.partitionBy = "region";
    expect(draftErrors(draft)).toEqual([]);
    draft.columns[1].include = false;
    expect(draftErrors(draft)).toContain(
      "The partition column must be one of the imported columns",
    );
    draft.columns[0].include = false;
    expect(draftErrors(draft)).toContain("Select at least one column");
  });

  it("builds the request with only included columns", () => {
    const draft = createDraft(preview);
    draft.columns[0].include = false;
    draft.columns[1].type = "DOUBLE";
    draft.mode = "append";
    expect(buildImportRequest(preview, draft)).toEqual({
      path: preview.path,
      format: "csv",
      options: { delimiter: null, header: true, sheet: null },
      columns: [{ source: "Region", name: "region", type: "DOUBLE" }],
      schema_name: "main",
      table: "sales_2024",
      partition_by: null,
      mode: "append",
    });
  });

  it("offers inferred and current types first without duplicates", () => {
    expect(typeOptions(["VARCHAR", "DOUBLE"], "DOUBLE", "STRUCT(a INTEGER)")).toEqual([
      "STRUCT(a INTEGER)",
      "DOUBLE",
      "VARCHAR",
    ]);
  });

  it("knows terminal states and file names", () => {
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("cancelled")).toBe(true);
    expect(fileName("C:\\data\\Sales 2024.csv")).toBe("Sales 2024.csv");
    expect(fileName("/tmp/a.parquet")).toBe("a.parquet");
  });
});
