import { describe, expect, it } from 'vitest';
import {
  datasetForView,
  defaultChartView,
  importCsvText,
  importXlsxBytes,
  parseCsv,
  transposeDataset,
  type ResultDataset,
} from './results-data';

const encoder = new TextEncoder();

function u16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function concat(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function bytes(values: number[]) {
  return Uint8Array.from(values);
}

function storedZip(entries: Array<{ name: string; content: string }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.content);
    const localHeader = bytes([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(content.length), ...u32(content.length), ...u16(name.length), ...u16(0),
    ]);
    const local = concat([localHeader, name, content]);
    localParts.push(local);

    const centralHeader = bytes([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(content.length), ...u32(content.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0),
      ...u16(0), ...u32(0), ...u32(localOffset),
    ]);
    centralParts.push(concat([centralHeader, name]));
    localOffset += local.length;
  }

  const locals = concat(localParts);
  const central = concat(centralParts);
  const eocd = bytes([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(locals.length), ...u16(0),
  ]);
  return concat([locals, central, eocd]);
}

function workbookFixture() {
  return storedZip([
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="수치" sheetId="1" r:id="rId1"/><sheet name="그래프" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      content: `<?xml version="1.0"?><sst><si><t>매출</t></si><si><t>이익</t></si></sst>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>100</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>20</v></c></row></sheetData></worksheet>`,
    },
    {
      name: 'xl/worksheets/sheet2.xml',
      content: `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>연도</t></is></c><c r="B1" t="inlineStr"><is><t>GDP</t></is></c><c r="C1" t="inlineStr"><is><t>소비</t></is></c></row><row r="2"><c r="A2"><v>2020</v></c><c r="B2"><v>100</v></c><c r="C2"><v>60</v></c></row><row r="3"><c r="A3"><v>2021</v></c><c r="B3"><v>110</v></c><c r="C3"><v>65</v></c></row></sheetData></worksheet>`,
    },
  ]);
}

describe('results editor data import', () => {
  it('parses quoted CSV fields, numbers and embedded newlines', () => {
    expect(parseCsv('이름,값,설명\nA,10,"첫째, 항목"\nB,20,"두 줄\n설명"')).toEqual([
      ['이름', '값', '설명'],
      ['A', 10, '첫째, 항목'],
      ['B', 20, '두 줄\n설명'],
    ]);
  });

  it('treats two-column name/value CSV without a header as metrics', () => {
    const source = importCsvText('metrics.csv', '매출,100\n이익,20\n성장률,12.4');
    const dataset = source.datasets[0];
    expect(dataset.suggestedKind).toBe('metrics');
    expect(dataset.columns.map((column) => column.label)).toEqual(['이름', '값']);
    expect(dataset.rows).toEqual([['매출', 100], ['이익', 20], ['성장률', 12.4]]);
  });

  it('uses the first row as headers for ordinary table/chart source data', () => {
    const source = importCsvText('series.csv', '연도,GDP,소비\n2020,100,60\n2021,110,65');
    const dataset = source.datasets[0];
    expect(dataset.suggestedKind).toBe('table');
    expect(dataset.columns.map((column) => column.label)).toEqual(['연도', 'GDP', '소비']);
    expect(defaultChartView(dataset)).toMatchObject({ xColumn: 0, seriesColumns: [1, 2], transpose: false });
  });

  it('transposes only the display dataset and keeps the original untouched', () => {
    const dataset: ResultDataset = {
      id: 'dataset', sourceId: 'source', name: '시계열', sheetName: '시계열', suggestedKind: 'table',
      columns: [{ id: 'c0', label: '연도' }, { id: 'c1', label: 'GDP' }, { id: 'c2', label: '소비' }],
      rows: [[2020, 100, 60], [2021, 110, 65]],
    };
    const transposed = transposeDataset(dataset);
    expect(transposed.columns.map((column) => column.label)).toEqual(['연도', '2020', '2021']);
    expect(transposed.rows).toEqual([['GDP', 100, 110], ['소비', 60, 65]]);
    expect(dataset.rows).toEqual([[2020, 100, 60], [2021, 110, 65]]);
    expect(datasetForView(dataset, { type: 'table', datasetId: 'dataset', transpose: true })).toEqual(transposed);
  });

  it('imports each Excel worksheet as one independent dataset', async () => {
    const source = await importXlsxBytes('analysis.xlsx', workbookFixture());
    expect(source.format).toBe('xlsx');
    expect(source.datasets.map((dataset) => dataset.sheetName)).toEqual(['수치', '그래프']);
    expect(source.datasets[0].suggestedKind).toBe('metrics');
    expect(source.datasets[0].rows).toEqual([['매출', 100], ['이익', 20]]);
    expect(source.datasets[1].columns.map((column) => column.label)).toEqual(['연도', 'GDP', '소비']);
    expect(source.datasets[1].rows).toEqual([[2020, 100, 60], [2021, 110, 65]]);
  });
});
