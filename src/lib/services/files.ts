import { extractText, getDocumentProxy } from "unpdf";

/** Turn an uploaded file into text the checker can quote. PDFs are extracted; anything else is read as UTF-8. */
export async function fileToText(name: string, mime: string, bytes: Uint8Array): Promise<{ name: string; mime: string; text: string }> {
  if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return { name, mime: "application/pdf", text };
  }
  return { name, mime: mime || "text/plain", text: new TextDecoder().decode(bytes) };
}
