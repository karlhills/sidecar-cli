import { isColorEnabled, c } from './color.js';

export interface TableColumn {
  key: string;
  label: string;
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'right';
  format?: (value: string, row: Record<string, string>) => string;
}

export interface TableOptions {
  indent?: string;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

function ellipsizeMiddle(s: string, maxLen: number): string {
  const stripped = stripAnsi(s);
  if (stripped.length <= maxLen) return s;
  const half = Math.floor((maxLen - 1) / 2);
  return stripped.slice(0, half) + '…' + stripped.slice(stripped.length - half);
}

function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const visLen = visibleLength(s);
  const padding = Math.max(0, width - visLen);
  if (align === 'left') {
    return s + ' '.repeat(padding);
  }
  return ' '.repeat(padding) + s;
}

export function renderTable(columns: TableColumn[], rows: Record<string, string>[], opts: TableOptions = {}): void {
  const indent = opts.indent || '';
  const isTty = isColorEnabled();

  if (rows.length === 0) {
    return;
  }

  // Compute natural widths
  const widths: Record<string, number> = {};
  for (const col of columns) {
    let w = col.label.length;
    for (const row of rows) {
      const val = row[col.key] || '';
      w = Math.max(w, visibleLength(val));
    }
    widths[col.key] = w;
  }

  // Clamp by min/max
  for (const col of columns) {
    if (col.minWidth) widths[col.key] = Math.max(widths[col.key], col.minWidth);
    if (col.maxWidth) widths[col.key] = Math.min(widths[col.key], col.maxWidth);
  }

  // If total > terminal width, reduce widest flexible column via middle-ellipsis
  const terminalWidth = process.stdout.columns || 120;
  const maxContentWidth = Math.max(0, terminalWidth - indent.length - (columns.length - 1) * 2);
  let totalWidth = columns.reduce((sum, col) => sum + widths[col.key], 0) + (columns.length - 1) * 2;

  if (totalWidth > maxContentWidth) {
    // Find widest flexible column
    let widestIdx = -1;
    let widestWidth = -1;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (!col.maxWidth || widths[col.key] < col.maxWidth) {
        if (widths[col.key] > widestWidth) {
          widestWidth = widths[col.key];
          widestIdx = i;
        }
      }
    }

    if (widestIdx >= 0) {
      const col = columns[widestIdx];
      const reductionNeeded = totalWidth - maxContentWidth;
      widths[col.key] = Math.max(col.minWidth || 1, widths[col.key] - reductionNeeded);
    }
  }

  // Render header
  const headerParts = columns.map((col) => pad(col.label, widths[col.key], col.align));
  const headerLine = indent + headerParts.join('  ');

  if (isTty) {
    console.log(c.bold(headerLine));
    const ruleWidth = visibleLength(stripAnsi(headerLine));
    console.log(indent + '─'.repeat(ruleWidth));
  } else {
    console.log(headerLine);
    const ruleWidth = visibleLength(stripAnsi(headerLine));
    console.log(indent + '-'.repeat(ruleWidth));
  }

  // Render rows
  for (const row of rows) {
    const parts = columns.map((col) => {
      let val = row[col.key] || '';
      if (col.format) {
        val = col.format(val, row);
      }
      // Apply ellipsis if needed
      if (visibleLength(val) > widths[col.key]) {
        val = ellipsizeMiddle(val, widths[col.key]);
      }
      return pad(val, widths[col.key], col.align);
    });
    console.log(indent + parts.join('  '));
  }
}
