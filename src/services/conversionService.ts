import * as FileSystem from "expo-file-system/legacy";
import { Asset } from "expo-asset";
import { Platform } from "react-native";
import type JSZip from "jszip";
import { AppFile, ConvertedFile, FileType } from "../types";
import { extensionFor, mimeByType, supportedConversions } from "./conversionTypes";
import { detectFileTypeInfo, fileTypeFromDetection } from "./fileTypeDetector";
import { compressUploadedPdf, convertUploadedImagesToPdf, convertUploadedMediaFile } from "./mediaDownloaderApi";
import { loadPdfDocumentOnWeb } from "./pdfDocumentLoader";

const MAX_FILE_BYTES = 250 * 1024 * 1024;
const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;
const MAX_SPREADSHEET_ROWS = 50000;
const MAX_SPREADSHEET_COLUMNS = 200;
const MAX_SPREADSHEET_CELLS = 200000;
const outputDir = `${FileSystem.documentDirectory ?? ""}converted/`;
const regularFontAsset = require("../../assets/fonts/LiberationSans-Regular.ttf");
const boldFontAsset = require("../../assets/fonts/LiberationSans-Bold.ttf");

type ConvertParams = {
  files: AppFile[];
  inputType: FileType;
  outputType: FileType;
  gifTrim?: {
    startSeconds: number;
    durationSeconds: number;
  };
  onProgress: (progress: number) => void;
};

type ConvertResult = {
  outputs: ConvertedFile[];
};

export type PdfCompressionResult = {
  output: ConvertedFile;
  originalBytes: number;
  compressedBytes: number;
  savedBytes: number;
  savedPercent: number;
};

type UdfImage = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  name?: string;
};

type UdfDocument = {
  text: string;
  images: UdfImage[];
};

export async function convertFiles(params: ConvertParams): Promise<ConvertResult> {
  const { files, inputType, outputType, gifTrim, onProgress } = params;
  const definition = supportedConversions.find(
    (conversion) => conversion.input === inputType && conversion.output === outputType
  );

  if (!definition) {
    throw new Error("Unsupported conversion pair.");
  }

  await ensureOutputDirectory();
  validateFiles(files, inputType);

  if (definition.nativeRequired) {
    throw new Error("ERR_UNSUPPORTED_CONVERSION");
  }

  if ((inputType === "jpg" || inputType === "png") && outputType === "pdf") {
    onProgress(0.1);
    const output = await imagesToSinglePdf(files, inputType);
    onProgress(1);
    return { outputs: [output] };
  }

  const outputs: ConvertedFile[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
      const output =
        inputType === "pdf" && outputType === "udf"
          ? await pdfToUdf(file)
        : inputType === "udf" && isUdfDocumentOutput(outputType)
          ? await udfToDocument(file, outputType)
        : inputType === "pdf" && (outputType === "jpg" || outputType === "png")
          ? await pdfToImages(file, outputType)
        : inputType === "txt" && outputType === "pdf"
            ? await txtToPdf(file)
          : inputType === "docx" && outputType === "pdf"
            ? await docxToPdf(file)
            : inputType === "xlsx" && outputType === "csv"
              ? await xlsxToCsv(file)
              : inputType === "csv" && outputType === "xlsx"
                ? await csvToXlsx(file)
                : isBackendMediaPair(inputType, outputType)
                  ? await backendMediaConvert(file, inputType, outputType, gifTrim)
                  : null;

    if (!output) {
      throw new Error("ERR_UNSUPPORTED_CONVERSION");
    }

    outputs.push(...(Array.isArray(output) ? output : [output]));
    onProgress((index + 1) / files.length);
  }

  return { outputs };
}

export async function compressPdfFile(file: AppFile): Promise<PdfCompressionResult> {
  validateFiles([file], "pdf");
  const uploadFile =
    Platform.OS === "web"
      ? await readWebBlob(file.uri)
      : {
          uri: file.uri,
          name: file.name,
          type: file.mimeType ?? mimeByType.pdf
        };
  const result = await compressUploadedPdf({
    file: uploadFile,
    filename: file.name
  });

  return {
    output: {
      name: createCompressedPdfOutputName(file.name),
      uri: result.fileUrl,
      mimeType: mimeByType.pdf,
      uti: "com.adobe.pdf"
    },
    originalBytes: result.originalBytes,
    compressedBytes: result.compressedBytes,
    savedBytes: result.savedBytes,
    savedPercent: result.savedPercent
  };
}

