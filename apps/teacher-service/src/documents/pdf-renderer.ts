import type { Clock } from '@kernel/domain';

import type {
  OfficialSheetPeriodValue,
  OfficialSheetStudentRow,
  OfficialSheetView,
} from '../domain/official-sheet.js';
import type { OfficialSheetColumn, OfficialSheetTemplate } from './template.js';

/**
 * Render de la planilla oficial a **PDF** (F-04; ADR 0014).
 *
 * Corre en el **servidor** (§10) y es **determinista**: mismo input + mismo reloj
 * ⇒ mismos bytes (el `/CreationDate` sale del `Clock` inyectado; no hay
 * `/ID` aleatorio). Es una **función pura** sin dependencias externas: un
 * escritor PDF mínimo (A4, Helvetica base-14, sin compresión) alcanza para una
 * tabla con bordes. No hay puerto: un puerto con una sola implementación y un
 * solo consumidor sería abstracción prematura (ODD #1); la extracción al kernel
 * (`kernel-documents`, D18) introducirá el puerto *entonces*.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;

const TITLE_FONT_SIZE = 14;
const HEADER_FONT_SIZE = 9;
const TABLE_HEADER_FONT_SIZE = 7;
const TABLE_FONT_SIZE = 9;

const ROW_HEIGHT = 18;
const TABLE_HEADER_HEIGHT = 20;
const FIRST_COLUMN_WIDTH = 130;

const FONT_REGULAR = 'F1';
const FONT_BOLD = 'F2';

export interface OfficialSheetRenderInput {
  readonly view: OfficialSheetView;
  readonly template: OfficialSheetTemplate;
  /** Valores de cabecera opacos (`source` = `context.<nombre>`). */
  readonly context: Readonly<Record<string, string>>;
  readonly clock: Clock;
}

/** Codificación a bytes Latin-1/WinAnsi (una unidad de código → un byte). */
function toLatin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/** Escapa un texto para el literal `(...)` de PDF. */
function escapePdfText(value: string): string {
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Ancho aproximado (suficiente para truncar etiquetas largas de forma estable). */
function approximateWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.5;
}

