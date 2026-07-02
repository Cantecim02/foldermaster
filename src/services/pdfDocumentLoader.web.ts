export async function loadPdfDocumentOnWeb(bytes: Uint8Array): Promise<any> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const documentTask = pdfjs.getDocument({
    data: bytes,
    disableWorker: true
  } as any);
  return documentTask.promise;
}