async function pdfToImages(file: AppFile, outputType: FileType): Promise<ConvertedFile[]> {
  if (Platform.OS !== "web") {
    const result = await convertUploadedMediaFile({
      file: {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/pdf"
      },
      filename: file.name,
      outputFormat: outputType as "jpg" | "png"
    });
    const files = "files" in result ? result.files : [result];
    return files.map((item, index) => ({
      name: createOutputName(addPageSuffix(file.name, index + 1), outputType),
      uri: item.fileUrl,
      mimeType: mimeByType[outputType]
    }));
  }

  const pdf = await loadPdfDocumentOnWeb(new Uint8Array(await readWebArrayBuffer(file.uri)));
  const outputs: ConvertedFile[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare PDF page rendering.");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    const blob = await canvasToBlob(canvas, mimeByType[outputType], outputType === "jpg" ? 0.92 : undefined);
    outputs.push(makeWebOutput(addPageSuffix(file.name, pageNumber), outputType, blob));
  }

  return outputs;
}

async function pdfToUdf(file: AppFile): Promise<ConvertedFile> {
  const uploadFile =
    Platform.OS === "web"
      ? await readWebBlob(file.uri)
      : {
          uri: file.uri,
          name: file.name,
          type: file.mimeType ?? "application/pdf"
        };
  const result = await convertUploadedMediaFile({
    file: uploadFile,
    filename: file.name,
    outputFormat: "udf"
  });
  if ("files" in result) throw new Error("ERR_CONVERSION_FAILED");
  return {
    name: createOutputName(file.name, "udf"),
    uri: result.fileUrl,
    mimeType: mimeByType.udf
  };
}

function validateFiles(files: AppFile[], inputType: FileType) {
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("ERR_FILE_TOO_LARGE");
    }

    const detectedType = fileTypeFromDetection(detectFileTypeInfo(file));
    if (detectedType !== inputType) {
      throw new Error("ERR_TYPE_MISMATCH");
    }
  }
}

async function ensureOutputDirectory() {
  if (Platform.OS === "web") return;

  const info = await FileSystem.getInfoAsync(outputDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
  }
}

async function imageToPdf(file: AppFile, inputType: FileType): Promise<ConvertedFile> {
  if (Platform.OS === "web") {
    const { jsPDF } = await import("jspdf");
    const dataUrl = await readWebDataUrl(file.uri);
    const imageSize = await readWebImageSize(dataUrl);
    const pdf = new jsPDF({
      orientation: imageSize.width >= imageSize.height ? "landscape" : "portrait",
      unit: "pt",
      format: [imageSize.width, imageSize.height]
    });
    pdf.addImage(dataUrl, inputType === "png" ? "PNG" : "JPEG", 0, 0, imageSize.width, imageSize.height);
    return makeWebOutput(file.name, "pdf", pdf.output("blob"));
  }

  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const imageBytes = base64ToUint8Array(
    await FileSystem.readAsStringAsync(file.uri, {
      encoding: FileSystem.EncodingType.Base64
    })
  );
  const jpg = inputType === "png" ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
  const page = pdf.addPage([jpg.width, jpg.height]);
  page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
  const outputBase64 = await pdf.saveAsBase64();
  return writeBase64Output(file.name, "pdf", outputBase64);
}

