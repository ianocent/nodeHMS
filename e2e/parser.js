const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

function norm(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.result != null) return String(v.result);
    if (v.text) return String(v.text);
    return '';
  }
  return String(v).trim();
}

function findHeaderRow(ws, label) {
  for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= ws.columnCount; c++) {
      if (norm(row.getCell(c).value).toLowerCase() === label) return r;
    }
  }
  return -1;
}

function headerCols(ws, rowIdx) {
  const cols = {};
  const row = ws.getRow(rowIdx);
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = norm(row.getCell(c).value).toLowerCase();
    if (!h) continue;
    if (h === 'step #' && cols.stepNo == null) cols.stepNo = c;
    else if (h === 'location' && cols.location == null) cols.location = c;
    else if (h === 'step details' && cols.detail == null) cols.detail = c;
    else if ((h === 'expected results') && cols.expected == null) cols.expected = c;
    else if (h.startsWith('pass / fail')) cols.status = c;
    else if (h === 'actual results' && cols.actual == null) cols.actual = c;
  }
  return cols;
}

function parseSheet(ws) {
  const stepHeader = findHeaderRow(ws, 'step #');
  if (stepHeader < 0) return null;
  const cols = headerCols(ws, stepHeader);
  if (!cols.detail || !cols.stepNo) return null;

  const tcIdCell = norm(ws.getRow(1).getCell(4).value) || ws.name;
  const descCandidates = [6, 7, 8].map(c => norm(ws.getRow(1).getCell(c).value)).filter(Boolean);
  const description = descCandidates[descCandidates.length - 1] || '';

  let objective = '';
  let preconditions = [];
  let testData = [];
  for (let r = 2; r < stepHeader; r++) {
    const row = ws.getRow(r);
    const c2 = norm(row.getCell(2).value);
    const c3 = norm(row.getCell(3).value);
    const c10 = norm(row.getCell(10).value);
    if (c2.toLowerCase() === 'objective') objective = norm(row.getCell(3 + 0).value) || norm(row.getCell(4).value);
    if (/^\d+$/.test(c2) && c3 && c3.toLowerCase() !== 'pre-condition') preconditions.push(c3);
    else if (/^\d+$/.test(c2) && c3 && c3.toLowerCase() === 'pre-condition') { /* header */ }
    if (/^\d+$/.test(norm(row.getCell(9).value)) && c10) testData.push(c10);
  }
  preconditions = [...new Set(preconditions)];
  testData = [...new Set(testData)];

  const steps = [];
  for (let r = stepHeader + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const no = norm(row.getCell(cols.stepNo).value);
    if (!/^\d+$/.test(no)) continue;
    const location = norm(cols.location ? row.getCell(cols.location).value : '');
    const detail = norm(row.getCell(cols.detail).value);
    const expected = norm(cols.expected ? row.getCell(cols.expected).value : '');
    if (!detail) continue;
    steps.push({ no: parseInt(no, 10), location, detail, expected });
  }
  if (!steps.length) return null;

  return {
    id: tcIdCell,
    sheet: ws.name,
    description,
    objective,
    preconditions,
    testData,
    steps,
  };
}

async function parseAll(tcDir, fileFilter, tcFilter) {
  const files = fs.readdirSync(tcDir).filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'));
  const cases = [];
  for (const f of files) {
    if (fileFilter && !f.toLowerCase().includes(fileFilter.toLowerCase())) continue;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(tcDir, f));
    wb.eachSheet(ws => {
      const tc = parseSheet(ws);
      if (!tc) return;
      if (tcFilter && !(tc.id.includes(tcFilter) || ws.name.includes(tcFilter))) return;
      tc.file = f;
      cases.push(tc);
    });
  }
  return cases;
}

module.exports = { parseAll, norm };
