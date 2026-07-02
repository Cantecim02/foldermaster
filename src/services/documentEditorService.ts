import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { AppFile, ConvertedFile } from "../types";
import { extractPdfTextWithPdfJs } from "./pdfTextExtractor";

const regularFontAsset = require("../../assets/fonts/LiberationSans-Regular.ttf");
const boldFontAsset = require("../../assets/fonts/LiberationSans-Bold.ttf");
const editedDir = `${FileSystem.documentDirectory ?? ""}edited/`;

export type DocumentEditLayer = {
  id: string;
  type: "text" | "typedSignature" | "qrSignature" | "imageSignature" | "inkSignature" | "pen" | "highlight" | "redaction";
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  lineWidth?: number;
  points?: Array<{ x: number; y: number; move?: boolean }>;
  imageUri?: string;
  imageMimeType?: string;
  fontSize?: number;
  textAlign?: "left" | "center" | "right";
  backgroundColor?: string;
  fontStyle?: "normal" | "italic";
  fontWeight?: "400" | "700" | "900";
  fontFamily?: "sans" | "serif" | "mono" | "script";
  textDecorationLine?: "none" | "underline" | "line-through";
  rotation?: number;
};

export type EditableDocumentInfo = {
  pageCount: number;
  pageSizes: Array<{ width: number; height: number }>;
  normalizedFile?: AppFile;
};

export type DocumentPagePlanItem = {
  id: string;
  sourcePage?: number;
  blank?: boolean;
};

export type DocumentPreviewSource = {
  html?: string;
  uri?: string;
  allowingReadAccessToURL?: string;
};

export async function createDocumentPreviewSource(file: AppFile): Promise<DocumentPreviewSource> {
  const type = editableTypeFromFile(file);
  if (!type) throw new Error("ERR_EDITOR_UNSUPPORTED");

  if (type === "pdf" && Platform.OS !== "web" && file.uri.startsWith("file://")) {
    return {
      uri: file.uri,
      allowingReadAccessToURL: getReadAccessRoot(file.uri)
    };
  }

  if (type === "txt") {
    const text = await readText(file.uri);
    return {
      html: createPreviewShell(`
      <main class="text-preview">
        <pre>${escapeHtml(text || " ")}</pre>
      </main>
    `)
    };
  }

  const base64 = await readBase64(file.uri);
  if (type === "jpg" || type === "png") {
    const mimeType = type === "png" ? "image/png" : "image/jpeg";
    return {
      html: createPreviewShell(`
      <main class="image-preview">
        <img src="data:${mimeType};base64,${base64}" alt="${escapeHtml(file.name)}" />
      </main>
    `)
    };
  }

  return {
    html: createPreviewShell(`
    <main class="pdf-preview">
      <iframe title="${escapeHtml(file.name)}" src="data:application/pdf;base64,${base64}#toolbar=0&navpanes=0&view=FitH"></iframe>
      <embed src="data:application/pdf;base64,${base64}#toolbar=0&navpanes=0&view=FitH" type="application/pdf" />
    </main>
  `)
  };
}

export async function inspectEditableDocument(file: AppFile): Promise<EditableDocumentInfo> {
  const pdfDoc = await loadEditablePdf(file);
  return {
    pageCount: pdfDoc.getPageCount(),
    pageSizes: pdfDoc.getPages().map((page) => page.getSize())
  };
}

export async function extractEditableDocumentText(file: AppFile, pageNumber?: number): Promise<string> {
  const type = editableTypeFromFile(file);
  if (type === "txt") return pageNumber && pageNumber > 1 ? "" : readText(file.uri);
  if (type !== "pdf") return "";

  const bytes = await readBytes(file.uri);
  try {
    const extracted = await extractPdfTextWithPdfJs(bytes, pageNumber);
    if (extracted) return extracted;
  } catch (error) {
    console.warn("PDF.js text extraction failed, falling back to content streams", error);
  }

  return extractTextFromPdfContentStreams(bytes, pageNumber);
}