async function imagesToSinglePdf(files: AppFile[], inputType: FileType): Promise<ConvertedFile> {
  const sourceName = files.length === 1 ? files[0].name : "selected_images";

  if (Platform.OS === "web") {
    const { jsPDF } = await import("jspdf");
    let pdf: InstanceType<typeof jsPDF> | null = null;

    for (const [index, file] of files.entries()) {
      const dataUrl = await readWebDataUrl(file.uri);
      const imageSize = await readWebImageSize(dataUrl);
      const orientation = imageSize.width >= imageSize.height ? "landscape" : "portrait";
      if (!pdf) {
        pdf = new jsPDF({
          orientation,
          unit: "pt",
          format: [imageSize.width, imageSize.height]
        });
      } else {
        pdf.addPage([imageSize.width, imageSize.height], orientation);
      }
      pdf.addImage(dataUrl, inputType === "png" ? "PNG" : "JPEG", 0, 0, imageSize.width, imageSize.height);
      if (index === files.length - 1 && !pdf) throw new Error("ERR_CONVERSION_FAILED");
    }

    if (!pdf) throw new Error("ERR_CONVERSION_FAILED");
    return makeWebOutput(sourceName, "pdf", pdf.output("blob"));
  }

  const result = await convertUploadedImagesToPdf({
    files: files.map((file) => ({
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? mimeByType[inputType] ?? "application/octet-stream"
    })),
    filename: sourceName
  });
  return {
    name: createOutputName(sourceName, "pdf"),
    uri: result.fileUrl,
    mimeType: mimeByType.pdf,
    uti: "com.adobe.pdf"
  };
}

async function txtToPdf(file: AppFile): Promise<ConvertedFile> {
  const text =
    Platform.OS === "web"
      ? await readWebText(file.uri)
      : await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.UTF8
        });
  const outputBase64 = await makeTextPdf({ text, images: [] }, file.name);
  return writeBase64Output(file.name, "pdf", outputBase64);
}

async function udfToDocument(file: AppFile, outputType: FileType): Promise<ConvertedFile> {
  const udfDocument = await readUdfDocument(file);

  if (outputType === "pdf") {
    const outputBase64 = await makeTextPdf(udfDocument, file.name);
    return writeBase64Output(file.name, "pdf", outputBase64);
  }

  if (outputType === "txt") {
    return writeTextOutput(file.name, "txt", udfDocument.text);
  }

  if (outputType === "rtf") {
    return writeTextOutput(file.name, "rtf", makeRtfDocument(udfDocument));
  }

  if (outputType === "doc") {
    return writeTextOutput(file.name, "doc", makeDocHtml(udfDocument));
  }

  if (outputType === "docx") {
    return writeZipDocumentOutput(file.name, "docx", await makeDocxBase64(udfDocument));
  }

  if (outputType === "odt") {
    return writeZipDocumentOutput(file.name, "odt", await makeOdtBase64(udfDocument));
  }

  throw new Error("ERR_UNSUPPORTED_CONVERSION");
}

async function docxToPdf(file: AppFile): Promise<ConvertedFile> {
  const mammoth = await import("mammoth");
  const arrayBuffer =
    Platform.OS === "web"
      ? await readWebArrayBuffer(file.uri)
      : base64ToUint8Array(
          await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.Base64
          })
        ).buffer;
  const raw = await mammoth.extractRawText({ arrayBuffer });
  const outputBase64 = await makeTextPdf({ text: raw.value, images: [] }, file.name);
  return writeBase64Output(file.name, "pdf", outputBase64);
}

async function xlsxToCsv(file: AppFile): Promise<ConvertedFile> {
  validateSpreadsheetFileSize(file);
  const csv = await readFirstXlsxSheetAsCsv(file);
  return writeTextOutput(file.name, "csv", csv);
}

async function csvToXlsx(file: AppFile): Promise<ConvertedFile> {
  validateSpreadsheetFileSize(file);
  const csv =
    Platform.OS === "web"
      ? await readWebText(file.uri)
      : await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.UTF8
        });
  const rows = parseCsvRows(csv);
  validateCsvSize(rows);
  return writeZipDocumentOutput(file.name, "xlsx", await makeXlsxBase64(rows));
}

function validateSpreadsheetFileSize(file: AppFile) {
  if (file.size > MAX_SPREADSHEET_BYTES) {
    throw new Error("ERR_SPREADSHEET_TOO_LARGE");
  }
}

function parseCsvRows(csv: string) {
  return csv.split(/\r?\n/).map((line) => line.split(","));
}

