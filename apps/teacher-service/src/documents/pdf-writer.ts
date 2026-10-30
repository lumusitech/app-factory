import type { Clock } from '@kernel/domain';

/**
 * Escritor PDF mínimo y **determinista**, compartido por los renderes de la
 * vertical (F-04 planilla oficial, ADR 0014; F-04 planilla de uso diario, ADR
 * 0017).
 *
 * No usa librería externa (ADR 0014 §6): A4, Helvetica base-14, sin compresión y
 * sin `/ID` aleatorio, de modo que **mismo input + mismo reloj ⇒ mismos bytes**.
 * Es un detalle de presentación de la vertical, no un puerto de kernel:
 * `kernel-documents`/`kernel-storage` son candidatos diferidos de D18
 * (`docs/contracts/not-extracted.md` §5).
 */

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 40;

export const FONT_REGULAR = 'F1';
export const FONT_BOLD = 'F2';

/** Codificación a bytes Latin-1/WinAnsi (una unidad de código → un byte). */
export function toLatin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/** Escapa un texto para el literal `(...)` de PDF. */
export function escapePdfText(value: string): string {
  let result = '';
  for (const character of value) {
    if (character === '\\') {
      result += '\\\\';
    } else if (character === '(') {
      result += '\\(';
    } else if (character === ')') {
      result += '\\)';
    } else {
      result += character;
    }
  }
  return result;
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Ancho aproximado (suficiente para truncar etiquetas largas de forma estable). */
export function approximateWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.5;
}

export function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0 || approximateWidth(text, fontSize) <= maxWidth) {
    return text;
  }
  let result = text;
  while (result.length > 1 && approximateWidth(`${result}...`, fontSize) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

/** Fecha `/CreationDate` del PDF, derivada del `Clock` inyectado (determinista). */
export function formatCreationDate(clock: Clock): string {
  const now = clock.now();
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0');
  return `D:${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate(),
  )}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

/** Resuelve un valor de cabecera opaco (`source` = `context.<nombre>`). */
export function resolveContextValue(
  source: string,
  context: Readonly<Record<string, string>>,
): string {
  const prefix = 'context.';
  if (!source.startsWith(prefix)) {
    return '';
  }
  return context[source.slice(prefix.length)] ?? '';
}

/** Acumula operadores de un `content stream` de PDF (texto y líneas). */
export class ContentStream {
  readonly #operations: string[] = [];

  text(x: number, y: number, fontSize: number, font: string, value: string): void {
    this.#operations.push(
      `BT /${font} ${fontSize} Tf ${round(x)} ${round(y)} Td (${escapePdfText(value)}) Tj ET`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.#operations.push(`${round(x1)} ${round(y1)} m ${round(x2)} ${round(y2)} l S`);
  }

  toString(): string {
    return this.#operations.join('\n');
  }
}

/** Ensambla los objetos y la tabla xref de un PDF mínimo determinista. */
export function assemblePdf(
  pageContents: readonly string[],
  creationDate: string,
  title: string,
  producer = 'teacher-service',
): Uint8Array {
  const bodies: string[] = [];
  const push = (body: string): number => {
    bodies.push(body);
    return bodies.length;
  };

  const catalogId = push('');
  const pagesId = push('');
  const regularFontId = push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  );
  push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  const infoId = push(
    `<< /Title (${escapePdfText(title)}) /Producer (${escapePdfText(producer)}) /CreationDate (${creationDate}) >>`,
  );

  const pageIds: number[] = [];
  for (const content of pageContents) {
    const contentId = push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /${FONT_REGULAR} ${regularFontId} 0 R /${FONT_BOLD} ${
          regularFontId + 1
        } 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  bodies[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  bodies[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [];
  for (const [index, body] of bodies.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${bodies.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return toLatin1Bytes(pdf);
}
