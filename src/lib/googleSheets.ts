export interface SheetConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetTitle: string;
  sheetId: number;
  spreadsheetUrl: string;
}

export interface SheetRecord {
  id: string;
  nama: string;
  noKp: string;
  aliran: string;
  kelas: string;
  bahagian: string;
  pertandingan: string;
  statusPertandingan: string;
  peringkat: string;
  pencapaian: string;
  tahunKalendar: string;
  jenisTarikh?: 'satu_hari' | 'tempoh' | string;
  tarikhMula?: string;
  tarikhTamat?: string;
  suratPengiktirafanNama?: string;
  suratPengiktirafanData?: string;
  guruPengiring?: string[];
  updatedAt?: unknown;
  creatorId?: string;
}

export class SheetApiError extends Error {
  status: number;
  isAuthError: boolean;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SheetApiError';
    this.status = status;
    this.isAuthError = status === 401;
  }
}

const SHEET_CONFIG_STORAGE_KEY = 'skauk_google_sheet_config';
const ATTACHMENT_CHUNK_SIZE = 45000;
const MAX_ATTACHMENT_CHUNKS = 11; // Columns P..Z (indices 15..25) -> max ~495k chars within default 26-col sheet

export const SHEET_HEADERS = [
  'ID Rekod',
  'Nama Murid',
  'No. KP / MyKid',
  'Aliran',
  'Kelas',
  'Bahagian',
  'Pertandingan / Aktiviti',
  'Status Pertandingan',
  'Peringkat',
  'Pencapaian',
  'Tahun Kalendar',
  'Dikemas Kini',
  'Creator ID',
  'Tarikh Aktiviti',
  'Surat Pengiktirafan (Nama Fail)',
  'Surat Pengiktirafan (Lampiran)'
];

