import type { Clock } from '@kernel/domain';

import type { DailyWorksheetClosing, DailyWorksheetStudentRow, DailyWorksheetView } from '../domain/daily-worksheet.js';
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
import type { WorksheetSectionKind, WorksheetTemplate } from './worksheet-template.js';

/**
 * Render de la planilla de uso diario a **PDF** (ADR 0017).
 *
 * Corre en el **servidor** y es **determinista**: mismo input + mismo reloj ⇒
 * mismos bytes (el `/CreationDate` sale del `Clock` inyectado). Es una **función
 * pura** que reutiliza el escritor PDF mínimo compartido (`pdf-writer.ts`). Dos
 * **disposiciones**:
 * - `full`: **matriz** (filas = alumnos; columnas = fechas de asistencia +
 *   actividades del período + valoración + cierre) con un **anexo** de evolución.
 * - `student`: **bloque** de seguimiento de un alumno (una sección por línea).
 *
 * La plantilla decide **qué secciones** se muestran y con qué etiqueta (T7); las
 * columnas dentro de cada sección se derivan de la vista. Ninguna fecha, ventana
 * ni umbral se hardcodea (§7.8). No hay puerto: un puerto con una sola
 * implementación sería abstracción prematura (ODD #1; ADR 0014).
 */

export type WorksheetLayout = 'full' | 'student';

export interface DailyWorksheetRenderInput {
  readonly view: DailyWorksheetView;
  readonly template: WorksheetTemplate;
  /** Valores de cabecera opacos (`source` = `context.<nombre>`). */
  readonly context: Readonly<Record<string, string>>;
  readonly clock: Clock;
  readonly layout: WorksheetLayout;
}

const TITLE_FONT_SIZE = 14;
const HEADER_FONT_SIZE = 9;
const TABLE_HEADER_FONT_SIZE = 7;
const TABLE_FONT_SIZE = 9;

const ROW_HEIGHT = 18;
const HEADER_ROW_HEIGHT = 12;
const FIRST_COLUMN_WIDTH = 110;

const LEGEND = 'M: nota de cierre manual (override)';

interface RenderColumn {
  readonly group: string;
  readonly label: string;
  readonly value: (student: DailyWorksheetStudentRow) => string;
}

function hasSection(template: WorksheetTemplate, kind: WorksheetSectionKind): boolean {
  return template.sections.some((section) => section.kind === kind);
}

/** Celda de cierre de la matriz: efectiva + marca `M` si es manual (ADR 0016). */
function closingCell(closing: DailyWorksheetClosing): string {
  if (closing.effective === null) {
    return '';
  }
  return closing.state === 'manual' ? `${closing.effective} M` : String(closing.effective);
}

function closingLine(label: string, closing: DailyWorksheetClosing): string {
  if (closing.effective === null) {
    return `${label}: (sin nota)`;
  }
  const state = closing.state === 'manual' ? 'manual' : 'automática';
  const motive = closing.motive === null || closing.motive === '' ? '' : ` - ${closing.motive}`;
  return `${label}: ${closing.effective} (${state})${motive}`;
}

/** Columnas de la matriz, derivadas de la vista según las secciones de la plantilla. */
function buildColumns(view: DailyWorksheetView, template: WorksheetTemplate): RenderColumn[] {
  const columns: RenderColumn[] = [
    { group: '', label: 'Alumno', value: (student) => student.studentId },
  ];
  for (const section of template.sections) {
    switch (section.kind) {
      case 'attendance':
        for (const date of view.dates) {
          columns.push({
            group: section.label,
            label: date,
            value: (student) => student.attendance[date] ?? '',
          });
        }
        break;
      case 'activities':
        for (const activity of view.activities) {
          columns.push({
            group: section.label,
            label: activity.name,
            value: (student) => {
              const grade = student.grades[activity.evaluationId];
              return grade === undefined ? '' : String(grade);
            },
          });
        }
        break;
      case 'trajectory':
        columns.push({
          group: section.label,
          label: '',
          value: (student) => student.trajectory ?? '',
        });
        break;
      case 'closing':
        columns.push({
          group: section.label,
          label: '',
          value: (student) => closingCell(student.closing),
        });
        break;
      case 'evolution':
        break;
    }
  }
  return columns;
}

/** Dibuja la cabecera del documento y devuelve la `y` (línea base) que deja. */
function drawDocumentHeader(
  content: ContentStream,
  input: DailyWorksheetRenderInput,
  withLegend: boolean,
): number {
  const { template, context, view } = input;
  let y = PAGE_HEIGHT - MARGIN;
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
  y -= 8;
  content.text(MARGIN, y - HEADER_FONT_SIZE, HEADER_FONT_SIZE, FONT_REGULAR, `Curso: ${view.courseId}`);
  y -= HEADER_FONT_SIZE + 5;
  content.text(MARGIN, y - HEADER_FONT_SIZE, HEADER_FONT_SIZE, FONT_REGULAR, `Período: ${view.period}`);
  y -= HEADER_FONT_SIZE + 5;
  if (withLegend) {
    content.text(MARGIN, y - HEADER_FONT_SIZE, HEADER_FONT_SIZE, FONT_REGULAR, LEGEND);
    y -= HEADER_FONT_SIZE + 5;
  }
  y -= 3;
  return y;
}

