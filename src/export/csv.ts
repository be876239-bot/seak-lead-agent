const FORMULA_DANGER_RE = /^[=+\-@\t]/;

/** 单元格文本：保留原样但防公式注入——先去掉前置空白再判断，危险前缀加单引号（Excel/WPS 均失效化）。 */
export function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const guarded = FORMULA_DANGER_RE.test(raw.replace(/^[\s\t]+/, '')) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(csvRow).join('\r\n');
}

/** UTF-8 BOM：Excel 打开中文不乱码。 */
export function csvWithBom(text: string): string {
  return '﻿' + text;
}

export function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