export function loadSavedSheetConfig(): SheetConfig | null {
  try {
    const raw = localStorage.getItem(SHEET_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SheetConfig;
    if (parsed?.spreadsheetId && parsed?.sheetTitle) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSheetConfig(config: SheetConfig | null): void {
  try {
    if (!config) {
      localStorage.removeItem(SHEET_CONFIG_STORAGE_KEY);
    } else {
      localStorage.setItem(SHEET_CONFIG_STORAGE_KEY, JSON.stringify(config));
    }
  } catch (err) {
    console.warn('Tidak dapat menyimpan konfigurasi Google Sheet:', err);
  }
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

function escapeSheetTitle(title: string): string {
  // Wrap sheet title in single quotes and escape any single quotes inside
  return `'${title.replace(/'/g, "''")}'`;
}

function formatTarikhForSheet(r: SheetRecord): string {
  const mula = (r.tarikhMula || '').trim();
  const tamat = (r.tarikhTamat || '').trim();
  if (!mula) return '-';
  if (r.jenisTarikh === 'tempoh' && tamat && tamat !== mula) {
    return `${mula} hingga ${tamat}`;
  }
  return mula;
}

function parseTarikhFromSheet(raw: string): {
  jenisTarikh: 'satu_hari' | 'tempoh';
  tarikhMula: string;
  tarikhTamat: string;
} {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === '-') {
    return { jenisTarikh: 'satu_hari', tarikhMula: '', tarikhTamat: '' };
  }
  const rangeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(?:hingga|to|-)\s+(\d{4}-\d{2}-\d{2})$/i);
  if (rangeMatch) {
    return {
      jenisTarikh: 'tempoh',
      tarikhMula: rangeMatch[1],
      tarikhTamat: rangeMatch[2]
    };
  }
  return {
    jenisTarikh: 'satu_hari',
    tarikhMula: trimmed,
    tarikhTamat: ''
  };
}

function splitAttachmentChunks(data: string | undefined, padFullRange = false): string[] {
  const clean = (data || '').trim();
  const chunks: string[] = [];
  if (clean) {
    for (let i = 0; i < clean.length && chunks.length < MAX_ATTACHMENT_CHUNKS; i += ATTACHMENT_CHUNK_SIZE) {
      chunks.push(clean.slice(i, i + ATTACHMENT_CHUNK_SIZE));
    }
  }
  if (padFullRange) {
    while (chunks.length < MAX_ATTACHMENT_CHUNKS) {
      chunks.push('');
    }
  } else if (chunks.length === 0) {
    chunks.push('');
  }
  return chunks;
}

export function recordToSheetRow(r: SheetRecord, padAttachmentCols = false): string[] {
  const nowStr = new Date().toLocaleString('ms-MY');
  const suratNama = (r.suratPengiktirafanNama || '').trim();
  const suratData = (r.suratPengiktirafanData || '').trim();
  const guruList = (r.guruPengiring || []).map(g => g.trim().toUpperCase()).filter(Boolean);
  const guruStr = guruList.join(', ');
  const mustPad = padAttachmentCols || guruStr.length > 0;

  const baseCols = [
    r.id,
    (r.nama || '').trim().toUpperCase(),
    (r.noKp || '').trim(),
    r.aliran || 'Tahun 1',
    r.kelas || 'UIAM',
    r.bahagian || 'Unit Beruniform',
    (r.pertandingan || '').trim().toUpperCase(),
    r.statusPertandingan || 'KPM',
    r.peringkat || 'Daerah',
    r.pencapaian || 'Penyertaan',
    r.tahunKalendar || new Date().getFullYear().toString(),
    nowStr,
    r.creatorId || 'guru_skauk',
    formatTarikhForSheet(r),
    suratNama,
    ...splitAttachmentChunks(suratData, mustPad)
  ];

  if (mustPad) {
    baseCols.push(guruStr);
  }
  return baseCols;
}

async function sheetsFetch<T>(url: string, accessToken: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {})
    }
  });

  if (!res.ok) {
    let errorMessage = `Ralat Google Sheets (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) {
        errorMessage = errJson.error.message;
      }
    } catch {
      // Ignore parse error
    }
    throw new SheetApiError(errorMessage, res.status);
  }

  return res.json() as Promise<T>;
}

/**
 * Inspect spreadsheet metadata (never hardcode tab names like "Sheet1")
 */
export async function inspectSpreadsheet(
  spreadsheetIdInput: string,
  accessToken: string
): Promise<{
  config: SheetConfig;
  hasHeaders: boolean;
  firstRowValues: string[];
}> {
  const spreadsheetId = extractSpreadsheetId(spreadsheetIdInput);
  if (!spreadsheetId) {
    throw new SheetApiError('ID atau pautan Google Sheet tidak sah.', 400);
  }

  const meta = await sheetsFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
    accessToken
  );

  const firstSheet = meta.sheets?.[0]?.properties;
  if (!firstSheet) {
    throw new SheetApiError('Tiada tab helaian dijumpai dalam Google Sheet ini.', 400);
  }

  const config: SheetConfig = {
    spreadsheetId: meta.spreadsheetId,
    spreadsheetTitle: meta.properties?.title || 'Rekod Pencapaian SKAUK',
    sheetTitle: firstSheet.title,
    sheetId: firstSheet.sheetId,
    spreadsheetUrl: meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${meta.spreadsheetId}/edit`
  };

  // Read row 1 to check if all 16 headers are already configured
  const headerRange = `${escapeSheetTitle(config.sheetTitle)}!A1:P1`;
  const headerRes = await sheetsFetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(headerRange)}`,
    accessToken
  );

  const firstRowValues = headerRes.values?.[0] || [];
  const hasHeaders =
    firstRowValues.length >= SHEET_HEADERS.length &&
    firstRowValues[0]?.trim().toLowerCase() === 'id rekod' &&
    firstRowValues[1]?.trim().toLowerCase() === 'nama murid' &&
    firstRowValues[13]?.trim().toLowerCase() === 'tarikh aktiviti';

  return { config, hasHeaders, firstRowValues };
}

async function ensureMinSheetColumns(config: SheetConfig, minColumns: number, accessToken: string): Promise<void> {
  try {
    const meta = await sheetsFetch<{
      sheets: Array<{ properties: { sheetId: number; gridProperties?: { columnCount?: number } } }>;
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}?fields=sheets.properties(sheetId,gridProperties.columnCount)`,
      accessToken
    );
    const targetSheet = meta.sheets?.find(s => s.properties.sheetId === config.sheetId);
    const currentCols = targetSheet?.properties?.gridProperties?.columnCount ?? 26;
    if (currentCols < minColumns) {
      await sheetsFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            requests: [
              {
                appendDimension: {
                  sheetId: config.sheetId,
                  dimension: 'COLUMNS',
                  length: minColumns - currentCols
                }
              }
            ]
          })
        }
      );
    }
  } catch (err) {
    console.warn('Amaran peluasan kolum Google Sheet:', err);
  }
}