export async function applyDocumentEdits({
  file,
  layers,
  pagePlan
}: {
  file: AppFile;
  layers: DocumentEditLayer[];
  pagePlan?: DocumentPagePlanItem[];
}): Promise<{ output: ConvertedFile; pageCount: number }> {
  const sourcePdfDoc = await loadEditablePdf(file);
  const pdfDoc = await buildPlannedPdf(sourcePdfDoc, pagePlan);
  const pageCount = pdfDoc.getPageCount();
  const { degrees, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;

  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(await loadAssetBytes(regularFontAsset));
  const bold = await pdfDoc.embedFont(await loadAssetBytes(boldFontAsset));

  const cleanLayers = layers
    .filter((layer) => layer.type === "redaction" || layer.text.trim().length > 0 || Boolean(layer.imageUri) || (layer.points?.length ?? 0) > 1)
    .sort((left, right) => documentLayerExportWeight(left) - documentLayerExportWeight(right));

  for (const layer of cleanLayers) {
    const safePageNumber = Math.min(Math.max(1, layer.page), pageCount);
    const page = pdfDoc.getPage(safePageNumber - 1);
    const { width, height } = page.getSize();
    const box = {
      x: layer.x * width,
      y: height - layer.y * height - layer.height * height,
      width: layer.width * width,
      height: layer.height * height
    };
    const rotation = degrees(layer.rotation ?? 0);

    if (layer.type === "pen" || layer.type === "highlight") {
      const points = layer.points ?? [];
      const color = colorToRgb(layer.color ?? (layer.type === "highlight" ? "#FFEB3B" : "#111827"));
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        if (previous.move || current.move) continue;
        page.drawLine({
          start: { x: previous.x * width, y: height - previous.y * height },
          end: { x: current.x * width, y: height - current.y * height },
          thickness: layer.lineWidth ?? (layer.type === "highlight" ? 10 : 2),
          color: rgb(color.r, color.g, color.b),
          opacity: layer.type === "highlight" ? 0.38 : 0.95
        });
      }
      continue;
    }

    if (layer.type === "redaction") {
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        color: rgb(1, 1, 1),
        opacity: 1
      });
      continue;
    }

    if (layer.type === "inkSignature") {
      const points = layer.points ?? [];
      const color = colorToRgb(layer.color ?? "#111827");
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        if (previous.move || current.move) continue;
        const start = rotateBoxPoint(
          { x: box.x + previous.x * box.width, y: box.y + box.height - previous.y * box.height },
          box,
          layer.rotation ?? 0
        );
        const end = rotateBoxPoint(
          { x: box.x + current.x * box.width, y: box.y + box.height - current.y * box.height },
          box,
          layer.rotation ?? 0
        );
        page.drawLine({
          start,
          end,
          thickness: layer.lineWidth ?? 2.4,
          color: rgb(color.r, color.g, color.b),
          opacity: 0.98
        });
      }
      continue;
    }

    if ((layer.type === "imageSignature" || layer.type === "qrSignature") && layer.imageUri) {
      const bytes = await readBytes(layer.imageUri);
      const image = layer.imageMimeType?.includes("png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
      const imageRatio = image.width / Math.max(1, image.height);
      const boxRatio = box.width / Math.max(1, box.height);
      const drawWidth = imageRatio > boxRatio ? box.width : box.height * imageRatio;
      const drawHeight = imageRatio > boxRatio ? box.width / imageRatio : box.height;
      page.drawImage(image, {
        x: box.x + (box.width - drawWidth) / 2,
        y: box.y + (box.height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
        opacity: 0.96,
        rotate: rotation
      });
      continue;
    }

    if (layer.type === "qrSignature") {
      drawVisualQr(page, box, layer.text || file.name, rgb, layer.rotation ?? 0);
      continue;
    }

    if (layer.type === "typedSignature") {
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        borderColor: rgb(0.87, 0.16, 0.48),
        borderWidth: 1,
        color: rgb(1, 0.97, 0.99),
        opacity: 0.94
      });
      const displayText = layer.text.trim().slice(0, 52);
      page.drawText(displayText, {
        x: box.x + 10,
        y: box.y + box.height * 0.48,
        size: Math.max(10, Math.min(22, box.height * 0.24)),
        font: bold,
        color: rgb(0.08, 0.08, 0.1),
        rotate: rotation
      });
      page.drawLine({
        start: { x: box.x + 10, y: box.y + box.height * 0.36 },
        end: { x: box.x + box.width - 10, y: box.y + box.height * 0.36 },
        thickness: 0.8,
        color: rgb(0.87, 0.16, 0.48)
      });
      page.drawText(new Date().toLocaleDateString(), {
        x: box.x + 10,
        y: box.y + 10,
        size: 8,
        font,
        color: rgb(0.42, 0.42, 0.46)
      });
    } else {
      if (layer.backgroundColor && layer.backgroundColor !== "transparent") {
        const background = colorToRgb(layer.backgroundColor);
        page.drawRectangle({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          color: rgb(background.r, background.g, background.b),
          opacity: layer.backgroundColor === "#FFEB3B" ? 0.34 : 0.2
        });
      }
      const layerFont = layer.fontWeight === "700" || layer.fontWeight === "900" ? bold : font;
      const fontSize = Math.max(8, Math.min(layer.fontSize ?? 13, box.height * 0.55));
      const lines = wrapText(layer.text.trim(), Math.max(18, Math.floor(box.width / (fontSize * 0.48)))).slice(0, 4);
      let cursorY = box.y + box.height - fontSize - 8;
      for (const line of lines) {
        const lineWidth = layerFont.widthOfTextAtSize(line, fontSize);
        const align = layer.textAlign ?? "center";
        const textX = align === "left"
          ? box.x + 8
          : align === "right"
            ? Math.max(box.x + 8, box.x + box.width - lineWidth - 8)
            : box.x + Math.max(8, (box.width - lineWidth) / 2);
        page.drawText(line, {
          x: textX,
          y: cursorY,
          size: fontSize,
          font: layerFont,
          color: rgb(0.08, 0.08, 0.1),
          rotate: rotation
        });
        if (layer.textDecorationLine === "underline" || layer.textDecorationLine === "line-through") {
          const lineY = layer.textDecorationLine === "underline" ? cursorY - 2 : cursorY + fontSize * 0.38;
          page.drawLine({
            start: rotateBoxPoint({ x: textX, y: lineY }, box, layer.rotation ?? 0),
            end: rotateBoxPoint({ x: textX + lineWidth, y: lineY }, box, layer.rotation ?? 0),
            thickness: Math.max(0.6, fontSize * 0.06),
            color: rgb(0.08, 0.08, 0.1)
          });
        }
        cursorY -= fontSize + 4;
      }
    }
  }

  const outputBase64 = await pdfDoc.saveAsBase64();
  const output = await writePdfOutput(file.name, outputBase64);
  return { output, pageCount };
}