/** Nombre visible de una evaluación por `evaluationId` (o el id si no está). */
function evaluationNames(view: DailyWorksheetView): Map<string, string> {
  return new Map(view.activities.map((activity) => [activity.evaluationId, activity.name]));
}

/** Líneas del anexo de evolución del período (F-05; ADR 0015 §5). */
function evolutionLines(view: DailyWorksheetView): string[] {
  const nameById = evaluationNames(view);
  const lines: string[] = [];
  let any = false;
  for (const student of view.students) {
    if (student.evolution.length === 0) {
      continue;
    }
    any = true;
    lines.push(student.studentId);
    for (const entry of student.evolution) {
      const name = nameById.get(entry.evaluationId) ?? entry.evaluationId;
      const grade = entry.grade === null ? '-' : String(entry.grade);
      const note = entry.note === null || entry.note === '' ? '' : ` - ${entry.note}`;
      lines.push(`  ${entry.occurredOn}  ${name}: ${grade}${note}`);
    }
  }
  if (!any) {
    lines.push('Sin evolución registrada en el período.');
  }
  return lines;
}

/** Página de texto simple, paginada (usada por el anexo y el bloque por alumno). */
function textPages(title: string, lines: readonly string[]): string[] {
  const pages: string[] = [];
  let content = new ContentStream();
  let y = PAGE_HEIGHT - MARGIN;
  let first = true;

  const startPage = (): void => {
    content = new ContentStream();
    y = PAGE_HEIGHT - MARGIN;
    if (first) {
      content.text(MARGIN, y - TITLE_FONT_SIZE, TITLE_FONT_SIZE, FONT_BOLD, title);
      y -= TITLE_FONT_SIZE + 10;
    } else {
      content.text(MARGIN, y - HEADER_FONT_SIZE, HEADER_FONT_SIZE, FONT_REGULAR, title);
      y -= HEADER_FONT_SIZE + 8;
    }
  };

  startPage();
  for (const line of lines) {
    if (y - TABLE_FONT_SIZE < MARGIN) {
      pages.push(content.toString());
      first = false;
      startPage();
    }
    content.text(MARGIN, y - TABLE_FONT_SIZE, TABLE_FONT_SIZE, FONT_REGULAR, line);
    y -= TABLE_FONT_SIZE + 4;
  }
  pages.push(content.toString());
  return pages;
}

function buildFullPages(input: DailyWorksheetRenderInput): string[] {
  const { view, template } = input;
  const columns = buildColumns(view, template);
  const columnCount = columns.length;
  const withLegend = hasSection(template, 'closing');

  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  const firstColumnWidth = Math.min(FIRST_COLUMN_WIDTH, usableWidth);
  const restWidth = (usableWidth - firstColumnWidth) / Math.max(1, columnCount - 1);
  const columnWidths = [
    firstColumnWidth,
    ...Array.from({ length: columnCount - 1 }, () => restWidth),
  ];
  const columnX: number[] = [];
  let acc = MARGIN;
  for (const width of columnWidths) {
    columnX.push(acc);
    acc += width;
  }
  const tableRight = acc;

  const scratch = new ContentStream();
  const firstPageY = drawDocumentHeader(scratch, input, withLegend);
  const headerHeight = HEADER_ROW_HEIGHT * 2;
  const rowsPerPage = Math.max(1, Math.floor((firstPageY - MARGIN - headerHeight) / ROW_HEIGHT));

  const pages: DailyWorksheetStudentRow[][] = [];
  for (let index = 0; index < Math.max(1, view.students.length); index += rowsPerPage) {
    pages.push(view.students.slice(index, index + rowsPerPage));
  }
  if (view.students.length === 0) {
    pages.push([]);
  }

  const groupRuns: { start: number; end: number; label: string }[] = [];
  for (let index = 0; index < columnCount; ) {
    const group = columns[index]?.group ?? '';
    let end = index;
    while (end < columnCount && (columns[end]?.group ?? '') === group) {
      end += 1;
    }
    groupRuns.push({ start: index, end, label: group });
    index = end;
  }

  const tablePages = pages.map((rows, pageIndex) => {
    const content = new ContentStream();
    let y = pageIndex === 0 ? drawDocumentHeader(content, input, withLegend) : PAGE_HEIGHT - MARGIN;
    const tableTop = y;
    const headerBottom = tableTop - HEADER_ROW_HEIGHT;
    const dataTop = tableTop - headerHeight;

    for (const run of groupRuns) {
      const startX = columnX[run.start] ?? MARGIN;
      const endX = columnX[run.end] ?? tableRight;
      if (run.label !== '') {
        content.text(
          startX + 3,
          tableTop - HEADER_ROW_HEIGHT + 4,
          TABLE_HEADER_FONT_SIZE,
          FONT_BOLD,
          truncateToWidth(run.label, endX - startX - 6, TABLE_HEADER_FONT_SIZE),
        );
      }
      content.line(startX, tableTop, startX, headerBottom);
    }
    content.line(tableRight, tableTop, tableRight, headerBottom);

    for (const [index, column] of columns.entries()) {
      const x = columnX[index] ?? MARGIN;
      const width = columnWidths[index] ?? restWidth;
      content.text(
        x + 3,
        dataTop + 4,
        TABLE_HEADER_FONT_SIZE,
        FONT_BOLD,
        truncateToWidth(column.label, width - 6, TABLE_HEADER_FONT_SIZE),
      );
    }
    content.line(MARGIN, tableTop, tableRight, tableTop);
    content.line(MARGIN, headerBottom, tableRight, headerBottom);

    y = dataTop;
    for (const student of rows) {
      for (const [index, column] of columns.entries()) {
        const x = columnX[index] ?? MARGIN;
        const width = columnWidths[index] ?? restWidth;
        content.text(
          x + 3,
          y - 12,
          TABLE_FONT_SIZE,
          FONT_REGULAR,
          truncateToWidth(column.value(student), width - 6, TABLE_FONT_SIZE),
        );
      }
      y -= ROW_HEIGHT;
      content.line(MARGIN, y + 4, tableRight, y + 4);
    }

    for (const x of columnX) {
      content.line(x, headerBottom, x, y + 4);
    }
    content.line(tableRight, headerBottom, tableRight, y + 4);

    return content.toString();
  });

  if (!hasSection(template, 'evolution')) {
    return tablePages;
  }
  const annexTitle = template.sections.find((section) => section.kind === 'evolution')?.label ?? 'Evolución';
  return [...tablePages, ...textPages(annexTitle, evolutionLines(view))];
}