/**
 * Write standard header row to A1:P1 + AA1 (Guru Pengiring) and freeze row 1
 */
export async function ensureSheetHeaders(config: SheetConfig, accessToken: string): Promise<void> {
  await ensureMinSheetColumns(config, 28, accessToken);

  const range = `${escapeSheetTitle(config.sheetTitle)}!A1:P1`;
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values: [SHEET_HEADERS]
      })
    }
  );

  // Tulis header kolum AA1 untuk Guru Pengiring / Pembimbing / Jurulatih
  const guruHeaderRange = `${escapeSheetTitle(config.sheetTitle)}!AA1`;
  try {
    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(guruHeaderRange)}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          range: guruHeaderRange,
          majorDimension: 'ROWS',
          values: [['Guru Pengiring / Pembimbing / Jurulatih']]
        })
      }
    );
  } catch (err) {
    console.warn('Amaran menulis header AA1 Guru Pengiring:', err);
  }

  // Format header row cleanly
  try {
    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: config.sheetId,
                  gridProperties: { frozenRowCount: 1 }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId: config.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 27
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.06, green: 0.09, blue: 0.16 },
                    textFormat: {
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                      bold: true
                    }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }
          ]
        })
      }
    );
  } catch (err) {
    console.warn('Amaran pemformatan header Google Sheet:', err);
  }
}

/**
 * Create a brand-new Google Spreadsheet pre-configured for SKAUK student records
 */
export async function createStudentSpreadsheet(accessToken: string, schoolTitle = 'REKOD PENCAPAIAN PAJSK SKAUK'): Promise<SheetConfig> {
  const created = await sheetsFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  }>(
    'https://sheets.googleapis.com/v4/spreadsheets',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          title: schoolTitle,
          timeZone: 'Asia/Kuala_Lumpur'
        },
        sheets: [
          {
            properties: {
              title: 'Rekod Murid',
              gridProperties: {
                frozenRowCount: 1,
                columnCount: 28
              }
            }
          }
        ]
      })
    }
  );

  const firstSheet = created.sheets[0].properties;
  const config: SheetConfig = {
    spreadsheetId: created.spreadsheetId,
    spreadsheetTitle: created.properties.title,
    sheetTitle: firstSheet.title,
    sheetId: firstSheet.sheetId,
    spreadsheetUrl: created.spreadsheetUrl
  };

  await ensureSheetHeaders(config, accessToken);
  saveSheetConfig(config);
  return config;
}

/**
 * Read all student records from Google Sheets (used for backup view & Firebase quota fallback)
 */