async function loadEditablePdf(file: AppFile) {
  const { PDFDocument } = await import("pdf-lib");
  const type = editableTypeFromFile(file);

  if (type === "pdf") {
    return PDFDocument.load(await readBytes(file.uri));
  }

  const pdfDoc = await PDFDocument.create();
  if (type === "jpg" || type === "png") {
    const bytes = await readBytes(file.uri);
    const image = type === "png" ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    const maxWidth = 595;
    const maxHeight = 842;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const page = pdfDoc.addPage([Math.max(320, image.width * scale), Math.max(320, image.height * scale)]);
    const { width, height } = page.getSize();
    page.drawImage(image, {
      x: (width - image.width * scale) / 2,
      y: (height - image.height * scale) / 2,
      width: image.width * scale,
      height: image.height * scale
    });
    return pdfDoc;
  }

  if (type === "txt") {
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const { rgb } = await import("pdf-lib");
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(await loadAssetBytes(regularFontAsset));
    let page = pdfDoc.addPage([595, 842]);
    let y = 792;
    const text = await readText(file.uri);
    for (const line of text.split(/\r?\n/).flatMap((line) => wrapText(line || " ", 86))) {
      if (y < 50) {
        page = pdfDoc.addPage([595, 842]);
        y = 792;
      }
      page.drawText(line, { x: 42, y, size: 11, font, color: rgb(0.12, 0.12, 0.14) });
      y -= 16;
    }
    return pdfDoc;
  }

  throw new Error("ERR_EDITOR_UNSUPPORTED");
}