function validateCsvSize(rows: string[][]) {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  validateSpreadsheetDimensions(rows.length, columns);
}

function validateSpreadsheetDimensions(rows: number, columns: number) {
  if (
    rows > MAX_SPREADSHEET_ROWS ||
    columns > MAX_SPREADSHEET_COLUMNS ||
    rows * columns > MAX_SPREADSHEET_CELLS
  ) {
    throw new Error("ERR_SPREADSHEET_TOO_LARGE");
  }
}

async function readFirstXlsxSheetAsCsv(file: AppFile) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFileBytes(file));
  const worksheetPath = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];

  if (!worksheetPath) {
    throw new Error("ERR_FILE_READ_FAILED");
  }

  const sharedStrings = await readXlsxSharedStrings(zip);
  const worksheetXml = await zip.file(worksheetPath)?.async("text");
  if (!worksheetXml) {
    throw new Error("ERR_FILE_READ_FAILED");
  }

  const rows: string[][] = [];
  let maxColumn = 0;
  for (const rowMatch of worksheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const cellRef = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1];
      const columnIndex = cellRef ? columnNameToIndex(cellRef) : row.length;
      row[columnIndex] = readXlsxCellValue(attrs, body, sharedStrings);
      maxColumn = Math.max(maxColumn, columnIndex + 1);
    }
    rows.push(row);
  }

  validateSpreadsheetDimensions(rows.length, maxColumn);
  return rows
    .map((row) =>
      Array.from({ length: maxColumn }, (_, index) => escapeCsvCell(row[index] ?? "")).join(",")
    )
    .join("\n");
}

async function readXlsxSharedStrings(zip: JSZip) {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("text");
  if (!xml) return [];

  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)).map((match) =>
    decodeXmlEntities(
      Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))
        .map((textMatch) => textMatch[1])
        .join("")
    )
  );
}

function readXlsxCellValue(attrs: string, body: string, sharedStrings: string[]) {
  const type = attrs.match(/\bt="([^"]+)"/i)?.[1];
  if (type === "inlineStr") {
    return decodeXmlEntities(
      Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))
        .map((match) => match[1])
        .join("")
    );
  }

  const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";
  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }

  if (type === "b") {
    return rawValue === "1" ? "TRUE" : "FALSE";
  }

  return decodeXmlEntities(rawValue);
}