export async function fetchRecordsFromSheet(config: SheetConfig, accessToken: string): Promise<SheetRecord[]> {
  // Always inspect metadata to verify current sheet tab name
  const { config: verifiedConfig } = await inspectSpreadsheet(config.spreadsheetId, accessToken);
  if (verifiedConfig.sheetTitle !== config.sheetTitle || verifiedConfig.spreadsheetTitle !== config.spreadsheetTitle) {
    saveSheetConfig(verifiedConfig);
  }

  const range = `${escapeSheetTitle(verifiedConfig.sheetTitle)}!A2:AA`;
  const data = await sheetsFetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(verifiedConfig.spreadsheetId)}/values/${encodeURIComponent(range)}`,
    accessToken
  );

  const rows = data.values || [];
  const records: SheetRecord[] = [];

  rows.forEach((row, idx) => {
    const nama = (row[1] || '').trim();
    const pertandingan = (row[6] || '').trim();
    if (!nama && !pertandingan) return;

    const id = (row[0] || '').trim() || `sheet_row_${idx + 2}`;
    const parsedDate = parseTarikhFromSheet(row[13] || '');
    const suratNama = (row[14] || '').trim();
    const suratData = row.slice(15, 26).join('').trim();
    const guruRaw = (row[26] || '').trim();
    const guruPengiring = guruRaw
      ? guruRaw.split(/[,;\n|]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];

    records.push({
      id,
      nama: nama.toUpperCase(),
      noKp: (row[2] || '').trim(),
      aliran: (row[3] || '').trim() || 'Tahun 1',
      kelas: (row[4] || '').trim() || 'UIAM',
      bahagian: (row[5] || '').trim() || 'Unit Beruniform',
      pertandingan: pertandingan.toUpperCase(),
      statusPertandingan: (row[7] || '').trim() || 'KPM',
      peringkat: (row[8] || '').trim() || 'Daerah',
      pencapaian: (row[9] || '').trim() || 'Penyertaan',
      tahunKalendar: (row[10] || '').trim() || new Date().getFullYear().toString(),
      creatorId: (row[12] || '').trim() || 'guru_skauk',
      jenisTarikh: parsedDate.jenisTarikh,
      tarikhMula: parsedDate.tarikhMula,
      tarikhTamat: parsedDate.tarikhTamat,
      suratPengiktirafanNama: suratNama,
      suratPengiktirafanData: suratData,
      guruPengiring,
      updatedAt: row[11] || ''
    });
  });

  // Reverse so newest entries appear near top, matching usual order
  return records.reverse();
}

/**
 * Append one or multiple new records to Google Sheets
 */
export async function appendRecordsToSheet(
  config: SheetConfig,
  records: SheetRecord[],
  accessToken: string
): Promise<void> {
  if (records.length === 0) return;
  const range = `${escapeSheetTitle(config.sheetTitle)}!A:AA`;
  const values = records.map(r => recordToSheetRow(r, true));

  try {
    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          majorDimension: 'ROWS',
          values
        })
      }
    );
  } catch (err) {
    if (err instanceof SheetApiError && err.status === 400) {
      await ensureMinSheetColumns(config, 28, accessToken);
      await sheetsFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            majorDimension: 'ROWS',
            values
          })
        }
      );
    } else {
      throw err;
    }
  }
}

/**
 * Find row index (1-based) by record ID in Column A
 */
async function findRowIndexById(config: SheetConfig, recordId: string, accessToken: string): Promise<number | null> {
  const range = `${escapeSheetTitle(config.sheetTitle)}!A:A`;
  const res = await sheetsFetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}`,
    accessToken
  );

  const values = res.values || [];
  for (let i = 1; i < values.length; i++) {
    if ((values[i]?.[0] || '').trim() === recordId) {
      return i + 1; // 1-based row number
    }
  }
  return null;
}

/**
 * Update an existing record row in Google Sheets (or append if not present yet)
 */
export async function updateRecordInSheet(
  config: SheetConfig,
  record: SheetRecord,
  accessToken: string
): Promise<'updated' | 'appended'> {
  const rowIndex = await findRowIndexById(config, record.id, accessToken);
  if (rowIndex === null) {
    await appendRecordsToSheet(config, [record], accessToken);
    return 'appended';
  }

  const range = `${escapeSheetTitle(config.sheetTitle)}!A${rowIndex}:AA${rowIndex}`;
  const body = JSON.stringify({
    range,
    majorDimension: 'ROWS',
    values: [recordToSheetRow(record, true)]
  });

  try {
    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body
      }
    );
  } catch (err) {
    if (err instanceof SheetApiError && err.status === 400) {
      await ensureMinSheetColumns(config, 28, accessToken);
      await sheetsFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
        accessToken,
        {
          method: 'PUT',
          body
        }
      );
    } else {
      throw err;
    }
  }
  return 'updated';
}

/**
 * Delete a specific record row from Google Sheets by ID
 */
export async function deleteRecordFromSheet(
  config: SheetConfig,
  recordId: string,
  accessToken: string
): Promise<boolean> {
  const { config: verifiedConfig } = await inspectSpreadsheet(config.spreadsheetId, accessToken);
  const rowIndex = await findRowIndexById(verifiedConfig, recordId, accessToken);
  if (rowIndex === null) {
    return false;
  }

  // deleteDimension uses 0-based inclusive startIndex, exclusive endIndex
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(verifiedConfig.spreadsheetId)}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: verifiedConfig.sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1,
                endIndex: rowIndex
              }
            }
          }
        ]
      })
    }
  );
  return true;
}

/**
 * Sync any records that are not yet in Google Sheets (preserving existing rows)
 */