async function buildPlannedPdf(sourcePdfDoc: any, pagePlan?: DocumentPagePlanItem[]) {
  const sourcePageCount = sourcePdfDoc.getPageCount();
  const defaultPlan: DocumentPagePlanItem[] = Array.from({ length: sourcePageCount }, (_, index) => ({ id: `source_${index + 1}`, sourcePage: index + 1 }));
  const safePlan: DocumentPagePlanItem[] = pagePlan?.length
    ? pagePlan.filter((page) => page.blank || (page.sourcePage && page.sourcePage >= 1 && page.sourcePage <= sourcePageCount))
    : defaultPlan;

  if (!pagePlan?.length) return sourcePdfDoc;

  const { PDFDocument } = await import("pdf-lib");
  const outputPdfDoc = await PDFDocument.create();
  const copiedPages = await outputPdfDoc.copyPages(
    sourcePdfDoc,
    safePlan
      .map((page) => page.sourcePage)
      .filter((sourcePage): sourcePage is number => typeof sourcePage === "number")
      .map((sourcePage) => sourcePage - 1)
  );
  let copiedIndex = 0;

  for (const plannedPage of safePlan) {
    if (plannedPage.blank) {
      const referencePage = sourcePdfDoc.getPage(Math.min(sourcePageCount - 1, Math.max(0, (plannedPage.sourcePage ?? 1) - 1)));
      const { width, height } = referencePage.getSize();
      outputPdfDoc.addPage([width, height]);
      continue;
    }

    const copiedPage = copiedPages[copiedIndex];
    if (copiedPage) outputPdfDoc.addPage(copiedPage);
    copiedIndex += 1;
  }

  return outputPdfDoc;
}

function editableTypeFromFile(file: AppFile) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeType = file.mimeType?.toLowerCase() ?? "";
  if (extension === "pdf" || mimeType.includes("pdf")) return "pdf";
  if (extension === "jpg" || extension === "jpeg" || mimeType === "image/jpeg") return "jpg";
  if (extension === "png" || mimeType === "image/png") return "png";
  if (extension === "txt" || mimeType.startsWith("text/")) return "txt";
  return null;
}

function documentLayerExportWeight(layer: DocumentEditLayer) {
  if (layer.type === "pen" || layer.type === "highlight") return 10;
  if (layer.type === "redaction") return 20;
  return 30;
}

async function extractTextFromPdfContentStreams(bytes: Uint8Array, pageNumber?: number) {
  const { inflate } = await import("pako");
  const source = bytesToLatin1(bytes);
  const streams: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;

  while ((streamMatch = streamPattern.exec(source))) {
    const rawStream = latin1ToBytes(streamMatch[1]);
    let decoded = "";
    try {
      decoded = bytesToLatin1(inflate(rawStream));
    } catch {
      decoded = streamMatch[1];
    }
    if (decoded.includes("BT") && decoded.includes("ET")) streams.push(decoded);
  }

  const pages = streams
    .map((stream) => cleanupExtractedPdfText(extractTextChunksFromPdfStream(stream).join(" ")))
    .filter(Boolean);

  if (pageNumber) return pages[pageNumber - 1] ?? "";
  return pages.join("\n\n").trim();
}

