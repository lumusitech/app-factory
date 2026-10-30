import type { Clock } from '@kernel/domain';

import type {
  OfficialSheetPeriodValue,
  OfficialSheetStudentRow,
  OfficialSheetView,
} from '../domain/official-sheet.js';
import {
  ContentStream,
  FONT_BOLD,
  FONT_REGULAR,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  assemblePdf,
  formatCreationDate,
  resolveContextValue,
  truncateToWidth,
} from './pdf-writer.js';
import type { OfficialSheetColumn, OfficialSheetTemplate } from './template.js';

/**
 * Render de la planilla oficial a **PDF** (F-04; ADR 0014).
 *
 * Corre en el **servidor** (§10) y es **determinista**: mismo input + mismo reloj
 * ⇒ mismos bytes (el `/CreationDate` sale del `Clock` inyectado; no hay `/ID`
 * aleatorio). Es una **función pura** sin dependencias externas: un escritor PDF
 * mínimo compartido (`pdf-writer.ts`) alcanza para una tabla con bordes. No hay
 * puerto: un puerto con una sola implementación y un solo consumidor sería
 * abstracción prematura (ODD #1); la extracción al kernel (`kernel-documents`,
 * D18) introducirá el puerto *entonces*.
 */

const TITLE_FONT_SIZE = 14;
const HEADER_FONT_SIZE = 9;
const TABLE_HEADER_FONT_SIZE = 7;
const TABLE_FONT_SIZE = 9;

const ROW_HEIGHT = 18;
const TABLE_HEADER_HEIGHT = 20;
const FIRST_COLUMN_WIDTH = 130;

export interface OfficialSheetRenderInput {
  readonly view: OfficialSheetView;
  readonly template: OfficialSheetTemplate;
  /** Valores de cabecera opacos (`source` = `context.<nombre>`). */
  readonly context: Readonly<Record<string, string>>;
  readonly clock: Clock;
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

/** Genera el PDF de la planilla oficial (determinista; ADR 0014). */
export function renderOfficialSheetPdf(input: OfficialSheetRenderInput): Uint8Array {
  const pageContents = buildPageContents(input);
  return assemblePdf(
    pageContents,
    formatCreationDate(input.clock),
    input.template.title,
  );
}