export async function syncMissingRecordsToSheet(
  config: SheetConfig,
  records: SheetRecord[],
  accessToken: string
): Promise<{ addedCount: number; alreadySyncedCount: number }> {
  const { config: verifiedConfig, hasHeaders } = await inspectSpreadsheet(config.spreadsheetId, accessToken);
  if (!hasHeaders) {
    await ensureSheetHeaders(verifiedConfig, accessToken);
  }

  const range = `${escapeSheetTitle(verifiedConfig.sheetTitle)}!A2:A`;
  const existingRes = await sheetsFetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(verifiedConfig.spreadsheetId)}/values/${encodeURIComponent(range)}`,
    accessToken
  );

  const existingIds = new Set(
    (existingRes.values || []).map(row => (row[0] || '').trim()).filter(Boolean)
  );

  const missingRecords = records.filter(r => !existingIds.has(r.id));
  if (missingRecords.length > 0) {
    // Append oldest first so chronological order is clean in Sheet
    await appendRecordsToSheet(verifiedConfig, [...missingRecords].reverse(), accessToken);
  }

  return {
    addedCount: missingRecords.length,
    alreadySyncedCount: records.length - missingRecords.length
  };
}

// =========================================================================
// PORTAL IBU BAPA (APPS SCRIPT -> TAB "Semakan Ibu Bapa" + GOOGLE DRIVE)
// =========================================================================

export const PARENT_REVIEW_TAB_NAME = 'Semakan Ibu Bapa';
const PARENT_SCRIPT_STORAGE_KEY = 'skauk_parent_apps_script_url';

export const PARENT_REVIEW_HEADERS = [
  'ID Kiriman',
  'Tarikh Hantar',
  'Status Semakan',
  'Nama Murid',
  'No. KP / MyKid',
  'Aliran',
  'Kelas',
  'Bahagian',
  'Pertandingan / Aktiviti',
  'Tarikh Aktiviti',
  'Status Pertandingan',
  'Peringkat',
  'Pencapaian',
  'Tahun Kalendar',
  'Nama Penjaga & Tel',
  'Surat Pengiktirafan (Nama Fail)',
  'Surat Pengiktirafan (Pautan / Data)'
];

export interface ParentSubmission {
  id: string;
  rowIndex: number;
  tarikhHantar: string;
  statusSemakan: 'MENUNGGU SEMAKAN' | 'DISAHKAN' | 'DITOLAK' | string;
  nama: string;
  noKp: string;
  aliran: string;
  kelas: string;
  bahagian: string;
  pertandingan: string;
  jenisTarikh: 'satu_hari' | 'tempoh';
  tarikhMula: string;
  tarikhTamat: string;
  statusPertandingan: string;
  peringkat: string;
  pencapaian: string;
  tahunKalendar: string;
  penjagaInfo: string;
  suratPengiktirafanNama: string;
  suratPengiktirafanData: string;
}

export function loadSavedParentScriptUrl(): string {
  try {
    return localStorage.getItem(PARENT_SCRIPT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveParentScriptUrl(url: string): void {
  try {
    const clean = url.trim();
    if (!clean) {
      localStorage.removeItem(PARENT_SCRIPT_STORAGE_KEY);
    } else {
      localStorage.setItem(PARENT_SCRIPT_STORAGE_KEY, clean);
    }
  } catch {
    // ignore storage errors
  }
}

async function getParentReviewSheetId(spreadsheetId: string, accessToken: string): Promise<number | null> {
  const meta = await sheetsFetch<{
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`,
    accessToken
  );
  const found = meta.sheets?.find(s => s.properties.title === PARENT_REVIEW_TAB_NAME);
  return found ? found.properties.sheetId : null;
}

export async function ensureParentReviewTab(config: SheetConfig, accessToken: string): Promise<number> {
  let reviewSheetId = await getParentReviewSheetId(config.spreadsheetId, accessToken);

  if (reviewSheetId === null) {
    const addRes = await sheetsFetch<{
      replies: Array<{ addSheet?: { properties: { sheetId: number } } }>;
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: PARENT_REVIEW_TAB_NAME,
                  gridProperties: { frozenRowCount: 1, columnCount: 20 }
                }
              }
            }
          ]
        })
      }
    );
    reviewSheetId = addRes.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
  }

  const range = `${escapeSheetTitle(PARENT_REVIEW_TAB_NAME)}!A1:Q1`;
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values: [PARENT_REVIEW_HEADERS]
      })
    }
  );

  try {
    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: reviewSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: PARENT_REVIEW_HEADERS.length
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.19, green: 0.18, blue: 0.51 },
                    textFormat: {
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                      bold: true
                    }
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
              }
            }
          ]
        })
      }
    );
  } catch (err) {
    console.warn('Amaran pemformatan tab Semakan Ibu Bapa:', err);
  }

  return reviewSheetId;
}