function studentLines(
  view: DailyWorksheetView,
  student: DailyWorksheetStudentRow,
  template: WorksheetTemplate,
): string[] {
  const nameById = evaluationNames(view);
  const lines: string[] = [`Alumno: ${student.studentId}`];
  for (const section of template.sections) {
    switch (section.kind) {
      case 'attendance':
        lines.push(`${section.label}:`);
        if (view.dates.length === 0) {
          lines.push('  (sin clases registradas)');
        }
        for (const date of view.dates) {
          lines.push(`  ${date}  ${student.attendance[date] ?? '-'}`);
        }
        break;
      case 'activities':
        lines.push(`${section.label}:`);
        if (view.activities.length === 0) {
          lines.push('  (sin actividades en el período)');
        }
        for (const activity of view.activities) {
          const grade = student.grades[activity.evaluationId];
          lines.push(`  ${activity.name}: ${grade === undefined ? '-' : grade}`);
        }
        break;
      case 'trajectory':
        lines.push(`${section.label}: ${student.trajectory ?? '-'}`);
        break;
      case 'closing':
        lines.push(closingLine(section.label, student.closing));
        break;
      case 'evolution':
        lines.push(`${section.label}:`);
        if (student.evolution.length === 0) {
          lines.push('  (sin evolución en el período)');
        }
        for (const entry of student.evolution) {
          const name = nameById.get(entry.evaluationId) ?? entry.evaluationId;
          const grade = entry.grade === null ? '-' : String(entry.grade);
          const note = entry.note === null || entry.note === '' ? '' : ` - ${entry.note}`;
          lines.push(`  ${entry.occurredOn}  ${name}: ${grade}${note}`);
        }
        break;
    }
  }
  return lines;
}

function buildStudentPages(input: DailyWorksheetRenderInput): string[] {
  const { view, template } = input;
  const lines: string[] = [];
  for (const student of view.students) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(...studentLines(view, student, template));
  }
  if (view.students.length === 0) {
    lines.push('(curso sin alumnos)');
  }

  const pages: string[] = [];
  let content = new ContentStream();
  let y = drawDocumentHeader(content, input, false);
  for (const line of lines) {
    if (y - TABLE_FONT_SIZE < MARGIN) {
      pages.push(content.toString());
      content = new ContentStream();
      y = PAGE_HEIGHT - MARGIN;
    }
    content.text(MARGIN, y - TABLE_FONT_SIZE, TABLE_FONT_SIZE, FONT_REGULAR, line);
    y -= TABLE_FONT_SIZE + 4;
  }
  pages.push(content.toString());
  return pages;
}

/** Genera el PDF de la planilla de uso diario (determinista; ADR 0017). */
export function renderDailyWorksheetPdf(input: DailyWorksheetRenderInput): Uint8Array {
  const pageContents = input.layout === 'full' ? buildFullPages(input) : buildStudentPages(input);
  return assemblePdf(pageContents, formatCreationDate(input.clock), input.template.title);
}
