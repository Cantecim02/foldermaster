export async function extractPdfTextWithPdfJs(bytes: Uint8Array, pageNumber?: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false
  } as any);
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    if (text.trim()) pages.push(text);
  }

  return pageNumber ? (pages[pageNumber - 1] ?? "") : pages.join("\n\n");
}