function extractTextChunksFromPdfStream(stream: string) {
  const textChunks: string[] = [];
  for (const match of stream.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g)) {
    textChunks.push(decodePdfHexString(match[1]));
  }
  for (const match of stream.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    textChunks.push(decodePdfLiteralString(match[0].replace(/\s*Tj$/, "")));
  }
  for (const match of stream.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    const arraySource = match[1];
    for (const hex of arraySource.matchAll(/<([0-9a-fA-F\s]+)>/g)) {
      textChunks.push(decodePdfHexString(hex[1]));
    }
    for (const literal of arraySource.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      textChunks.push(decodePdfLiteralString(literal[0]));
    }
  }
  return textChunks;
}

function bytesToLatin1(bytes: Uint8Array) {
  let output = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return output;
}

function latin1ToBytes(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 255;
  }
  return bytes;
}

function decodePdfHexString(value: string) {
  const hex = value.replace(/\s+/g, "");
  const paddedHex = hex.length % 2 ? `${hex}0` : hex;
  const bytes = new Uint8Array(paddedHex.length / 2);
  for (let index = 0; index < paddedHex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(paddedHex.slice(index, index + 2), 16);
  }

  if (bytes.length > 1 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16Be(bytes.slice(2));
  if (bytes.length > 1 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16Le(bytes.slice(2));
  if (bytes.length > 2 && bytes[0] === 0 && bytes[2] === 0) return decodeUtf16Be(bytes);
  return decodePdfByteString(bytes);
}

function decodePdfLiteralString(value: string) {
  const content = value.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char !== "\\") {
      bytes.push(content.charCodeAt(index) & 255);
      continue;
    }
    index += 1;
    const escaped = content[index];
    if (escaped === "n") bytes.push(10);
    else if (escaped === "r") bytes.push(13);
    else if (escaped === "t") bytes.push(9);
    else if (escaped === "b") bytes.push(8);
    else if (escaped === "f") bytes.push(12);
    else if (escaped === "\\" || escaped === "(" || escaped === ")") bytes.push(escaped.charCodeAt(0));
    else if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      for (let extra = 0; extra < 2 && /[0-7]/.test(content[index + 1] ?? ""); extra += 1) {
        index += 1;
        octal += content[index];
      }
      bytes.push(Number.parseInt(octal, 8));
    }
  }
  return decodePdfByteString(new Uint8Array(bytes));
}

function decodePdfByteString(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return bytesToLatin1(bytes);
  }
}

function decodeUtf16Be(bytes: Uint8Array) {
  let output = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }
  return output;
}

function decodeUtf16Le(bytes: Uint8Array) {
  let output = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    output += String.fromCharCode(bytes[index] | (bytes[index + 1] << 8));
  }
  return output;
}

function cleanupExtractedPdfText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\s+([.,:;!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function colorToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(
    normalized.length === 3 ? normalized.split("").map((char) => `${char}${char}`).join("") : normalized,
    16
  );
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255
  };
}

function rotateBoxPoint(
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
  rotation: number
) {
  if (!rotation) return point;
  const radians = (rotation * Math.PI) / 180;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  return {
    x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians)
  };
}

function drawVisualQr(
  page: { drawRectangle: (options: any) => void },
  box: { x: number; y: number; width: number; height: number },
  value: string,
  rgb: (r: number, g: number, b: number) => any,
  rotation: number
) {
  const size = 15;
  const cells = createQrCells(value);
  const side = Math.min(box.width, box.height);
  const originX = box.x + (box.width - side) / 2;
  const originY = box.y + (box.height - side) / 2;
  const cellSize = side / size;
  const centerBox = { x: originX, y: originY, width: side, height: side };

  cells.forEach((active, index) => {
    if (!active) return;
    const x = index % size;
    const y = Math.floor(index / size);
    const point = rotateBoxPoint(
      { x: originX + x * cellSize, y: originY + (size - y - 1) * cellSize },
      centerBox,
      rotation
    );
    page.drawRectangle({
      x: point.x,
      y: point.y,
      width: cellSize * 0.9,
      height: cellSize * 0.9,
      color: rgb(0.06, 0.06, 0.07)
    });
  });
}