export async function fetchParentSubmissionsFromSheet(
  config: SheetConfig,
  accessToken: string
): Promise<{ exists: boolean; submissions: ParentSubmission[] }> {
  const reviewSheetId = await getParentReviewSheetId(config.spreadsheetId, accessToken);
  if (reviewSheetId === null) {
    return { exists: false, submissions: [] };
  }

  const range = `${escapeSheetTitle(PARENT_REVIEW_TAB_NAME)}!A2:Q`;
  const data = await sheetsFetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}`,
    accessToken
  );

  const rows = data.values || [];
  const submissions: ParentSubmission[] = [];

  rows.forEach((row, idx) => {
    const nama = (row[3] || '').trim();
    const pertandingan = (row[8] || '').trim();
    if (!nama && !pertandingan) return;

    const parsedDate = parseTarikhFromSheet(row[9] || '');
    submissions.push({
      id: (row[0] || '').trim() || `parent_row_${idx + 2}`,
      rowIndex: idx + 2,
      tarikhHantar: (row[1] || '').trim(),
      statusSemakan: ((row[2] || '').trim().toUpperCase() || 'MENUNGGU SEMAKAN'),
      nama: nama.toUpperCase(),
      noKp: (row[4] || '').trim(),
      aliran: (row[5] || '').trim() || 'Tahun 1',
      kelas: (row[6] || '').trim() || 'UIAM',
      bahagian: (row[7] || '').trim() || 'Unit Beruniform',
      pertandingan: pertandingan.toUpperCase(),
      jenisTarikh: parsedDate.jenisTarikh,
      tarikhMula: parsedDate.tarikhMula,
      tarikhTamat: parsedDate.tarikhTamat,
      statusPertandingan: (row[10] || '').trim() || 'KPM',
      peringkat: (row[11] || '').trim() || 'Daerah',
      pencapaian: (row[12] || '').trim() || 'Penyertaan',
      tahunKalendar: (row[13] || '').trim() || new Date().getFullYear().toString(),
      penjagaInfo: (row[14] || '').trim(),
      suratPengiktirafanNama: (row[15] || '').trim(),
      suratPengiktirafanData: (row[16] || '').trim()
    });
  });

  // Newest submissions first
  return { exists: true, submissions: submissions.reverse() };
}

export async function updateParentSubmissionStatusInSheet(
  config: SheetConfig,
  rowIndex: number,
  statusSemakan: 'DISAHKAN' | 'DITOLAK' | 'MENUNGGU SEMAKAN',
  accessToken: string
): Promise<void> {
  const range = `${escapeSheetTitle(PARENT_REVIEW_TAB_NAME)}!C${rowIndex}`;
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values: [[statusSemakan]]
      })
    }
  );
}

export async function deleteParentSubmissionFromSheet(
  config: SheetConfig,
  rowIndex: number,
  accessToken: string
): Promise<boolean> {
  const reviewSheetId = await getParentReviewSheetId(config.spreadsheetId, accessToken);
  if (reviewSheetId === null) return false;

  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: reviewSheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1,
                endIndex: rowIndex
              }
            }
          }
        ]
      })
    }
  );
  return true;
}

export async function submitParentEntryToAppsScript(
  appsScriptUrl: string,
  payload: {
    nama: string;
    noKp: string;
    aliran: string;
    kelas: string;
    bahagian: string;
    pertandingan: string;
    jenisTarikh: 'satu_hari' | 'tempoh';
    tarikhMula: string;
    tarikhTamat: string;
    statusPertandingan: string;
    peringkat: string;
    pencapaian: string;
    tahunKalendar: string;
    penjagaInfo: string;
    fileName?: string;
    fileMimeType?: string;
    fileBase64?: string;
  }
): Promise<{ id: string; fileUrl?: string }> {
  const res = await fetch(appsScriptUrl.trim(), {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`Pelayan Google Apps Script memulangkan ralat (${res.status}).`);
  }

  const json = await res.json() as { ok?: boolean; error?: string; id?: string; fileUrl?: string };
  if (!json.ok) {
    throw new Error(json.error || 'Gagal menyimpan kiriman ibu bapa ke Google Sheets.');
  }

  return {
    id: json.id || `sub_${Date.now()}`,
    fileUrl: json.fileUrl
  };
}

export function generateParentAppsScriptCode(spreadsheetId?: string): string {
  const targetIdLine = spreadsheetId
    ? `var SPREADSHEET_ID = '${spreadsheetId}';`
    : `var SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();`;

  return `// =========================================================================
