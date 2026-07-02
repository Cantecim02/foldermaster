export async function loadPdfDocumentOnWeb(_bytes: Uint8Array): Promise<any> {
  throw new Error("ERR_WEB_ONLY_PDF_RENDERER");
}