async function makeXlsxBase64(rows: string[][]) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  const xl = zip.folder("xl");
  xl?.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  xl?.folder("_rels")?.file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  xl?.file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`);
  xl?.folder("worksheets")?.file("sheet1.xml", makeXlsxWorksheetXml(rows));
  return zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}

function makeXlsxWorksheetXml(rows: string[][]) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnIndexToName(columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function columnNameToIndex(name: string) {
  return name
    .toUpperCase()
    .split("")
    .reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function columnIndexToName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function escapeCsvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function isBackendMediaPair(inputType: FileType, outputType: FileType) {
  return (
    ((inputType === "jpg" || inputType === "png" || inputType === "webp") &&
      (outputType === "jpg" || outputType === "png" || outputType === "webp") &&
      inputType !== outputType) ||
    (outputType === "mp3" &&
      (inputType === "mp4" || inputType === "avi" || inputType === "mov" || inputType === "mkv" || inputType === "webm")) ||
    (outputType === "mp4" &&
      (inputType === "avi" || inputType === "mov" || inputType === "mkv" || inputType === "webm" || inputType === "gif")) ||
    (inputType === "mp3" && outputType === "wav") ||
    (inputType === "wav" && outputType === "mp3") ||
    (inputType === "mp4" && outputType === "gif") ||
    (inputType === "mov" && outputType === "gif") ||
    (inputType === "gif" && outputType === "mp4")
  );
}

async function backendMediaConvert(
  file: AppFile,
  inputType: FileType,
  outputType: FileType,
  gifTrim?: ConvertParams["gifTrim"]
): Promise<ConvertedFile> {
  const uploadFile =
    Platform.OS === "web"
      ? await readWebBlob(file.uri)
      : {
          uri: file.uri,
          name: file.name,
          type: file.mimeType ?? mimeByType[inputType] ?? "application/octet-stream"
        };
  const result = await convertUploadedMediaFile({
    file: uploadFile,
    filename: file.name,
    outputFormat: outputType as "mp3" | "mp4" | "gif" | "jpg" | "png" | "webp" | "wav" | "udf",
    trimStartSeconds: outputType === "gif" ? gifTrim?.startSeconds : undefined,
    trimDurationSeconds: outputType === "gif" ? gifTrim?.durationSeconds : undefined
  });
  if ("files" in result) throw new Error("ERR_CONVERSION_FAILED");
  return {
    name: createOutputName(file.name, outputType),
    uri: result.fileUrl,
    mimeType: mimeByType[outputType]
  };
}

async function makeTextPdf(document: UdfDocument, title: string) {
  if (Platform.OS === "web") {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    pdf.addFileToVFS("LiberationSans-Regular.ttf", uint8ArrayToBase64(await loadAssetBytes(regularFontAsset)));
    pdf.addFileToVFS("LiberationSans-Bold.ttf", uint8ArrayToBase64(await loadAssetBytes(boldFontAsset)));
    pdf.addFont("LiberationSans-Regular.ttf", "LiberationSans", "normal");
    pdf.addFont("LiberationSans-Bold.ttf", "LiberationSans", "bold");
    const margin = 48;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let y = margin;

    pdf.setFont("LiberationSans", "bold");
    pdf.setFontSize(16);
    pdf.text(title, margin, y);
    y += 28;

    pdf.setFont("LiberationSans", "normal");
    pdf.setFontSize(11);
    const lines = pdf.splitTextToSize(document.text || " ", pageWidth - margin * 2);
    for (const line of lines) {
      if (y > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += 16;
    }

    for (const image of document.images) {
      const dataUrl = bytesToDataUrl(image.bytes, image.mimeType);
      const size = await readWebImageSize(dataUrl);
      const maxWidth = pageWidth - margin * 2;
      const maxHeight = pageHeight - margin * 2;
      const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
      const width = size.width * scale;
      const height = size.height * scale;
      if (y + height > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.addImage(dataUrl, image.mimeType === "image/png" ? "PNG" : "JPEG", margin, y, width, height);
      y += height + 18;
    }

    return arrayBufferToBase64(await pdf.output("arraybuffer"));
  }

  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await loadAssetBytes(regularFontAsset));
  const bold = await pdf.embedFont(await loadAssetBytes(boldFontAsset));
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 48;
  const lineHeight = 16;
  const fontSize = 11;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  page.drawText(title,
  {
    x: margin,
    y,
    size: 16,
    font: bold,
    color: rgb(0.08, 0.1, 0.14)
  });
  y -= 28;

  for (const line of wrapTextByWidth(document.text || " ", font, fontSize, pageWidth - margin * 2)) {
    if (y < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.08, 0.1, 0.14)
    });
    y -= lineHeight;
  }

  for (const image of document.images) {
    const embedded = image.mimeType === "image/png"
      ? await pdf.embedPng(image.bytes)
      : await pdf.embedJpg(image.bytes);
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const scale = Math.min(1, maxWidth / embedded.width, maxHeight / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;

    if (y - height < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    y -= height;
    page.drawImage(embedded, { x: margin, y, width, height });
    y -= 18;
  }

  return pdf.saveAsBase64();
}

function isUdfDocumentOutput(outputType: FileType) {
  return outputType === "pdf" || outputType === "doc" || outputType === "docx" || outputType === "rtf" || outputType === "odt" || outputType === "txt";
}

async function readTextFile(file: AppFile) {
  return Platform.OS === "web"
    ? await readWebText(file.uri)
    : await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.UTF8
      });
}

async function readUdfDocument(file: AppFile): Promise<UdfDocument> {
  const bytes = await readFileBytes(file);
  const images: UdfImage[] = [];
  let sourceText = "";

  if (isZipBytes(bytes)) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const mimeType = imageMimeFromName(entry.name);
      if (mimeType) {
        images.push({
          bytes: new Uint8Array(await entry.async("uint8array")),
          mimeType,
          name: entry.name
        });
      }
    }
    const candidate = Object.values(zip.files).find(
      (entry) =>
        !entry.dir &&
        (entry.name.toLowerCase().endsWith(".xml") ||
          entry.name.toLowerCase().endsWith(".txt") ||
          entry.name.toLowerCase().includes("content"))
    );
    if (candidate) {
      sourceText = await candidate.async("text");
    }
  } else {
    sourceText = Platform.OS === "web"
      ? new TextDecoder("utf-8").decode(bytes)
      : await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.UTF8
        });
  }

  images.push(...extractInlineImages(sourceText));
  for (const url of extractImageUrls(sourceText)) {
    const remote = await readRemoteImage(url);
    if (remote) images.push(remote);
  }

  return {
    text: extractTextFromUdf(sourceText),
    images
  };
}

async function readFileBytes(file: AppFile) {
  if (Platform.OS === "web") {
    return new Uint8Array(await readWebArrayBuffer(file.uri));
  }

  return base64ToUint8Array(
    await FileSystem.readAsStringAsync(file.uri, {
      encoding: FileSystem.EncodingType.Base64
    })
  );
}

function isZipBytes(bytes: Uint8Array) {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function extractTextFromUdf(udfText: string) {
  const withoutImages = udfText
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/data:image\/(?:png|jpe?g);base64,[a-z0-9+/=\r\n]+/gi, " ");
  const paragraphMatches = Array.from(udfText.matchAll(/<paragraph[^>]*>([\s\S]*?)<\/paragraph>/gi));
  const contentMatches = paragraphMatches.length
    ? paragraphMatches
    : Array.from(withoutImages.matchAll(/<content[^>]*>([\s\S]*?)<\/content>/gi));
  const extracted = contentMatches
    .map((match) => decodeXmlEntities(stripXmlTags(match[1])))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return extracted || decodeXmlEntities(stripXmlTags(withoutImages)).trim() || " ";
}

function stripXmlTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function makeRtfDocument(document: UdfDocument) {
  const body = document.text
    .split(/\r?\n/)
    .map((line) => line.split("").map(escapeRtfChar).join(""))
    .join("\\par\n");
  const pictures = document.images.map(makeRtfPicture).filter(Boolean).join("\\par\n");
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs22\n${body}${pictures ? `\\par\n${pictures}` : ""}\n}`;
}