// SKRIP PORTAL IBU BAPA - REKOD PENCAPAIAN PAJSK SKAUK
// Simpan kiriman ibu bapa ke Tab "Semakan Ibu Bapa" & fail surat ke Google Drive
// =========================================================================
${targetIdLine}
var TAB_SEMAKAN = 'Semakan Ibu Bapa';
var NAMA_FOLDER_DRIVE = 'SURAT PENGIKTIRAFAN KPM - PAJSK SKAUK';

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var data = JSON.parse(raw);

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(TAB_SEMAKAN);
    if (!sheet) {
      sheet = ss.insertSheet(TAB_SEMAKAN);
      sheet.appendRow([
        'ID Kiriman', 'Tarikh Hantar', 'Status Semakan', 'Nama Murid',
        'No. KP / MyKid', 'Aliran', 'Kelas', 'Bahagian',
        'Pertandingan / Aktiviti', 'Tarikh Aktiviti', 'Status Pertandingan',
        'Peringkat', 'Pencapaian', 'Tahun Kalendar', 'Nama Penjaga & Tel',
        'Surat Pengiktirafan (Nama Fail)', 'Surat Pengiktirafan (Pautan / Data)'
      ]);
      sheet.setFrozenRows(1);
    }

    var fileUrl = '';
    var fileName = (data.fileName || '').toString().trim();

    // Simpan lampiran surat pengiktirafan terus ke Google Drive jika ada
    if (data.fileBase64 && data.fileMimeType) {
      var folders = DriveApp.getFoldersByName(NAMA_FOLDER_DRIVE);
      var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(NAMA_FOLDER_DRIVE);
      var bytes = Utilities.base64Decode(data.fileBase64);
      var safeName = (data.nama || 'MURID') + '_' + (fileName || 'surat_kpm');
      var blob = Utilities.newBlob(bytes, data.fileMimeType, safeName);
      var file = folder.createFile(blob);
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {
        // Abaikan jika dasar domain mengehadkan perkongsian umum
      }
      fileUrl = file.getUrl();
    }

    var idKiriman = 'sub_' + Utilities.getUuid().slice(0, 8);
    var tarikhHantar = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'dd/MM/yyyy HH:mm');
    var tarikhAktiviti = '-';
    if (data.tarikhMula) {
      tarikhAktiviti = (data.jenisTarikh === 'tempoh' && data.tarikhTamat && data.tarikhTamat !== data.tarikhMula)
        ? data.tarikhMula + ' hingga ' + data.tarikhTamat
        : data.tarikhMula;
    }

    sheet.appendRow([
      idKiriman,
      tarikhHantar,
      'MENUNGGU SEMAKAN',
      (data.nama || '').toString().toUpperCase(),
      (data.noKp || '').toString(),
      data.aliran || 'Tahun 1',
      data.kelas || 'UIAM',
      data.bahagian || 'Unit Beruniform',
      (data.pertandingan || '').toString().toUpperCase(),
      tarikhAktiviti,
      data.statusPertandingan || 'KPM',
      data.peringkat || 'Daerah',
      data.pencapaian || 'Penyertaan',
      data.tahunKalendar || new Date().getFullYear().toString(),
      data.penjagaInfo || '',
      fileName,
      fileUrl
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, id: idKiriman, fileUrl: fileUrl }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'Portal Ibu Bapa PAJSK SKAUK Aktif' }))
    .setMimeType(ContentService.MimeType.JSON);
}`;
}

