// An Excel file Watson writes itself (owner, 24 Oct: the doctor and the patient "get to pick" PDF or
// Excel; "a doctor can export all info of their patients at once").
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { column, workbook } from "./xlsx";

const files = (book: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(book)).map(([name, data]) => [name, strFromU8(data)]));

describe("an Excel workbook", () => {
  it("holds each sheet by name, its rows in order, the first row bold and kept in view", () => {
    const book = files(workbook([
      { name: "Form", rows: [["Section", "Question", "Answer"], ["About the patient", "Age", "42"]] },
      { name: "Conversation", rows: [["Time", "Who", "Words"], ["0:13", "Patient", "I wake at three"]] },
    ]));
    expect(book["xl/workbook.xml"]).toContain('<sheet name="Form" sheetId="1" r:id="rId1"/>');
    expect(book["xl/workbook.xml"]).toContain('<sheet name="Conversation" sheetId="2" r:id="rId2"/>');
    expect(book["xl/worksheets/sheet1.xml"]).toContain('<c r="C2" t="inlineStr" s="2"><is><t xml:space="preserve">42</t></is></c>');
    expect(book["xl/worksheets/sheet1.xml"]).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(book["xl/worksheets/sheet1.xml"]).toContain('state="frozen"');
    expect(book["xl/worksheets/sheet2.xml"]).toContain("I wake at three");
    expect(Object.keys(book)).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/styles.xml", "xl/_rels/workbook.xml.rels"]));
  });

  it("keeps Slovak letters and special characters safe, and names sheets as Excel allows", () => {
    const book = files(workbook([{ name: "Jana Nováková: 27/10 [draft] and a long name", rows: [["Ženšen & <ginger> \"tea\"\u0007"]] }]));
    expect(book["xl/worksheets/sheet1.xml"]).toContain("Ženšen &amp; &lt;ginger&gt; &quot;tea&quot;</t>");
    expect(book["xl/workbook.xml"]).toContain('name="Jana Nováková 2710 draft and a"');
  });

  it("numbers columns past Z as Excel does", () => {
    expect([column(0), column(25), column(26), column(27), column(701), column(702)]).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});
