// Writes public/samples/eval/handover.pdf: a one-page text PDF used as an
// uploaded-file delivery in the evaluation. Plain PDF 1.4, Helvetica, no deps.
import { writeFileSync, mkdirSync } from "node:fs";

const lines = [
  ["Website handover: Quarrymoor Bakehouse", 16],
  ["Prepared by the developer on 2 November 2026.", 11],
  ["", 11],
  ["Hosting", 13],
  ["The site is hosted on Northwind Pages, on the Starter plan.", 11],
  ["Admin login: https://admin.northwind.example/quarrymoor", 11],
  ["", 11],
  ["Domain", 13],
  ["The domain quarrymoor-bakehouse.example renews on 3 March 2027.", 11],
  ["", 11],
  ["Backups", 13],
  ["Backups run every night and are kept for 14 days.", 11],
  ["", 11],
  ["Support", 13],
  ["For urgent problems email support@northwind.example.", 11],
];

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
let y = 760;
const ops = ["BT"];
for (const [text, size] of lines) {
  ops.push(`/F1 ${size} Tf 1 0 0 1 72 ${y} Tm (${esc(text)}) Tj`);
  y -= size + 9;
}
ops.push("ET");
const stream = ops.join("\n");
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
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
writeFileSync("public/samples/eval/handover.pdf", out);
console.log("wrote public/samples/eval/handover.pdf", Buffer.byteLength(out), "bytes");