function createQrCells(value: string) {
  const size = 15;
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) >>> 0;
  }
  return Array.from({ length: size * size }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const finder =
      (x < 5 && y < 5) ||
      (x > size - 6 && y < 5) ||
      (x < 5 && y > size - 6);
    if (finder) {
      const localX = x < 5 ? x : x - (size - 5);
      const localY = y < 5 ? y : y - (size - 5);
      return localX === 0 || localX === 4 || localY === 0 || localY === 4 || (localX === 2 && localY === 2);
    }
    const noise = (seed + x * 17 + y * 29 + x * y * 7) % 11;
    return noise === 0 || noise === 2 || noise === 5 || noise === 7;
  });
}

function makeVisualHash(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return `QR-${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}

async function writePdfOutput(sourceName: string, base64: string): Promise<ConvertedFile> {
  const name = createEditedName(sourceName);
  if (Platform.OS === "web") {
    return {
      name,
      uri: URL.createObjectURL(new Blob([base64ToUint8Array(base64)], { type: "application/pdf" })),
      mimeType: "application/pdf",
      uti: "com.adobe.pdf"
    };
  }

  await ensureEditedDirectory();
  const uri = `${editedDir}${name}`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64
  });
  return {
    name,
    uri,
    mimeType: "application/pdf",
    uti: "com.adobe.pdf"
  };
}

function createEditedName(sourceName: string) {
  const baseName = sourceName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${baseName || "document"}_edited_${Date.now()}.pdf`;
}

async function ensureEditedDirectory() {
  if (Platform.OS === "web") return;
  const info = await FileSystem.getInfoAsync(editedDir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(editedDir, { intermediates: true });
}

async function readBytes(uri: string) {
  if (Platform.OS === "web") return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return base64ToUint8Array(
    await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    })
  );
}

async function readText(uri: string) {
  if (Platform.OS === "web") return (await fetch(uri)).text();
  return FileSystem.readAsStringAsync(uri);
}

async function readBase64(uri: string) {
  if (Platform.OS !== "web") {
    return FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    });
  }

  const blob = await (await fetch(uri)).blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("ERR_PREVIEW_READ"));
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.readAsDataURL(blob);
  });
}

function getReadAccessRoot(uri: string) {
  if (FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory)) return FileSystem.cacheDirectory;
  if (FileSystem.documentDirectory && uri.startsWith(FileSystem.documentDirectory)) return FileSystem.documentDirectory;
  return uri.slice(0, uri.lastIndexOf("/") + 1);
}

async function loadAssetBytes(moduleId: number) {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (Platform.OS === "web") return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return base64ToUint8Array(
    await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    })
  );
}

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [" "];
}

function createPreviewShell(body: string) {
  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0f1117;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background:
          radial-gradient(circle at 20% 0%, rgba(245, 133, 41, 0.14), transparent 28%),
          radial-gradient(circle at 100% 20%, rgba(129, 52, 175, 0.18), transparent 30%),
          #111318;
      }
      iframe, embed {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        background: #ffffff;
      }
      embed {
        z-index: 1;
      }
      iframe {
        z-index: 2;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .text-preview {
        align-items: flex-start;
        justify-content: flex-start;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        background: #ffffff;
      }
      pre {
        box-sizing: border-box;
        width: 100%;
        min-height: 100%;
        margin: 0;
        padding: 22px;
        color: #202124;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 15px;
        line-height: 1.55;
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function base64ToUint8Array(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const cleaned = base64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of cleaned) {
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}