function escapeRtfChar(char: string) {
  if (char === "\\") return "\\\\";
  if (char === "{") return "\\{";
  if (char === "}") return "\\}";
  const code = char.charCodeAt(0);
  if (code <= 0x7f) return char;
  const signed = code > 32767 ? code - 65536 : code;
  return `\\u${signed}?`;
}

function makeDocHtml(document: UdfDocument) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Converted UDF</title></head>
<body style="font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.45;">
${document.text.split(/\r?\n/).map((line) => `<p>${escapeXml(line || " ")}</p>`).join("\n")}
${document.images.map((image) => `<p><img alt="${escapeXml(image.name ?? "image")}" src="${bytesToDataUrl(image.bytes, image.mimeType)}" style="max-width: 100%; height: auto;" /></p>`).join("\n")}
</body>
</html>`;
}

async function loadAssetBytes(moduleId: number) {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (Platform.OS === "web") {
    return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  }
  return base64ToUint8Array(
    await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    })
  );
}

function imageMimeFromName(name: string): UdfImage["mimeType"] | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

function extractInlineImages(sourceText: string): UdfImage[] {
  const images: UdfImage[] = [];
  const pattern = /data:(image\/(?:png|jpe?g));base64,([a-z0-9+/=\r\n]+)/gi;
  for (const match of sourceText.matchAll(pattern)) {
    const mimeType = match[1].toLowerCase() === "image/png" ? "image/png" : "image/jpeg";
    images.push({
      bytes: base64ToUint8Array(match[2].replace(/\s+/g, "")),
      mimeType
    });
  }
  return images;
}

function extractImageUrls(sourceText: string) {
  const urls = new Set<string>();
  const imgPattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (const match of sourceText.matchAll(imgPattern)) {
    const url = decodeXmlEntities(match[1]);
    if (/^https?:\/\//i.test(url)) urls.add(url);
  }
  return Array.from(urls);
}

async function readRemoteImage(url: string): Promise<UdfImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const mimeType = contentType.includes("png") ? "image/png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "image/jpeg" : null;
    if (!mimeType) return null;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType,
      name: url.split("/").pop()
    };
  } catch {
    return null;
  }
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  return `data:${mimeType};base64,${uint8ArrayToBase64(bytes)}`;
}

function makeRtfPicture(image: UdfImage) {
  if (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg") return "";
  const type = image.mimeType === "image/png" ? "\\pngblip" : "\\jpegblip";
  const hex = Array.from(image.bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `{\\pict${type}\n${hex}}`;
}

function wrapTextByWidth(text: string, font: { widthOfTextAtSize: (value: string, size: number) => number }, fontSize: number, maxWidth: number) {
  const lines: string[] = [];
  for (const sourceLine of text.replace(/\t/g, "  ").split(/\r?\n/)) {
    let current = "";
    for (const word of sourceLine.split(" ")) {
      const candidate = `${current} ${word}`.trim();
      if (candidate && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current || " ");
  }
  return lines;
}

async function makeDocxBase64(document: UdfDocument) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const word = zip.folder("word");
  const media = word?.folder("media");
  const rels = word?.folder("_rels");
  const imageRelationships: string[] = [];
  document.images.forEach((image, index) => {
    const extension = image.mimeType === "image/png" ? "png" : "jpg";
    const filename = `image${index + 1}.${extension}`;
    media?.file(filename, image.bytes);
    imageRelationships.push(
      `<Relationship Id="rIdImage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>`
    );
  });
  rels?.file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${imageRelationships.join("\n")}