function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0 || approximateWidth(text, fontSize) <= maxWidth) {
    return text;
  }
  let result = text;
  while (result.length > 1 && approximateWidth(`${result}...`, fontSize) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

class ContentStream {
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

function resolveContextValue(source: string, context: Readonly<Record<string, string>>): string {
  const prefix = 'context.';
  if (!source.startsWith(prefix)) {
    return '';
  }
  return context[source.slice(prefix.length)] ?? '';
}

function findPeriodValue(
  student: OfficialSheetStudentRow,
  period: string,
): OfficialSheetPeriodValue | undefined {
  return student.periods.find((value) => value.period === period);
}

function cellValue(student: OfficialSheetStudentRow, column: OfficialSheetColumn): string {
  switch (column.kind) {
    case 'grade':
      return String(findPeriodValue(student, column.period)?.grade ?? '');
    case 'trajectory':
      return findPeriodValue(student, column.period)?.trajectory ?? '';
    case 'attendance':
      return String(student.attendance[column.status]);
    /* c8 ignore next */
    default:
      return '';
  }
}

function formatCreationDate(clock: Clock): string {
  const now = clock.now();
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0');
  return `D:${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate(),
  )}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function buildPageContents(input: OfficialSheetRenderInput): string[] {
  const { view, template, context } = input;
  const columnLabels = ['Alumno', ...template.columns.map((column) => column.label)];
  const columnCount = columnLabels.length;
  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  const firstColumnWidth = Math.min(FIRST_COLUMN_WIDTH, usableWidth);
  const restWidth = (usableWidth - firstColumnWidth) / Math.max(1, columnCount - 1);
  const columnWidths = [
    firstColumnWidth,
    ...Array.from({ length: columnCount - 1 }, () => restWidth),
  ];

  const firstPageTop =
    TITLE_FONT_SIZE + 10 + template.header.length * (HEADER_FONT_SIZE + 5) + 12 + HEADER_FONT_SIZE + 8;
  const availableForRows = PAGE_HEIGHT - MARGIN * 2 - firstPageTop - TABLE_HEADER_HEIGHT;
  const rowsPerPage = Math.max(1, Math.floor(availableForRows / ROW_HEIGHT));

  const pages: OfficialSheetStudentRow[][] = [];
  for (let index = 0; index < Math.max(1, view.students.length); index += rowsPerPage) {
    pages.push(view.students.slice(index, index + rowsPerPage));
  }
  if (view.students.length === 0) {
    pages.push([]);
  }

  const tableRight = MARGIN + usableWidth;

  return pages.map((pageRows, pageIndex) => {
    const content = new ContentStream();
    let y = PAGE_HEIGHT - MARGIN;

    if (pageIndex === 0) {
      content.text(MARGIN, y - TITLE_FONT_SIZE, TITLE_FONT_SIZE, FONT_BOLD, template.title);
      y -= TITLE_FONT_SIZE + 10;
      for (const field of template.header) {
        content.text(
          MARGIN,
          y - HEADER_FONT_SIZE,
          HEADER_FONT_SIZE,
          FONT_REGULAR,
          `${field.label}: ${resolveContextValue(field.source, context)}`,
        );
        y -= HEADER_FONT_SIZE + 5;
      }
      y -= 12;
      content.text(MARGIN, y - HEADER_FONT_SIZE, HEADER_FONT_SIZE, FONT_REGULAR, `Curso: ${view.courseId}`);
      y -= HEADER_FONT_SIZE + 8;
    }

    const tableTop = y;
    let x = MARGIN;
    for (const [columnIndex, label] of columnLabels.entries()) {
      const width = columnWidths[columnIndex] ?? restWidth;
      content.text(
        x + 3,
        y - 12,
        TABLE_HEADER_FONT_SIZE,
        FONT_BOLD,
        truncateToWidth(label, width - 6, TABLE_HEADER_FONT_SIZE),
      );
      x += width;
    }
    y -= TABLE_HEADER_HEIGHT;
    content.line(MARGIN, y + 4, tableRight, y + 4);

    for (const student of pageRows) {
      const values = [student.studentId, ...template.columns.map((column) => cellValue(student, column))];
      x = MARGIN;
      for (const [columnIndex, value] of values.entries()) {
        const width = columnWidths[columnIndex] ?? restWidth;
        content.text(
          x + 3,
          y - 12,
          TABLE_FONT_SIZE,
          FONT_REGULAR,
          truncateToWidth(value, width - 6, TABLE_FONT_SIZE),
        );
        x += width;
      }
      y -= ROW_HEIGHT;
      content.line(MARGIN, y + 4, tableRight, y + 4);
    }

    // Grilla: borde superior y separadores verticales.
    content.line(MARGIN, tableTop, tableRight, tableTop);
    x = MARGIN;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      content.line(x, tableTop, x, y + 4);
      x += columnWidths[columnIndex] ?? restWidth;
    }
    content.line(tableRight, tableTop, tableRight, y + 4);

    return content.toString();
  });
}

/** Ensambla los objetos y la tabla xref de un PDF mínimo determinista. */
function assemblePdf(pageContents: readonly string[], creationDate: string, title: string): Uint8Array {
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
    `<< /Title (${escapePdfText(title)}) /Producer (teacher-service) /CreationDate (${creationDate}) >>`,
  );

  const pageIds: number[] = [];
  for (const content of pageContents) {
    const contentId = push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
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

/** Genera el PDF de la planilla oficial (determinista; ADR 0014). */
export function renderOfficialSheetPdf(input: OfficialSheetRenderInput): Uint8Array {
  const pageContents = buildPageContents(input);
  return assemblePdf(
    pageContents,
    formatCreationDate(input.clock),
    input.template.title,
  );
}
