// Writes public/samples/eval/hollow-strategy.pdf: a six-page text PDF whose
// pages look like a strategy but say almost nothing, used as a "hollow
// document" delivery in the evaluation. Plain PDF 1.4, Helvetica, no deps.
import { writeFileSync, mkdirSync } from "node:fs";

const pages = [
  [
    ["Marketing strategy: Ledgerline Bookkeeping", 16],
    ["Prepared on 5 November 2026.", 11],
    ["", 11],
    ["Best customers", 13],
    ["Small businesses.", 11],
    ["", 11],
    ["Three focus channels", 13],
    ["1. Social media 2. Google 3. Networking", 11],
    ["", 11],
    ["Monthly budget", 13],
    ["Spend what you can afford each month.", 11],
  ],
  [
    ["Posting calendar", 13],
    ["To be planned with the client.", 11],
  ],
  [],
  [],
  [],
  [],
];

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const streams = pages.map((lines) => {
  let y = 760;
  const ops = ["BT"];
  for (const [text, size] of lines) {
    ops.push(`/F1 ${size} Tf 1 0 0 1 72 ${y} Tm (${esc(text)}) Tj`);
    y -= size + 9;
  }
  ops.push("ET");
  return ops.join("\n");
});

// Objects: 1 catalog, 2 pages, 3 font, then a page and a content stream per page.
const n = pages.length;
const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
streams.forEach((stream, i) => {
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
});
let out = "%PDF-1.4\n";
const offsets = [];
objects.forEach((o, i) => {
  offsets.push(Buffer.byteLength(out));
  out += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(out);
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
mkdirSync("public/samples/eval", { recursive: true });
writeFileSync("public/samples/eval/hollow-strategy.pdf", out);
console.log("wrote public/samples/eval/hollow-strategy.pdf", Buffer.byteLength(out), "bytes");