</Relationships>`);
  word?.file("document.xml", makeDocxDocumentXml(document));
  return zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}

function makeDocxDocumentXml(document: UdfDocument) {
  const paragraphs = document.text
    .split(/\r?\n/)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line || " ")}</w:t></w:r></w:p>`)
    .join("");
  const images = document.images.map((_, index) => makeDocxImageXml(index + 1)).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>${paragraphs}${images}<w:sectPr/></w:body>
</w:document>`;
}

function makeDocxImageXml(index: number) {
  const cx = 4572000;
  const cy = 3429000;
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index}" name="Image ${index}"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="Image ${index}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rIdImage${index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

async function makeOdtBase64(document: UdfDocument) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  const pictures = zip.folder("Pictures");
  const pictureEntries = document.images.map((image, index) => {
    const extension = image.mimeType === "image/png" ? "png" : "jpg";
    const path = `Pictures/image${index + 1}.${extension}`;
    pictures?.file(`image${index + 1}.${extension}`, image.bytes);
    return { path, mimeType: image.mimeType };
  });
  zip.folder("META-INF")?.file("manifest.xml", `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
${pictureEntries.map((entry) => `  <manifest:file-entry manifest:full-path="${entry.path}" manifest:media-type="${entry.mimeType}"/>`).join("\n")}
</manifest:manifest>`);
  zip.file("content.xml", makeOdtContentXml(document));
  return zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}

function makeOdtContentXml(document: UdfDocument) {
  const paragraphs = document.text
    .split(/\r?\n/)
    .map((line) => `<text:p>${escapeXml(line || " ")}</text:p>`)
    .join("");
  const images = document.images
    .map((image, index) => {
      const extension = image.mimeType === "image/png" ? "png" : "jpg";
      return `<text:p><draw:frame draw:name="Image${index + 1}" svg:width="14cm" svg:height="10cm" text:anchor-type="paragraph"><draw:image xlink:href="Pictures/image${index + 1}.${extension}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  office:version="1.2">
  <office:body><office:text>${paragraphs}${images}</office:text></office:body>
</office:document-content>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxLength: number) {
  const lines: string[] = [];
  for (const sourceLine of text.replace(/\t/g, "  ").split(/\r?\n/)) {
    let current = "";
    for (const word of sourceLine.split(" ")) {
      if ((current + " " + word).trim().length > maxLength) {
        lines.push(current);
        current = word;
      } else {
        current = `${current} ${word}`.trim();
      }
    }
    lines.push(current);
  }
  return lines;
}

async function writeTextOutput(sourceName: string, outputType: FileType, text: string) {
  if (Platform.OS === "web") {
    return makeWebOutput(sourceName, outputType, new Blob([text], { type: mimeByType[outputType] }));
  }

  const outputUri = createOutputUri(sourceName, outputType);
  await FileSystem.writeAsStringAsync(outputUri, text, {
    encoding: FileSystem.EncodingType.UTF8
  });
  return {
    name: outputUri.split("/").pop() ?? `converted.${outputType}`,
    uri: outputUri,
    mimeType: mimeByType[outputType]
  };
}

async function writeBase64Output(sourceName: string, outputType: FileType, base64: string) {
  if (Platform.OS === "web") {
    return makeWebOutput(sourceName, outputType, new Blob([base64ToUint8Array(base64)], {
      type: mimeByType[outputType]
    }));
  }

  const outputUri = createOutputUri(sourceName, outputType);
  await FileSystem.writeAsStringAsync(outputUri, base64, {
    encoding: FileSystem.EncodingType.Base64
  });
  return {
    name: outputUri.split("/").pop() ?? `converted.${outputType}`,
    uri: outputUri,
    mimeType: mimeByType[outputType],
    uti: outputType === "pdf" ? "com.adobe.pdf" : undefined
  };
}

async function writeZipDocumentOutput(sourceName: string, outputType: FileType, base64: string) {
  if (Platform.OS === "web") {
    return makeWebOutput(sourceName, outputType, new Blob([base64ToUint8Array(base64)], {
      type: mimeByType[outputType]
    }));
  }

  const outputUri = createOutputUri(sourceName, outputType);
  await FileSystem.writeAsStringAsync(outputUri, base64, {
    encoding: FileSystem.EncodingType.Base64
  });
  return {
    name: outputUri.split("/").pop() ?? `converted.${outputType}`,
    uri: outputUri,
    mimeType: mimeByType[outputType]
  };
}

function createOutputUri(sourceName: string, outputType: FileType) {
  const baseName = sourceName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${outputDir}${baseName}_${Date.now()}.${extensionFor(outputType)}`;
}

function makeWebOutput(sourceName: string, outputType: FileType, blob: Blob): ConvertedFile {
  const name = createOutputName(sourceName, outputType);
  return {
    name,
    uri: URL.createObjectURL(blob),
    mimeType: mimeByType[outputType],
    uti: outputType === "pdf" ? "com.adobe.pdf" : undefined
  };
}

function createOutputName(sourceName: string, outputType: FileType) {
  const baseName = sourceName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${baseName}_${Date.now()}.${extensionFor(outputType)}`;
}

function createCompressedPdfOutputName(sourceName: string) {
  const baseName = sourceName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${baseName || "document"}_compressed_${Date.now()}.pdf`;
}

async function readWebArrayBuffer(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("ERR_FILE_READ_FAILED");
  return response.arrayBuffer();
}

async function readWebText(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("ERR_FILE_READ_FAILED");
  return response.text();
}

async function readWebDataUrl(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("ERR_FILE_READ_FAILED");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not decode the selected image."));
    reader.readAsDataURL(blob);
  });
}

async function readWebBlob(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("ERR_FILE_READ_FAILED");
  return response.blob();
}

async function readWebImageSize(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error("Could not read image dimensions."));
    image.src = dataUrl;
  });
}

async function drawWebImageToBlob(dataUrl: string, mimeType: string) {
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not prepare browser image conversion."));
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("This browser could not export the requested image format."));
        },
        mimeType,
        0.92
      );
    };
    image.onerror = () => reject(new Error("Could not decode the selected image."));
    image.src = dataUrl;
  });
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("This browser could not export the rendered page."));
      },
      mimeType,
      quality
    );
  });
}

function addPageSuffix(sourceName: string, pageNumber: number) {
  return sourceName.replace(/\.[^.]+$/, `_page_${pageNumber}`);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  return uint8ArrayToBase64(bytes);
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
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
