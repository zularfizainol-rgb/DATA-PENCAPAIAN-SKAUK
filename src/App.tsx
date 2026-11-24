import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Loader2, LayoutDashboard, PlusCircle, Users, Trophy, GraduationCap,
  PieChart, X, Save, Search, FileSpreadsheet, FileText, Award, Edit3, Trash2,
  Plus, ClipboardList, CheckCircle2, ArrowLeft, Copy, Check, ChevronRight, UserPlus, Filter,
  RefreshCw, ExternalLink, AlertTriangle, Database, Link2, LogOut, Sheet, ShieldCheck, CloudOff,
  Calendar, Upload, Eye, Download, Paperclip, FileCheck2, Inbox, UserCheck, ArrowUpDown
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  db, 
  collection, doc, setDoc, onSnapshot, query, 
  serverTimestamp, deleteDoc,
  initAuth, googleSignIn, getAccessToken, clearAccessToken, logout,
  testConnection, isQuotaError, handleFirestoreError, OperationType, User
} from './lib/firebase';
import {
  SheetConfig,
  SheetApiError,
  ParentSubmission,
  loadSavedSheetConfig,
  saveSheetConfig,
  loadSavedParentScriptUrl,
  saveParentScriptUrl,
  createStudentSpreadsheet,
  inspectSpreadsheet,
  ensureSheetHeaders,
  fetchRecordsFromSheet,
  appendRecordsToSheet,
  updateRecordInSheet,
  deleteRecordFromSheet,
  syncMissingRecordsToSheet,
  ensureParentReviewTab,
  fetchParentSubmissionsFromSheet,
  updateParentSubmissionStatusInSheet,
  deleteParentSubmissionFromSheet
} from './lib/googleSheets';
import ParentPortalView from './components/ParentPortalView';
import ParentReviewView from './components/ParentReviewView';

const senaraiBahagian = [
  "Unit Beruniform", 
  "Kelab & Persatuan", 
  "Sukan & Permainan", 
  "Ko-akademik BM", 
  "Ko-akademik BI", 
  "STEM", 
  "Kesenian / Kebudayaan"
];

const CONTOH_SURAT_KPM_URL = '/assets/aistudio/pengiktirafan_KPM_d2725b00.jpg';

const senaraiPencapaian = [
  "Penyertaan", 
  "Kelima", 
  "Keempat", 
  "Ketiga", 
  "Naib Johan", 
  "Johan",
  "Gangsa",
  "Perak",
  "Emas"
];

const senaraiKelas = [
  "UIAM", "UM", "USM", "UPM", "UKM", "UTM", "UUM", "UITM", "USIM", "UPSI", "UNISZA"
];

const senaraiPeringkat = [
  "Antarabangsa", "Kebangsaan", "Negeri", "Daerah"
];

const senaraiAliran = [
  "Tahun 1", "Tahun 2", "Tahun 3", "Tahun 4", "Tahun 5", "Tahun 6"
];

const senaraiStatusPertandingan = [
  "KPM", 
  "LUAR KPM (PENGIKTIRAFAN)",
  "LUAR KPM"
];

// Helper to normalize and identify status cleanly
const normalizeStatus = (status?: string): 'KPM' | 'LUAR KPM (PENGIKTIRAFAN)' | 'LUAR KPM' => {
  if (!status) return 'KPM';
  const s = status.trim().toUpperCase();
  if (s.includes('PENGIKTIRAFAN')) return 'LUAR KPM (PENGIKTIRAFAN)';
  if (s === 'LUAR KPM' || s.includes('AGENSI') || s.includes('BUKAN KPM') || s === 'LUAR') return 'LUAR KPM';
  return 'KPM';
};

const getStatusBadgeClass = (status?: string) => {
  const norm = normalizeStatus(status);
  if (norm === 'KPM') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (norm === 'LUAR KPM (PENGIKTIRAFAN)') return 'bg-indigo-50 text-indigo-800 border-indigo-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
};

const getStatusBadgeDark = (status?: string) => {
  const norm = normalizeStatus(status);
  if (norm === 'KPM') return 'bg-emerald-700 text-white';
  if (norm === 'LUAR KPM (PENGIKTIRAFAN)') return 'bg-indigo-700 text-white';
  return 'bg-amber-600 text-white';
};

const formatTarikhSegmen = (iso?: string) => {
  if (!iso) return '';
  const parts = iso.trim().split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return iso;
};

const formatTarikhPaparan = (jenisTarikh?: string, tarikhMula?: string, tarikhTamat?: string) => {
  const mula = (tarikhMula || '').trim();
  const tamat = (tarikhTamat || '').trim();
  if (!mula) return '';
  if (jenisTarikh === 'tempoh' && tamat && tamat !== mula) {
    return `${formatTarikhSegmen(mula)} - ${formatTarikhSegmen(tamat)}`;
  }
  return formatTarikhSegmen(mula);
};

const extractDriveFileId = (url?: string): string | null => {
  if (!url || !url.includes('drive.google.com')) return null;
  const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch?.[1]) return dMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return idMatch?.[1] || null;
};

const MAX_SHEET_IMAGE_CHARS = 42000;
const MAX_PDF_BYTES = 350 * 1024; // ~350KB raw PDF (~475k base64 chars -> fits Firestore 1MB & Sheet A:Z)

async function processRecognitionAttachment(file: File): Promise<{ nama: string; data: string }> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');

  if (!isPdf && !isImage) {
    throw new Error('Format fail tidak disokong. Sila muat naik gambar (JPG/PNG) atau dokumen PDF sahaja.');
  }

  if (isPdf) {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error('Saiz fail PDF melebihi had 350KB. Sila mampatkan fail PDF atau muat naik gambar surat pengiktirafan.');
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Gagal membaca fail PDF.'));
      reader.readAsDataURL(file);
    });
    return { nama: file.name, data: dataUrl };
  }

  // Image: compress iteratively on canvas so it fits comfortably in 1 Google Sheet cell + Firestore
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca fail gambar.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const imageEl = new Image();
    imageEl.onload = () => resolve(imageEl);
    imageEl.onerror = () => reject(new Error('Fail gambar tidak sah atau rosak.'));
    imageEl.src = rawUrl;
  });

  const maxDims = [1000, 800, 640];
  const qualities = [0.8, 0.65, 0.5, 0.35];

  for (const maxDim of maxDims) {
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round((img.width || 1) * scale));
    const height = Math.max(1, Math.round((img.height || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    for (const q of qualities) {
      const compressed = canvas.toDataURL('image/jpeg', q);
      if (compressed.length <= MAX_SHEET_IMAGE_CHARS) {
        return { nama: file.name, data: compressed };
      }
    }
  }

  throw new Error('Saiz gambar terlalu besar walaupun selepas dimampatkan. Sila pilih gambar yang lebih kecil.');
}

type RecordData = {
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
  sijilMuridNama?: string;
  sijilMuridData?: string;
  guruPengiring?: string[];
  creatorId: string;
  updatedAt?: any;
};

type BulkStudentRow = {
  id: string;
  nama: string;
  noKp: string;
  aliran: string;
  kelas: string;
  pencapaian: string;
};

export default function App() {
  const urlSearchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isParentMode = urlSearchParams?.get('mod') === 'ibubapa';
  const parentEndpointParam = (urlSearchParams?.get('ep') || '').trim();

  const [activeView, setActiveView] = useState<'dashboard' | 'kemasukan' | 'senarai' | 'semakan'>('dashboard');
  const [previewParentPortal, setPreviewParentPortal] = useState(false);
  const [rekodPajsk, setRekodPajsk] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(!isParentMode);
  const [saving, setSaving] = useState(false);
  const [savingProgress, setSavingProgress] = useState<{ current: number; total: number } | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAliran, setFilterAliran] = useState('SEMUA');
  const [filterKelas, setFilterKelas] = useState('SEMUA');
  const [filterStatus, setFilterStatus] = useState('SEMUA');
  const [filterBahagian, setFilterBahagian] = useState('SEMUA');
  const [filterPeringkat, setFilterPeringkat] = useState('SEMUA');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [quotaWarning, setQuotaWarning] = useState(false);

  // Dashboard Modal States
  const [selectedDashboardPeringkat, setSelectedDashboardPeringkat] = useState<string | null>(null);
  const [selectedDashboardBahagian, setSelectedDashboardBahagian] = useState<string | null>(null);
  const [selectedPertandinganInModal, setSelectedPertandinganInModal] = useState<string | null>(null);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [modalStatusFilter, setModalStatusFilter] = useState<string>('SEMUA');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [previewSuratModal, setPreviewSuratModal] = useState<{
    nama: string;
    data: string;
    pertandingan?: string;
    murid?: string;
  } | null>(null);
  const [showGuruReportModal, setShowGuruReportModal] = useState(false);
  const [guruReportSearch, setGuruReportSearch] = useState('');
  const [guruReportSort, setGuruReportSort] = useState<'az' | 'za' | 'aktif'>('az');

  // Kemasukan Mode: 'individu' | 'pukal'
  const [kemasukanMode, setKemasukanMode] = useState<'individu' | 'pukal'>('individu');

  // Single Entry Form
  const [formData, setFormData] = useState({
    nama: '',
    noKp: '',
    aliran: 'Tahun 1',
    kelas: 'UIAM',
    bahagian: 'Unit Beruniform',
    pertandingan: '',
    jenisTarikh: 'satu_hari' as 'satu_hari' | 'tempoh',
    tarikhMula: '',
    tarikhTamat: '',
    statusPertandingan: 'KPM',
    suratPengiktirafanNama: '',
    suratPengiktirafanData: '',
    sijilMuridNama: '',
    sijilMuridData: '',
    peringkat: 'Daerah',
    pencapaian: 'Penyertaan',
    guruPengiring: [''],
    creatorId: ''
  });

  // Bulk Entry Form Header
  const [bulkHeader, setBulkHeader] = useState({
    pertandingan: '',
    jenisTarikh: 'satu_hari' as 'satu_hari' | 'tempoh',
    tarikhMula: '',
    tarikhTamat: '',
    bahagian: 'Unit Beruniform',
    statusPertandingan: 'KPM',
    suratPengiktirafanNama: '',
    suratPengiktirafanData: '',
    sijilMuridNama: '',
    sijilMuridData: '',
    peringkat: 'Daerah',
    defaultPencapaian: 'Penyertaan',
    defaultAliran: 'Tahun 1',
    defaultKelas: 'UIAM',
    guruPengiring: ['']
  });

  // Bulk Entry Rows
  const [bulkRows, setBulkRows] = useState<BulkStudentRow[]>([
    { id: '1', nama: '', noKp: '', aliran: 'Tahun 1', kelas: 'UIAM', pencapaian: 'Penyertaan' },
    { id: '2', nama: '', noKp: '', aliran: 'Tahun 1', kelas: 'UIAM', pencapaian: 'Penyertaan' },
    { id: '3', nama: '', noKp: '', aliran: 'Tahun 1', kelas: 'UIAM', pencapaian: 'Penyertaan' }
  ]);

  // Quick Paste Modal State
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Google Auth & Google Sheets Integration States
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [hasSheetToken, setHasSheetToken] = useState(false);
  const [isLoggingInGoogle, setIsLoggingInGoogle] = useState(false);
  const [sheetConfig, setSheetConfig] = useState<SheetConfig | null>(() => loadSavedSheetConfig());
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [sheetUrlInput, setSheetUrlInput] = useState('');
  const [sheetBusy, setSheetBusy] = useState(false);
  const [dataSource, setDataSource] = useState<'firebase' | 'sheets' | 'cache'>('firebase');
  const [sheetLastSyncAt, setSheetLastSyncAt] = useState<string | null>(null);
  const [sheetFeedback, setSheetFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [sheetConfirmDialog, setSheetConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'amber' | 'red' | 'emerald';
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Parent Portal & Teacher Verification States
  const [parentScriptUrl, setParentScriptUrl] = useState<string>(() => parentEndpointParam || loadSavedParentScriptUrl());
  const [parentSubmissions, setParentSubmissions] = useState<ParentSubmission[]>([]);
  const [reviewTabExists, setReviewTabExists] = useState(true);
  const [parentSubmissionsBusy, setParentSubmissionsBusy] = useState(false);
  const [reviewingSubmissionRowIndex, setReviewingSubmissionRowIndex] = useState<number | null>(null);

  const showNotice = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setSheetFeedback({ type, message });
  }, []);

  // Load records directly from Google Sheets (used on manual load or Firebase quota fallback)
  const loadFromGoogleSheets = useCallback(async (configOverride?: SheetConfig | null, silent = false) => {
    const activeConfig = configOverride ?? sheetConfig;
    if (!activeConfig) {
      if (!silent) showNotice('info', 'Sila cipta atau pautkan Google Sheet terlebih dahulu.');
      return false;
    }

    const token = await getAccessToken();
    if (!token) {
      if (!silent) showNotice('info', 'Sila log masuk akaun Google untuk membaca data dari Google Sheets.');
      return false;
    }

    setSheetBusy(true);
    try {
      const sheetRecords = await fetchRecordsFromSheet(activeConfig, token);
      setRekodPajsk(sheetRecords as RecordData[]);
      try {
        localStorage.setItem('cached_rekod_pajsk', JSON.stringify(sheetRecords));
      } catch (e) {
        console.warn('Could not update cache from Google Sheets:', e);
      }
      setDataSource('sheets');
      setSheetLastSyncAt(new Date().toLocaleTimeString('ms-MY'));
      if (!silent) {
        showNotice('success', `Berjaya memuatkan ${sheetRecords.length} rekod murid daripada Google Sheets (${activeConfig.spreadsheetTitle}).`);
      }
      return true;
    } catch (err) {
      console.error('Error reading Google Sheets:', err);
      if (err instanceof SheetApiError && err.isAuthError) {
        clearAccessToken();
        setHasSheetToken(false);
        showNotice('error', 'Sesi akses Google Sheets telah tamat tempoh. Sila tekan "Sign in with Google" semula.');
      } else {
        showNotice('error', err instanceof Error ? err.message : 'Gagal membaca data daripada Google Sheets.');
      }
      return false;
    } finally {
      setSheetBusy(false);
    }
  }, [sheetConfig, showNotice]);

  // Google Sign-In Handler
  const handleGoogleSignIn = async () => {
    setIsLoggingInGoogle(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setGoogleUser(result.user);
        setHasSheetToken(true);
        showNotice('success', `Berjaya log masuk sebagai ${result.user.email || result.user.displayName}. Sambungan Google Sheets sedia digunakan.`);
        if (sheetConfig && (quotaWarning || dataSource !== 'firebase')) {
          await loadFromGoogleSheets(sheetConfig, false);
        }
      }
    } catch (err: unknown) {
      console.error('Login Google gagal:', err);
      const authErr = err as { code?: string; message?: string } | null;
      const code = authErr?.code || '';
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

      if (code === 'auth/unauthorized-domain') {
        showNotice(
          'error',
          `Domain belum dibenarkan (${code}): Domain "${currentHost}" perlu ditambah ke Authorized domains dalam Projek Firebase "gen-lang-client-0747859179".`
        );
      } else if (code === 'auth/popup-blocked') {
        showNotice(
          'error',
          `Tetingkap pop-up disekat pelayar (${code}). Sila benarkan Pop-ups & redirects untuk laman "${currentHost}" dan cuba lagi.`
        );
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        showNotice(
          'error',
          `Log masuk Google ditutup sebelum selesai (${code}). Pastikan anda memilih akaun Google dan klik Benarkan (Allow) pada akses Google Sheets.`
        );
      } else if (code === 'auth/operation-not-allowed') {
        showNotice(
          'error',
          `Penyedia log masuk Google belum diaktifkan di Firebase Console (${code}). Sila aktifkan Google Sign-In di Firebase Authentication.`
        );
      } else {
        const detail = code || (authErr?.message ? authErr.message : 'Ralat tidak diketahui');
        showNotice(
          'error',
          `Log masuk Google gagal (${detail}). Sila semak pop-up pelayar, Authorized Domains di Firebase, dan senarai Test Users / OAuth di Google Cloud.`
        );
      }
    } finally {
      setIsLoggingInGoogle(false);
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await logout();
      setGoogleUser(null);
      setHasSheetToken(false);
      showNotice('info', 'Anda telah log keluar daripada akaun Google.');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Auth listener & Initial Data Subscription with LocalStorage + Google Sheets Quota Fallback
  useEffect(() => {
    // Dalam Mod Portal Ibu Bapa (?mod=ibubapa), jangan sambung ke Firebase langsung (0 kuota Firebase)
    if (isParentMode) {
      setLoading(false);
      return;
    }

    const unsubscribeAuth = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setHasSheetToken(Boolean(token));
      },
      () => {
        setGoogleUser(null);
        setHasSheetToken(false);
      }
    );

    try {
      const cached = localStorage.getItem('cached_rekod_pajsk');
      if (cached) {
        setRekodPajsk(JSON.parse(cached));
        setDataSource('cache');
        setLoading(false);
      }
    } catch (e) {
      console.warn("Could not load from localStorage cache:", e);
    }

    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 2000);

    testConnection().then((status) => {
      if (status.quotaExceeded) {
        setQuotaWarning(true);
        setLoading(false);
      }
    });

    const q = query(collection(db, 'pencapaian'));
    const unsubscribeSnap = onSnapshot(q, (snapshot) => {
      clearTimeout(loadingTimeout);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RecordData[];
      setRekodPajsk(data);
      try {
        localStorage.setItem('cached_rekod_pajsk', JSON.stringify(data));
      } catch (e) {
        console.warn("Could not write to localStorage cache:", e);
      }
      setDataSource('firebase');
      setLoading(false);
      setQuotaWarning(false);
    }, (err: unknown) => {
      clearTimeout(loadingTimeout);
      handleFirestoreError(err, OperationType.LIST, 'pencapaian');
      if (isQuotaError(err)) {
        setQuotaWarning(true);
        setDataSource('cache');
        // Automatically attempt fallback read from Google Sheets if token & sheetConfig are active
        const savedCfg = loadSavedSheetConfig();
        if (savedCfg) {
          getAccessToken().then((token) => {
            if (token) {
              loadFromGoogleSheets(savedCfg, true);
            }
          });
        }
      }
      setLoading(false);
    });

    return () => {
      clearTimeout(loadingTimeout);
      unsubscribeAuth();
      unsubscribeSnap();
    };
  }, [isParentMode, loadFromGoogleSheets]);

  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const yearSet = new Set<number>();
    const minBaseYear = 2023;
    const maxFutureYear = Math.max(currentYear + 5, 2030);
    for (let y = minBaseYear; y <= maxFutureYear; y++) {
      yearSet.add(y);
    }
    rekodPajsk.forEach(r => {
      const parsed = parseInt((r.tahunKalendar || '').trim(), 10);
      if (!Number.isNaN(parsed) && parsed >= 2000 && parsed <= 2100) {
        yearSet.add(parsed);
      }
    });
    const selectedParsed = parseInt(selectedYear, 10);
    if (!Number.isNaN(selectedParsed) && selectedParsed >= 2000 && selectedParsed <= 2100) {
      yearSet.add(selectedParsed);
    }
    return Array.from(yearSet).sort((a, b) => a - b).map(String);
  }, [rekodPajsk, selectedYear]);

  const filteredData = useMemo(() => {
    return rekodPajsk.filter(r => {
      const matchesYear = r.tahunKalendar === selectedYear;
      const matchesSearch = (r.nama || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                            (r.pertandingan || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (r.noKp || '').includes(searchTerm) ||
                            (r.guruPengiring || []).some(g => g.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesAliran = filterAliran === 'SEMUA' || r.aliran === filterAliran;
      const matchesKelas = filterKelas === 'SEMUA' || r.kelas === filterKelas;
      const matchesStatus = filterStatus === 'SEMUA' || normalizeStatus(r.statusPertandingan) === filterStatus;
      const matchesBahagian = filterBahagian === 'SEMUA' || r.bahagian === filterBahagian;
      const matchesPeringkat = filterPeringkat === 'SEMUA' || r.peringkat === filterPeringkat;
      return matchesYear && matchesSearch && matchesAliran && matchesKelas && matchesStatus && matchesBahagian && matchesPeringkat;
    });
  }, [rekodPajsk, selectedYear, searchTerm, filterAliran, filterKelas, filterStatus, filterBahagian, filterPeringkat]);

  // Statistics & Counters for Rekod Murid view
  const statsPeringkat = useMemo(() => {
    // Base records matching current year and non-peringkat filters (to show accurate breakdown across all peringkat)
    const baseRecords = rekodPajsk.filter(r => {
      const matchesYear = r.tahunKalendar === selectedYear;
      const matchesSearch = !searchTerm || 
        (r.nama || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        (r.pertandingan || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.noKp || '').includes(searchTerm);
      const matchesAliran = filterAliran === 'SEMUA' || r.aliran === filterAliran;
      const matchesKelas = filterKelas === 'SEMUA' || r.kelas === filterKelas;
      const matchesStatus = filterStatus === 'SEMUA' || normalizeStatus(r.statusPertandingan) === filterStatus;
      const matchesBahagian = filterBahagian === 'SEMUA' || r.bahagian === filterBahagian;
      return matchesYear && matchesSearch && matchesAliran && matchesKelas && matchesStatus && matchesBahagian;
    });

    const countDaerah = baseRecords.filter(r => r.peringkat === 'Daerah').length;
    const countNegeri = baseRecords.filter(r => r.peringkat === 'Negeri').length;
    const countKebangsaan = baseRecords.filter(r => r.peringkat === 'Kebangsaan').length;
    const countAntarabangsa = baseRecords.filter(r => r.peringkat === 'Antarabangsa').length;
    
    // Total participations in current view vs total records in calendar year
    const totalPenyertaan = filteredData.length;
    const totalTahunSemasa = rekodPajsk.filter(r => r.tahunKalendar === selectedYear).length;
    
    // Bilangan murid unik (berdasarkan IC atau Nama) dalam paparan semasa
    const muridUnik = new Set(
      filteredData.map(r => (r.noKp && r.noKp.trim() !== '' ? r.noKp.trim().replace(/[^0-9]/g, '') : r.nama.trim().toUpperCase()))
    ).size;

    return {
      countDaerah,
      countNegeri,
      countKebangsaan,
      countAntarabangsa,
      totalPenyertaan,
      totalTahunSemasa,
      muridUnik
    };
  }, [rekodPajsk, selectedYear, searchTerm, filterAliran, filterKelas, filterStatus, filterBahagian, filteredData]);

  const guruPengiringSummaries = useMemo(() => {
    type CompEntry = {
      key: string;
      pertandingan: string;
      bahagian: string;
      peringkat: string;
      status: string;
      tarikh: string;
      pencapaianSet: Set<string>;
      bilMurid: number;
    };
    type GuruMapEntry = {
      namaGuru: string;
      competitions: Map<string, CompEntry>;
      totalMurid: number;
    };

    const map = new Map<string, GuruMapEntry>();

    filteredData.forEach((r) => {
      const guruList = Array.from(
        new Set<string>((r.guruPengiring || []).map((g) => g.trim().toUpperCase()).filter(Boolean))
      );
      if (guruList.length === 0) return;

      const tarikhStr = formatTarikhPaparan(r.jenisTarikh, r.tarikhMula, r.tarikhTamat) || '-';
      const statusNorm = normalizeStatus(r.statusPertandingan);
      const compKey = `${(r.pertandingan || '').trim().toUpperCase()}|${r.peringkat}|${r.bahagian}|${tarikhStr}|${statusNorm}`;

      guruList.forEach((namaGuru) => {
        let guruEntry = map.get(namaGuru);
        if (!guruEntry) {
          guruEntry = {
            namaGuru,
            competitions: new Map<string, CompEntry>(),
            totalMurid: 0
          };
          map.set(namaGuru, guruEntry);
        }

        guruEntry.totalMurid += 1;
        let comp = guruEntry.competitions.get(compKey);
        if (!comp) {
          comp = {
            key: compKey,
            pertandingan: (r.pertandingan || '').trim().toUpperCase(),
            bahagian: r.bahagian || '-',
            peringkat: r.peringkat || '-',
            status: statusNorm,
            tarikh: tarikhStr,
            pencapaianSet: new Set<string>(),
            bilMurid: 0
          };
          guruEntry.competitions.set(compKey, comp);
        }
        if (r.pencapaian) {
          comp.pencapaianSet.add(r.pencapaian);
        }
        comp.bilMurid += 1;
      });
    });

    const queryLower = guruReportSearch.trim().toLowerCase();
    const list = Array.from(map.values())
      .map((entry) => {
        const competitions = Array.from(entry.competitions.values()).map((c) => ({
          key: c.key,
          pertandingan: c.pertandingan,
          bahagian: c.bahagian,
          peringkat: c.peringkat,
          status: c.status,
          tarikh: c.tarikh,
          pencapaian: Array.from(c.pencapaianSet).join(', ') || '-',
          bilMurid: c.bilMurid
        }));
        return {
          namaGuru: entry.namaGuru,
          competitions,
          bilPertandingan: competitions.length,
          totalMurid: entry.totalMurid
        };
      })
      .filter((item) => {
        if (!queryLower) return true;
        return (
          item.namaGuru.toLowerCase().includes(queryLower) ||
          item.competitions.some((c) => c.pertandingan.toLowerCase().includes(queryLower))
        );
      });

    list.sort((a, b) => {
      if (guruReportSort === 'za') {
        return b.namaGuru.localeCompare(a.namaGuru, 'ms');
      }
      if (guruReportSort === 'aktif') {
        if (b.bilPertandingan !== a.bilPertandingan) return b.bilPertandingan - a.bilPertandingan;
        if (b.totalMurid !== a.totalMurid) return b.totalMurid - a.totalMurid;
      }
      return a.namaGuru.localeCompare(b.namaGuru, 'ms');
    });

    return list;
  }, [filteredData, guruReportSearch, guruReportSort]);

  const refreshParentSubmissions = useCallback(async (silent = false) => {
    if (!sheetConfig) {
      if (!silent) showNotice('info', 'Sila sambungkan Google Sheet terlebih dahulu.');
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      if (!silent) showNotice('info', 'Sila log masuk akaun Google untuk membaca kiriman ibu bapa.');
      return;
    }

    setParentSubmissionsBusy(true);
    try {
      const res = await fetchParentSubmissionsFromSheet(sheetConfig, token);
      setReviewTabExists(res.exists);
      setParentSubmissions(res.submissions);
      if (!silent && res.exists) {
        showNotice('success', `Berjaya memuatkan ${res.submissions.length} kiriman daripada tab Semakan Ibu Bapa.`);
      }
    } catch (err) {
      console.error('Error fetching parent submissions:', err);
      if (err instanceof SheetApiError && err.isAuthError) {
        clearAccessToken();
        setHasSheetToken(false);
        showNotice('error', 'Sesi akses Google tamat tempoh. Sila log masuk semula.');
      } else {
        showNotice('error', err instanceof Error ? err.message : 'Gagal membaca tab Semakan Ibu Bapa.');
      }
    } finally {
      setParentSubmissionsBusy(false);
    }
  }, [sheetConfig, showNotice]);

  const pendingParentCount = useMemo(
    () => parentSubmissions.filter(s => s.statusSemakan === 'MENUNGGU SEMAKAN').length,
    [parentSubmissions]
  );

  const switchView = (view: 'dashboard' | 'kemasukan' | 'senarai' | 'semakan') => {
    setActiveView(view);
    if (view !== 'kemasukan') {
      setEditingId(null);
      setReviewingSubmissionRowIndex(null);
      resetFormData();
    }
    if (view === 'semakan' && sheetConfig && hasSheetToken) {
      void refreshParentSubmissions(true);
    }
  };

  const resetFormData = () => {
    setFormData({
      nama: '',
      noKp: '',
      aliran: 'Tahun 1',
      kelas: 'UIAM',
      bahagian: 'Unit Beruniform',
      pertandingan: '',
      jenisTarikh: 'satu_hari',
      tarikhMula: '',
      tarikhTamat: '',
      statusPertandingan: 'KPM',
      suratPengiktirafanNama: '',
      suratPengiktirafanData: '',
      sijilMuridNama: '',
      sijilMuridData: '',
      peringkat: 'Daerah',
      pencapaian: 'Penyertaan',
      guruPengiring: [''],
      creatorId: ''
    });
  };

  const updateFormData = (key: string, val: string) => {
    setFormData(prev => ({ ...prev, [key]: val }));
  };

  const handleAttachmentUpload = async (
    file: File | undefined,
    target: 'individu' | 'pukal' | 'individu_sijil' | 'pukal_sijil'
  ) => {
    if (!file) return;
    setAttachmentBusy(true);
    try {
      const processed = await processRecognitionAttachment(file);
      if (target === 'individu') {
        setFormData(prev => ({
          ...prev,
          suratPengiktirafanNama: processed.nama,
          suratPengiktirafanData: processed.data
        }));
      } else if (target === 'pukal') {
        setBulkHeader(prev => ({
          ...prev,
          suratPengiktirafanNama: processed.nama,
          suratPengiktirafanData: processed.data
        }));
      } else if (target === 'individu_sijil') {
        setFormData(prev => ({
          ...prev,
          sijilMuridNama: processed.nama,
          sijilMuridData: processed.data
        }));
      } else {
        setBulkHeader(prev => ({
          ...prev,
          sijilMuridNama: processed.nama,
          sijilMuridData: processed.data
        }));
      }
      const isSijil = target === 'individu_sijil' || target === 'pukal_sijil';
      showNotice('success', `${isSijil ? 'Sijil murid' : 'Surat pengiktirafan'} "${processed.nama}" berjaya dimuat naik dan sedia disimpan.`);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Gagal memproses fail lampiran.');
    } finally {
      setAttachmentBusy(false);
    }
  };

  // Helper to generate a clean valid Firestore ID
  const generateValidId = (index?: number) => {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 9);
    return `${timestamp}_${randomPart}${index !== undefined ? `_${index}` : ''}`;
  };

  // Execute Single Student Save to both Firebase and Google Sheets
  const executeSingleSave = async () => {
    setSaving(true);
    try {
      const id = editingId || generateValidId();

      const payload = {
        nama: formData.nama.trim().toUpperCase(),
        noKp: (formData.noKp || '').trim(),
        aliran: formData.aliran,
        kelas: formData.kelas,
        bahagian: formData.bahagian,
        pertandingan: formData.pertandingan.trim().toUpperCase(),
        jenisTarikh: formData.jenisTarikh || 'satu_hari',
        tarikhMula: (formData.tarikhMula || '').trim(),
        tarikhTamat: formData.jenisTarikh === 'tempoh' ? (formData.tarikhTamat || '').trim() : '',
        statusPertandingan: formData.statusPertandingan,
        suratPengiktirafanNama: (formData.suratPengiktirafanNama || '').trim(),
        suratPengiktirafanData: (formData.suratPengiktirafanData || '').trim(),
        sijilMuridNama: (formData.sijilMuridNama || '').trim(),
        sijilMuridData: (formData.sijilMuridData || '').trim(),
        peringkat: formData.peringkat,
        pencapaian: formData.pencapaian,
        guruPengiring: (formData.guruPengiring || []).map(g => g.trim().toUpperCase()).filter(Boolean),
        tahunKalendar: selectedYear,
        creatorId: editingId ? (formData.creatorId || 'guru_skauk') : 'guru_skauk',
        updatedAt: serverTimestamp()
      };

      let firebaseSaved = false;
      let firebaseQuotaHit = false;
      try {
        await setDoc(doc(db, 'pencapaian', id), payload, { merge: true });
        firebaseSaved = true;
      } catch (fbError) {
        handleFirestoreError(fbError, editingId ? OperationType.UPDATE : OperationType.CREATE, `pencapaian/${id}`);
        if (isQuotaError(fbError)) {
          firebaseQuotaHit = true;
          setQuotaWarning(true);
        } else {
          console.warn('Firestore save warning:', fbError);
        }
      }

      const localItem: RecordData = { id, ...payload };

      // Dual-save to Google Sheets if connected & signed in
      let sheetSaved = false;
      let sheetMessage = '';
      if (sheetConfig) {
        const token = await getAccessToken();
        if (token) {
          try {
            if (editingId) {
              await updateRecordInSheet(sheetConfig, localItem, token);
            } else {
              await appendRecordsToSheet(sheetConfig, [localItem], token);
            }
            sheetSaved = true;
            setSheetLastSyncAt(new Date().toLocaleTimeString('ms-MY'));
          } catch (shErr) {
            console.error('Google Sheets save error:', shErr);
            if (shErr instanceof SheetApiError && shErr.isAuthError) {
              clearAccessToken();
              setHasSheetToken(false);
              sheetMessage = 'Sesi Google Sheets tamat tempoh — sila log masuk Google semula untuk menyegerakkan baris ini.';
            } else {
              sheetMessage = 'Gagal menulis ke Google Sheets. Gunakan butang Segerak di tetapan Sheet.';
            }
          }
        } else {
          sheetMessage = 'Google Sheet dipautkan tetapi belum log masuk Google pada sesi ini.';
        }
      }

      if (!firebaseSaved && !sheetSaved && !firebaseQuotaHit) {
        throw new Error('Gagal menyimpan ke Firebase dan Google Sheets.');
      }

      // Update local state & localStorage cache immediately
      setRekodPajsk(prev => {
        const existingIdx = prev.findIndex(item => item.id === id);
        let nextList: RecordData[];
        if (existingIdx >= 0) {
          const clone = [...prev];
          clone[existingIdx] = localItem;
          nextList = clone;
        } else {
          nextList = [localItem, ...prev];
        }
        try {
          localStorage.setItem('cached_rekod_pajsk', JSON.stringify(nextList));
        } catch (e) {
          console.warn('Cache write error:', e);
        }
        return nextList;
      });

      if (firebaseQuotaHit && sheetSaved) {
        showNotice('info', `Had kuota Firebase dicapai — Rekod ${localItem.nama} berjaya disimpan terus ke Google Sheets & paparan tempatan!`);
      } else if (firebaseSaved && sheetSaved) {
        showNotice('success', `Rekod ${localItem.nama} berjaya disimpan ke Firebase dan Google Sheets.`);
      } else if (firebaseSaved && sheetMessage) {
        showNotice('info', `Disimpan ke Firebase. ${sheetMessage}`);
      } else if (firebaseQuotaHit && !sheetSaved) {
        showNotice('error', `Had kuota Firebase dicapai dan Google Sheets belum disambung. Rekod disimpan dalam cache tempatan pelayar ini sahaja.`);
      }

      // Jika kemasukan ini datang daripada "Edit Dahulu" kiriman ibu bapa, tandakan DISAHKAN pada tab Semakan Ibu Bapa
      if (reviewingSubmissionRowIndex !== null && sheetConfig) {
        const token = await getAccessToken();
        if (token) {
          try {
            await updateParentSubmissionStatusInSheet(sheetConfig, reviewingSubmissionRowIndex, 'DISAHKAN', token);
            await refreshParentSubmissions(true);
          } catch (reviewErr) {
            console.warn('Gagal mengemas kini status semakan ibu bapa:', reviewErr);
          }
        }
        setReviewingSubmissionRowIndex(null);
      }

      resetFormData();
      setEditingId(null);
      switchView('senarai');
    } catch (error) {
      console.error("Error saving data:", error);
      showNotice('error', "Terdapat ralat semasa menyimpan data. Sila semak sambungan atau tetapan Google Sheets.");
    } finally {
      setSaving(false);
    }
  };

  // Handle Single Student Save (asks explicit confirmation before mutating an existing Google Sheet row)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nama.trim() || !formData.pertandingan.trim()) {
      showNotice('error', "Sila isi Nama Murid dan Nama Pertandingan terlebih dahulu.");
      return;
    }

    if (formData.jenisTarikh === 'tempoh' && formData.tarikhMula && formData.tarikhTamat && formData.tarikhTamat < formData.tarikhMula) {
      showNotice('error', "Tarikh Tamat tidak boleh lebih awal daripada Tarikh Mula.");
      return;
    }

    if (editingId && sheetConfig && hasSheetToken) {
      setSheetConfirmDialog({
        title: 'Kemas Kini Data di Firebase & Google Sheets?',
        description: `Anda akan mengemas kini rekod "${formData.nama.trim().toUpperCase()}" (${formData.pertandingan.trim().toUpperCase()}) di dalam pangkalan data Firebase serta menulis semula baris berkaitan di Google Sheets "${sheetConfig.spreadsheetTitle}".`,
        confirmLabel: 'Ya, Kemas Kini Rekod',
        variant: 'amber',
        onConfirm: async () => {
          setSheetConfirmDialog(null);
          await executeSingleSave();
        }
      });
      return;
    }

    await executeSingleSave();
  };

  // Bulk Entry: Row Manipulation
  const addBulkRow = () => {
    setBulkRows(prev => [
      ...prev,
      {
        id: generateValidId(prev.length + 1),
        nama: '',
        noKp: '',
        aliran: bulkHeader.defaultAliran,
        kelas: bulkHeader.defaultKelas,
        pencapaian: bulkHeader.defaultPencapaian
      }
    ]);
  };

  const removeBulkRow = (rowId: string) => {
    if (bulkRows.length <= 1) {
      showNotice('info', "Sekurang-kurangnya satu baris murid diperlukan.");
      return;
    }
    setBulkRows(prev => prev.filter(r => r.id !== rowId));
  };

  const updateBulkRow = (rowId: string, field: keyof BulkStudentRow, value: string) => {
    setBulkRows(prev => prev.map(row => {
      if (row.id === rowId) {
        return { ...row, [field]: value };
      }
      return row;
    }));
  };

  const applyDefaultToAllRows = (field: 'aliran' | 'kelas' | 'pencapaian', val: string) => {
    setBulkRows(prev => prev.map(row => ({ ...row, [field]: val })));
  };

  // Process pasted names into bulk rows
  const handleProcessPaste = () => {
    if (!pasteText.trim()) {
      setShowPasteModal(false);
      return;
    }

    const lines = pasteText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      setShowPasteModal(false);
      return;
    }

    const newRows: BulkStudentRow[] = lines.map((line, idx) => {
      // Check if line contains tab (e.g. from Excel: Name\tIC\tClass)
      const parts = line.split('\t').map(p => p.trim());
      let cleanName = parts[0] || '';
      let cleanNoKp = parts[1] || '';
      
      // Clean leading numbering like "1. ", "1 - ", etc.
      cleanName = cleanName.replace(/^\d+[\.\-\)\s]+/, '').trim().toUpperCase();
      cleanNoKp = cleanNoKp.replace(/\D/g, '');

      return {
        id: generateValidId(idx + 1),
        nama: cleanName,
        noKp: cleanNoKp,
        aliran: bulkHeader.defaultAliran,
        kelas: bulkHeader.defaultKelas,
        pencapaian: bulkHeader.defaultPencapaian
      };
    });

    setBulkRows(newRows);
    setPasteText('');
    setShowPasteModal(false);
  };

  // Handle Bulk Submit (Dual-Save to Firebase & Google Sheets)
  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkHeader.pertandingan.trim()) {
      showNotice('error', "Sila masukkan Nama Aktiviti / Pertandingan terlebih dahulu.");
      return;
    }

    if (bulkHeader.jenisTarikh === 'tempoh' && bulkHeader.tarikhMula && bulkHeader.tarikhTamat && bulkHeader.tarikhTamat < bulkHeader.tarikhMula) {
      showNotice('error', "Tarikh Tamat tidak boleh lebih awal daripada Tarikh Mula.");
      return;
    }

    const validRows = bulkRows.filter(r => r.nama.trim().length > 0);
    if (validRows.length === 0) {
      showNotice('error', "Sila masukkan sekurang-kurangnya satu nama murid yang lengkap.");
      return;
    }

    setSaving(true);
    setSavingProgress({ current: 0, total: validRows.length });

    try {
      const addedRecords: RecordData[] = [];
      let firebaseSuccessCount = 0;
      let firebaseQuotaHit = false;

      const guruListBulk = (bulkHeader.guruPengiring || []).map(g => g.trim().toUpperCase()).filter(Boolean);

      for (let i = 0; i < validRows.length; i++) {
        const student = validRows[i];
        const docId = generateValidId(i + 1);

        const payload = {
          nama: student.nama.trim().toUpperCase(),
          noKp: (student.noKp || '').trim(),
          aliran: student.aliran,
          kelas: student.kelas,
          bahagian: bulkHeader.bahagian,
          pertandingan: bulkHeader.pertandingan.trim().toUpperCase(),
          jenisTarikh: bulkHeader.jenisTarikh || 'satu_hari',
          tarikhMula: (bulkHeader.tarikhMula || '').trim(),
          tarikhTamat: bulkHeader.jenisTarikh === 'tempoh' ? (bulkHeader.tarikhTamat || '').trim() : '',
          statusPertandingan: bulkHeader.statusPertandingan,
          suratPengiktirafanNama: (bulkHeader.suratPengiktirafanNama || '').trim(),
          suratPengiktirafanData: (bulkHeader.suratPengiktirafanData || '').trim(),
          sijilMuridNama: (bulkHeader.sijilMuridNama || '').trim(),
          sijilMuridData: (bulkHeader.sijilMuridData || '').trim(),
          peringkat: bulkHeader.peringkat,
          pencapaian: student.pencapaian || bulkHeader.defaultPencapaian,
          guruPengiring: guruListBulk,
          tahunKalendar: selectedYear,
          creatorId: 'guru_skauk',
          updatedAt: serverTimestamp()
        };

        if (!firebaseQuotaHit) {
          try {
            await setDoc(doc(db, 'pencapaian', docId), payload);
            firebaseSuccessCount++;
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.CREATE, `pencapaian/${docId}`);
            if (isQuotaError(fbErr)) {
              firebaseQuotaHit = true;
              setQuotaWarning(true);
            }
          }
        }

        addedRecords.push({ id: docId, ...payload });
        setSavingProgress({ current: i + 1, total: validRows.length });
      }

      // Dual-save entire batch to Google Sheets in a single API call
      let sheetSaved = false;
      let sheetWarn = '';
      if (sheetConfig) {
        const token = await getAccessToken();
        if (token) {
          try {
            await appendRecordsToSheet(sheetConfig, addedRecords, token);
            sheetSaved = true;
            setSheetLastSyncAt(new Date().toLocaleTimeString('ms-MY'));
          } catch (shErr) {
            console.error('Google Sheets bulk append error:', shErr);
            if (shErr instanceof SheetApiError && shErr.isAuthError) {
              clearAccessToken();
              setHasSheetToken(false);
              sheetWarn = 'Sesi Google Sheets tamat tempoh — sila log masuk semula dan tekan Segerak.';
            } else {
              sheetWarn = 'Ralat menulis ke Google Sheets. Sila tekan Segerak dalam tetapan Google Sheet.';
            }
          }
        } else {
          sheetWarn = 'Google Sheet belum dilog masuk pada sesi ini.';
        }
      }

      // Update local state & localStorage cache with the saved records
      setRekodPajsk(prev => {
        const nextList = [...addedRecords, ...prev];
        try {
          localStorage.setItem('cached_rekod_pajsk', JSON.stringify(nextList));
        } catch (e) {
          console.warn('Cache write error:', e);
        }
        return nextList;
      });

      const compName = bulkHeader.pertandingan.trim().toUpperCase();
      if (firebaseQuotaHit && sheetSaved) {
        showNotice('info', `Had kuota Firebase dicapai — ${validRows.length} murid (${compName}) berjaya disimpan ke Google Sheets!`);
      } else if (firebaseSuccessCount === validRows.length && sheetSaved) {
        showNotice('success', `Berjaya mendaftarkan ${validRows.length} murid (${compName}) ke Firebase dan Google Sheets!`);
      } else if (firebaseSuccessCount > 0 && sheetWarn) {
        showNotice('info', `${firebaseSuccessCount} murid disimpan ke Firebase. ${sheetWarn}`);
      } else if (firebaseSuccessCount > 0) {
        showNotice('success', `Berjaya mendaftarkan ${validRows.length} murid untuk ${compName} ke Firebase.`);
      } else {
        showNotice('error', `Had kuota Firebase dicapai dan Google Sheets belum disambung. Rekod disimpan dalam cache tempatan sahaja.`);
      }

      // Reset bulk form
      setBulkRows([
        { id: '1', nama: '', noKp: '', aliran: bulkHeader.defaultAliran, kelas: bulkHeader.defaultKelas, pencapaian: bulkHeader.defaultPencapaian },
        { id: '2', nama: '', noKp: '', aliran: bulkHeader.defaultAliran, kelas: bulkHeader.defaultKelas, pencapaian: bulkHeader.defaultPencapaian }
      ]);
      setBulkHeader(prev => ({
        ...prev,
        pertandingan: '',
        jenisTarikh: 'satu_hari',
        tarikhMula: '',
        tarikhTamat: '',
        suratPengiktirafanNama: '',
        suratPengiktirafanData: '',
        sijilMuridNama: '',
        sijilMuridData: '',
        guruPengiring: ['']
      }));
      switchView('senarai');
    } catch (error) {
      console.error("Error bulk saving data:", error);
      showNotice('error', "Terdapat ralat semasa menyimpan rekod pukal. Sila semak sambungan internet anda.");
    } finally {
      setSaving(false);
      setSavingProgress(null);
    }
  };

  const editRekod = (id: string) => {
    const item = rekodPajsk.find(r => r.id === id);
    if (item) {
      setFormData({
        nama: item.nama,
        noKp: item.noKp,
        aliran: item.aliran,
        kelas: item.kelas,
        bahagian: item.bahagian,
        pertandingan: item.pertandingan,
        jenisTarikh: item.jenisTarikh === 'tempoh' ? 'tempoh' : 'satu_hari',
        tarikhMula: item.tarikhMula || '',
        tarikhTamat: item.tarikhTamat || '',
        statusPertandingan: item.statusPertandingan || 'KPM',
        suratPengiktirafanNama: item.suratPengiktirafanNama || '',
        suratPengiktirafanData: item.suratPengiktirafanData || '',
        sijilMuridNama: item.sijilMuridNama || '',
        sijilMuridData: item.sijilMuridData || '',
        peringkat: item.peringkat,
        pencapaian: item.pencapaian,
        guruPengiring: item.guruPengiring && item.guruPengiring.length > 0 ? item.guruPengiring : [''],
        creatorId: item.creatorId || ''
      });
      if (item.tahunKalendar) {
        setSelectedYear(item.tahunKalendar);
      }
      setEditingId(id);
      setKemasukanMode('individu');
      // Close any open modals
      setSelectedDashboardPeringkat(null);
      setSelectedDashboardBahagian(null);
      setSelectedPertandinganInModal(null);
      setActiveView('kemasukan');
    }
  };

  const executeDeleteRekod = async (id: string, alsoDeleteSheet: boolean) => {
    try {
      let fbQuotaHit = false;
      try {
        await deleteDoc(doc(db, 'pencapaian', id));
      } catch (fbErr) {
        handleFirestoreError(fbErr, OperationType.DELETE, `pencapaian/${id}`);
        if (isQuotaError(fbErr)) {
          fbQuotaHit = true;
          setQuotaWarning(true);
        }
      }

      let sheetDeleted = false;
      if (alsoDeleteSheet && sheetConfig) {
        const token = await getAccessToken();
        if (token) {
          try {
            sheetDeleted = await deleteRecordFromSheet(sheetConfig, id, token);
            setSheetLastSyncAt(new Date().toLocaleTimeString('ms-MY'));
          } catch (shErr) {
            console.error('Error deleting from Google Sheets:', shErr);
            if (shErr instanceof SheetApiError && shErr.isAuthError) {
              clearAccessToken();
              setHasSheetToken(false);
            }
          }
        }
      }

      setRekodPajsk(prev => {
        const nextList = prev.filter(r => r.id !== id);
        try {
          localStorage.setItem('cached_rekod_pajsk', JSON.stringify(nextList));
        } catch (e) {
          console.warn('Cache write error:', e);
        }
        return nextList;
      });
      setDeleteConfirmId(null);

      if (sheetDeleted) {
        showNotice('success', fbQuotaHit ? 'Rekod dipadam dari Google Sheets & paparan.' : 'Rekod dipadam dari Firebase dan Google Sheets.');
      } else if (!fbQuotaHit) {
        showNotice('success', 'Rekod berjaya dipadam.');
      }
    } catch (error) {
      console.error("Error deleting data:", error);
      showNotice('error', "Ralat semasa memadam data.");
    }
  };

  const deleteRekod = async (id: string) => {
    const targetItem = rekodPajsk.find(r => r.id === id);
    if (sheetConfig && hasSheetToken && targetItem) {
      setSheetConfirmDialog({
        title: 'Padam Rekod dari Firebase & Google Sheets?',
        description: `Tindakan ini akan memadam rekod murid "${targetItem.nama}" (${targetItem.pertandingan}) daripada Firebase dan membuang baris yang sepadan di Google Sheets "${sheetConfig.spreadsheetTitle}". Tindakan ini tidak boleh diundur.`,
        confirmLabel: 'Sah Padam Kedua-duanya',
        variant: 'red',
        onConfirm: async () => {
          setSheetConfirmDialog(null);
          await executeDeleteRekod(id, true);
        }
      });
      return;
    }

    await executeDeleteRekod(id, false);
  };

  // Google Sheet Management Handlers
  const handleCreateNewSheet = async () => {
    const token = await getAccessToken();
    if (!token) {
      showNotice('info', 'Sila log masuk akaun Google terlebih dahulu.');
      return;
    }

    setSheetBusy(true);
    try {
      const created = await createStudentSpreadsheet(token, `REKOD PENCAPAIAN PAJSK SKAUK`);
      setSheetConfig(created);
      setSheetUrlInput('');
      showNotice('success', `Google Sheet baharu "${created.spreadsheetTitle}" berjaya dicipta dan disambungkan!`);

      // Offer to sync existing records right away if any exist
      if (rekodPajsk.length > 0) {
        setSheetConfirmDialog({
          title: 'Segerakkan Rekod Sedia Ada ke Google Sheet Baharu?',
          description: `Terdapat ${rekodPajsk.length} rekod murid sedia ada dalam sistem. Adakah anda mahu menyalin semua rekod ini ke dalam Google Sheet "${created.spreadsheetTitle}" sekarang?`,
          confirmLabel: `Ya, Salin ${rekodPajsk.length} Rekod`,
          variant: 'emerald',
          onConfirm: async () => {
            setSheetConfirmDialog(null);
            setSheetBusy(true);
            try {
              const res = await syncMissingRecordsToSheet(created, rekodPajsk, token);
              setSheetLastSyncAt(new Date().toLocaleTimeString('ms-MY'));
              showNotice('success', `${res.addedCount} rekod sedia ada berjaya disalin ke Google Sheets!`);
            } catch (err) {
              console.error('Sync after create error:', err);
              showNotice('error', 'Gagal menyalin rekod sedia ada ke Google Sheets.');
            } finally {
              setSheetBusy(false);
            }
          }
        });
      }
    } catch (err) {
      console.error('Create sheet error:', err);
      if (err instanceof SheetApiError && err.isAuthError) {
        clearAccessToken();
        setHasSheetToken(false);
        showNotice('error', 'Sesi akses Google tamat tempoh. Sila log masuk Google semula.');
      } else {
        showNotice('error', err instanceof Error ? err.message : 'Gagal mencipta Google Sheet baharu.');
      }
    } finally {
      setSheetBusy(false);
    }
  };

  const handleLinkExistingSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrlInput.trim()) {
      showNotice('error', 'Sila tampal pautan URL atau ID Google Sheet.');
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      showNotice('info', 'Sila log masuk akaun Google terlebih dahulu.');
      return;
    }

    setSheetBusy(true);
    try {
      const { config, hasHeaders, firstRowValues } = await inspectSpreadsheet(sheetUrlInput, token);

      const finalizeLink = async (writeHeaders: boolean) => {
        if (writeHeaders) {
          await ensureSheetHeaders(config, token);
        }
        saveSheetConfig(config);
        setSheetConfig(config);
        setSheetUrlInput('');
        showNotice('success', `Berjaya dipautkan dengan Google Sheet "${config.spreadsheetTitle}" (Tab: ${config.sheetTitle}).`);
      };

      if (!hasHeaders && firstRowValues.length > 0) {
        setSheetConfirmDialog({
          title: 'Tulis Header Sistem pada Baris 1 Google Sheet?',
          description: `Tab "${config.sheetTitle}" dalam fail "${config.spreadsheetTitle}" sudah mempunyai data pada baris pertama. Sahkan jika anda mahu menulis tajuk kolum sistem pada baris 1 (A1:M1), atau kekalkan data sedia ada.`,
          confirmLabel: 'Tulis Header & Pautkan',
          variant: 'amber',
          onConfirm: async () => {
            setSheetConfirmDialog(null);
            setSheetBusy(true);
            try {
              await finalizeLink(true);
            } finally {
              setSheetBusy(false);
            }
          }
        });
      } else {
        await finalizeLink(!hasHeaders);
      }
    } catch (err) {
      console.error('Link sheet error:', err);
      if (err instanceof SheetApiError && err.isAuthError) {
        clearAccessToken();
        setHasSheetToken(false);
        showNotice('error', 'Sesi akses Google tamat tempoh. Sila log masuk Google semula.');
      } else {
        showNotice('error', err instanceof Error ? err.message : 'Gagal mengakses Google Sheet. Pastikan URL/ID betul dan anda mempunyai akses edit.');
      }
    } finally {
      setSheetBusy(false);
    }
  };

  const handleRequestSyncAllToSheet = () => {
    if (!sheetConfig) {
      setShowSheetModal(true);
      return;
    }
    if (!hasSheetToken) {
      showNotice('info', 'Sila log masuk Google terlebih dahulu untuk menyegerakkan data.');
      return;
    }

    setSheetConfirmDialog({
      title: 'Segerak Semua Rekod ke Google Sheets?',
      description: `Sistem akan menyemak ${rekodPajsk.length} rekod semasa dan menambah mana-mana rekod yang belum wujud ke dalam Google Sheet "${sheetConfig.spreadsheetTitle}" (Tab: ${sheetConfig.sheetTitle}) tanpa memadam data sedia ada.`,
      confirmLabel: 'Ya, Segerak Sekarang',
      variant: 'emerald',
      onConfirm: async () => {
        setSheetConfirmDialog(null);
        const token = await getAccessToken();
        if (!token) return;
        setSheetBusy(true);
        try {
          const result = await syncMissingRecordsToSheet(sheetConfig, rekodPajsk, token);
          setSheetLastSyncAt(new Date().toLocaleTimeString('ms-MY'));
          if (result.addedCount > 0) {
            showNotice('success', `Selesai! ${result.addedCount} rekod baharu ditambah ke Google Sheets (${result.alreadySyncedCount} rekod sudah wujud).`);
          } else {
            showNotice('info', `Semua ${result.alreadySyncedCount} rekod sudah pun disegerakkan di dalam Google Sheets.`);
          }
        } catch (err) {
          console.error('Sync all error:', err);
          if (err instanceof SheetApiError && err.isAuthError) {
            clearAccessToken();
            setHasSheetToken(false);
            showNotice('error', 'Sesi akses Google tamat tempoh. Sila log masuk semula.');
          } else {
            showNotice('error', err instanceof Error ? err.message : 'Gagal menyegerakkan rekod ke Google Sheets.');
          }
        } finally {
          setSheetBusy(false);
        }
      }
    });
  };

  const handleDisconnectSheet = () => {
    saveSheetConfig(null);
    setSheetConfig(null);
    showNotice('info', 'Pautan Google Sheet telah diputuskan daripada paparan ini (fail asal anda di Google Drive tidak dipadam).');
  };

  const exportExcel = () => {
    const dataToExport = filteredData.map((r, i) => ({
      "BIL": i + 1,
      "NAMA MURID": r.nama,
      "NO. KP / MYKID": r.noKp || '-',
      "ALIRAN": r.aliran,
      "KELAS": r.kelas,
      "BAHAGIAN": r.bahagian,
      "AKTIVITI / PERTANDINGAN": r.pertandingan,
      "TARIKH AKTIVITI": formatTarikhPaparan(r.jenisTarikh, r.tarikhMula, r.tarikhTamat) || '-',
      "STATUS PERTANDINGAN": normalizeStatus(r.statusPertandingan),
      "SURAT PENGIKTIRAFAN": r.suratPengiktirafanNama || (r.suratPengiktirafanData ? 'Ada Lampiran' : (normalizeStatus(r.statusPertandingan) === 'LUAR KPM (PENGIKTIRAFAN)' ? 'Tiada Lampiran' : '-')),
      "SIJIL PENCAPAIAN / PENYERTAAN": r.sijilMuridNama || (r.sijilMuridData ? 'Ada Lampiran' : '-'),
      "PERINGKAT": r.peringkat,
      "PENCAPAIAN": r.pencapaian,
      "GURU PENGIRING / JURULATIH": (r.guruPengiring && r.guruPengiring.length > 0) ? r.guruPengiring.join(', ') : '-',
      "TAHUN": r.tahunKalendar
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekod PAJSK");
    
    const statusSuffix = filterStatus !== 'SEMUA' ? `_${filterStatus.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const bahagianSuffix = filterBahagian !== 'SEMUA' ? `_${filterBahagian.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const peringkatSuffix = filterPeringkat !== 'SEMUA' ? `_${filterPeringkat.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    XLSX.writeFile(wb, `REKOD_PENYERTAAN_SKAUK_${selectedYear}${statusSuffix}${bahagianSuffix}${peringkatSuffix}.xlsx`);
  };

  const exportPDF = () => {
    const docPdf = new jsPDF('landscape');
    docPdf.setFontSize(14);
    docPdf.text(`REKOD PENCAPAIAN KO-KURIKULUM SKAUK (${selectedYear})`, 14, 15);
    docPdf.setFontSize(9);
    
    const filterInfo = [
      filterStatus !== 'SEMUA' ? `Status: ${filterStatus}` : '',
      filterBahagian !== 'SEMUA' ? `Bahagian: ${filterBahagian}` : '',
      filterPeringkat !== 'SEMUA' ? `Peringkat: ${filterPeringkat}` : '',
      filterAliran !== 'SEMUA' ? `Aliran: ${filterAliran}` : '',
      filterKelas !== 'SEMUA' ? `Kelas: ${filterKelas}` : ''
    ].filter(Boolean).join(' • ');

    const filterSubtitle = filterInfo ? ` | Penapis: ${filterInfo}` : '';
    docPdf.text(`Jumlah Rekod: ${filteredData.length}${filterSubtitle} | Tarikh Cetakan: ${new Date().toLocaleDateString('ms-MY')}`, 14, 22);

    const tableRows = filteredData.map((r, i) => [
      i + 1,
      r.nama,
      r.noKp || '-',
      `${r.aliran} (${r.kelas})`,
      r.bahagian,
      r.pertandingan,
      formatTarikhPaparan(r.jenisTarikh, r.tarikhMula, r.tarikhTamat) || '-',
      normalizeStatus(r.statusPertandingan),
      r.peringkat,
      r.pencapaian,
      (r.guruPengiring && r.guruPengiring.length > 0) ? r.guruPengiring.join(', ') : '-'
    ]);

    autoTable(docPdf, {
      head: [['BIL', 'NAMA MURID', 'NO. KP', 'KELAS', 'BAHAGIAN', 'PERTANDINGAN', 'TARIKH', 'STATUS', 'PERINGKAT', 'PENCAPAIAN', 'GURU PENGIRING']],
      body: tableRows,
      startY: 28,
      theme: 'grid',
      styles: { fontSize: 6.5, font: 'helvetica' },
      headStyles: { fillColor: [245, 158, 11], textColor: [0, 0, 0], fontStyle: 'bold' }
    });

    const statusSuffix = filterStatus !== 'SEMUA' ? `_${filterStatus.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const bahagianSuffix = filterBahagian !== 'SEMUA' ? `_${filterBahagian.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const peringkatSuffix = filterPeringkat !== 'SEMUA' ? `_${filterPeringkat.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    docPdf.save(`LAPORAN_SKAUK_${selectedYear}${statusSuffix}${bahagianSuffix}${peringkatSuffix}.pdf`);
  };

  const exportGuruExcel = () => {
    const summaryRows = guruPengiringSummaries.map((g, idx) => ({
      "BIL": idx + 1,
      "NAMA GURU PENGIRING / JURULATIH": g.namaGuru,
      "BIL. PERTANDINGAN": g.bilPertandingan,
      "BIL. MURID DIBIMBING": g.totalMurid,
      "SENARAI PERTANDINGAN & PENCAPAIAN": g.competitions
        .map((c) => `${c.pertandingan} [${c.peringkat}${c.tarikh !== '-' ? ` • ${c.tarikh}` : ''} • ${c.pencapaian} • ${c.bilMurid} murid]`)
        .join(' | ')
    }));

    const detailRows: Array<Record<string, string | number>> = [];
    let detailIdx = 1;
    guruPengiringSummaries.forEach((g) => {
      g.competitions.forEach((c) => {
        detailRows.push({
          "BIL": detailIdx++,
          "NAMA GURU PENGIRING / JURULATIH": g.namaGuru,
          "NAMA PERTANDINGAN / AKTIVITI": c.pertandingan,
          "BAHAGIAN": c.bahagian,
          "TARIKH AKTIVITI": c.tarikh,
          "STATUS": c.status,
          "PERINGKAT": c.peringkat,
          "PENCAPAIAN MURID": c.pencapaian,
          "BIL. MURID": c.bilMurid
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Rumusan Ikut Guru");
    XLSX.utils.book_append_sheet(wb, wsDetail, "Perincian Pertandingan");

    XLSX.writeFile(wb, `RUMUSAN_GURU_PENGIRING_SKAUK_${selectedYear}.xlsx`);
  };

  const exportGuruPDF = () => {
    const docPdf = new jsPDF('landscape');
    docPdf.setFontSize(14);
    docPdf.text(`RUMUSAN GURU PENGIRING / PEMBIMBING / JURULATIH SKAUK (${selectedYear})`, 14, 15);
    docPdf.setFontSize(9);

    const totalComps = guruPengiringSummaries.reduce((sum, g) => sum + g.bilPertandingan, 0);
    docPdf.text(
      `Jumlah Guru: ${guruPengiringSummaries.length} orang • Jumlah Penglibatan Pertandingan: ${totalComps} | Tarikh Cetakan: ${new Date().toLocaleDateString('ms-MY')}`,
      14,
      22
    );

    const rows: Array<Array<string | number>> = [];
    let rowNum = 1;
    guruPengiringSummaries.forEach((g) => {
      g.competitions.forEach((c, cIdx) => {
        rows.push([
          cIdx === 0 ? rowNum++ : '',
          cIdx === 0 ? g.namaGuru : '',
          c.pertandingan,
          c.bahagian,
          c.peringkat,
          c.tarikh,
          c.pencapaian,
          c.bilMurid
        ]);
      });
    });

    autoTable(docPdf, {
      head: [['BIL', 'NAMA GURU PENGIRING', 'PERTANDINGAN / AKTIVITI', 'BAHAGIAN', 'PERINGKAT', 'TARIKH', 'PENCAPAIAN MURID', 'MURID']],
      body: rows,
      startY: 28,
      theme: 'grid',
      styles: { fontSize: 7.5, font: 'helvetica' },
      headStyles: { fillColor: [180, 83, 9], textColor: [255, 255, 255], fontStyle: 'bold' }
    });

    docPdf.save(`LAPORAN_GURU_PENGIRING_SKAUK_${selectedYear}.pdf`);
  };

  // Helper to copy student names from competition modal
  const copyStudentList = (students: RecordData[]) => {
    const text = students.map((s, idx) => `${idx + 1}. ${s.nama} (${s.aliran} ${s.kelas}) - ${s.pencapaian}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Shortcut to add more students to this exact competition
  const handleAddMoreToThisCompetition = (
    pertandinganName: string,
    bahagian: string,
    peringkat: string,
    statusPertandingan: string,
    compInfo?: RecordData
  ) => {
    setBulkHeader({
      pertandingan: pertandinganName,
      jenisTarikh: compInfo?.jenisTarikh === 'tempoh' ? 'tempoh' : 'satu_hari',
      tarikhMula: compInfo?.tarikhMula || '',
      tarikhTamat: compInfo?.tarikhTamat || '',
      bahagian: bahagian || 'Unit Beruniform',
      statusPertandingan: statusPertandingan || 'KPM',
      suratPengiktirafanNama: compInfo?.suratPengiktirafanNama || '',
      suratPengiktirafanData: compInfo?.suratPengiktirafanData || '',
      sijilMuridNama: compInfo?.sijilMuridNama || '',
      sijilMuridData: compInfo?.sijilMuridData || '',
      peringkat: peringkat || 'Daerah',
      defaultPencapaian: 'Penyertaan',
      defaultAliran: 'Tahun 1',
      defaultKelas: 'UIAM',
      guruPengiring: compInfo?.guruPengiring && compInfo.guruPengiring.length > 0 ? compInfo.guruPengiring : ['']
    });
    setBulkRows([
      { id: '1', nama: '', noKp: '', aliran: 'Tahun 1', kelas: 'UIAM', pencapaian: 'Penyertaan' },
      { id: '2', nama: '', noKp: '', aliran: 'Tahun 1', kelas: 'UIAM', pencapaian: 'Penyertaan' }
    ]);
    setKemasukanMode('pukal');
    setSelectedDashboardPeringkat(null);
    setSelectedDashboardBahagian(null);
    setSelectedPertandinganInModal(null);
    setActiveView('kemasukan');
  };

  // Parent Submissions Review Handlers
  const handleSaveParentScriptUrl = (url: string) => {
    saveParentScriptUrl(url);
    setParentScriptUrl(url);
    if (url.trim()) {
      showNotice('success', 'URL Google Apps Script disimpan. Pautan khas ibu bapa sedia untuk disalin dan dikongsi.');
    } else {
      showNotice('info', 'URL Google Apps Script telah dikosongkan.');
    }
  };

  const handleEnsureParentReviewTab = async () => {
    if (!sheetConfig) return;
    const token = await getAccessToken();
    if (!token) {
      showNotice('info', 'Sila log masuk Google terlebih dahulu.');
      return;
    }
    setParentSubmissionsBusy(true);
    try {
      await ensureParentReviewTab(sheetConfig, token);
      setReviewTabExists(true);
      await refreshParentSubmissions(true);
      showNotice('success', 'Tab "Semakan Ibu Bapa" berjaya dicipta dalam Google Sheets sekolah!');
    } catch (err) {
      console.error('Error creating parent review tab:', err);
      showNotice('error', err instanceof Error ? err.message : 'Gagal mencipta tab Semakan Ibu Bapa.');
    } finally {
      setParentSubmissionsBusy(false);
    }
  };

  const handleApproveParentSubmission = (sub: ParentSubmission) => {
    if (!sheetConfig) return;
    setSheetConfirmDialog({
      title: 'Sahkan & Terima Kiriman Ibu Bapa?',
      description: `Rekod murid "${sub.nama}" (${sub.pertandingan}) akan disimpan ke pangkalan data rasmi sekolah (Firebase & Google Sheet "${sheetConfig.sheetTitle}") serta ditandakan DISAHKAN pada tab Semakan Ibu Bapa.`,
      confirmLabel: 'Ya, Sahkan & Simpan',
      variant: 'emerald',
      onConfirm: async () => {
        setSheetConfirmDialog(null);
        const token = await getAccessToken();
        if (!token) {
          showNotice('info', 'Sila log masuk Google terlebih dahulu.');
          return;
        }

        setParentSubmissionsBusy(true);
        try {
          const id = generateValidId();
          const payload = {
            nama: sub.nama.trim().toUpperCase(),
            noKp: (sub.noKp || '').trim(),
            aliran: sub.aliran || 'Tahun 1',
            kelas: sub.kelas || 'UIAM',
            bahagian: sub.bahagian || 'Unit Beruniform',
            pertandingan: sub.pertandingan.trim().toUpperCase(),
            jenisTarikh: sub.jenisTarikh || 'satu_hari',
            tarikhMula: (sub.tarikhMula || '').trim(),
            tarikhTamat: sub.jenisTarikh === 'tempoh' ? (sub.tarikhTamat || '').trim() : '',
            statusPertandingan: sub.statusPertandingan || 'LUAR KPM (PENGIKTIRAFAN)',
            suratPengiktirafanNama: (sub.suratPengiktirafanNama || '').trim(),
            suratPengiktirafanData: (sub.suratPengiktirafanData || '').trim(),
            sijilMuridNama: (sub.sijilMuridNama || '').trim(),
            sijilMuridData: (sub.sijilMuridData || '').trim(),
            peringkat: sub.peringkat || 'Daerah',
            pencapaian: sub.pencapaian || 'Penyertaan',
            tahunKalendar: sub.tahunKalendar || selectedYear,
            creatorId: 'ibubapa_disahkan_guru',
            updatedAt: serverTimestamp()
          };

          let firebaseSaved = false;
          let firebaseQuotaHit = false;
          try {
            await setDoc(doc(db, 'pencapaian', id), payload, { merge: true });
            firebaseSaved = true;
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.CREATE, `pencapaian/${id}`);
            if (isQuotaError(fbErr)) {
              firebaseQuotaHit = true;
              setQuotaWarning(true);
            }
          }

          const localItem: RecordData = { id, ...payload };
          await appendRecordsToSheet(sheetConfig, [localItem], token);
          await updateParentSubmissionStatusInSheet(sheetConfig, sub.rowIndex, 'DISAHKAN', token);
          setSheetLastSyncAt(new Date().toLocaleTimeString('ms-MY'));

          setRekodPajsk(prev => {
            const nextList = [localItem, ...prev];
            try {
              localStorage.setItem('cached_rekod_pajsk', JSON.stringify(nextList));
            } catch (e) {
              console.warn('Cache write error:', e);
            }
            return nextList;
          });

          await refreshParentSubmissions(true);

          if (firebaseQuotaHit) {
            showNotice('info', `Kiriman "${sub.nama}" disahkan dan dimasukkan ke Google Sheet rasmi (Firebase sedang mencapai had kuota).`);
          } else if (firebaseSaved) {
            showNotice('success', `Kiriman "${sub.nama}" berjaya disahkan dan disimpan ke Firebase serta Google Sheets!`);
          }
        } catch (err) {
          console.error('Approve parent submission error:', err);
          if (err instanceof SheetApiError && err.isAuthError) {
            clearAccessToken();
            setHasSheetToken(false);
            showNotice('error', 'Sesi Google tamat tempoh. Sila log masuk semula.');
          } else {
            showNotice('error', err instanceof Error ? err.message : 'Gagal mengesahkan kiriman ibu bapa.');
          }
        } finally {
          setParentSubmissionsBusy(false);
        }
      }
    });
  };

  const handleEditBeforeApproveParentSubmission = (sub: ParentSubmission) => {
    setFormData({
      nama: sub.nama,
      noKp: sub.noKp,
      aliran: sub.aliran,
      kelas: sub.kelas,
      bahagian: sub.bahagian,
      pertandingan: sub.pertandingan,
      jenisTarikh: sub.jenisTarikh,
      tarikhMula: sub.tarikhMula,
      tarikhTamat: sub.tarikhTamat,
      statusPertandingan: sub.statusPertandingan,
      suratPengiktirafanNama: sub.suratPengiktirafanNama,
      suratPengiktirafanData: sub.suratPengiktirafanData,
      sijilMuridNama: sub.sijilMuridNama,
      sijilMuridData: sub.sijilMuridData,
      peringkat: sub.peringkat,
      pencapaian: sub.pencapaian,
      guruPengiring: [''],
      creatorId: 'ibubapa_disahkan_guru'
    });
    if (sub.tahunKalendar) {
      setSelectedYear(sub.tahunKalendar);
    }
    setEditingId(null);
    setReviewingSubmissionRowIndex(sub.rowIndex);
    setKemasukanMode('individu');
    setActiveView('kemasukan');
    showNotice('info', `Menyunting kiriman "${sub.nama}" (Baris #${sub.rowIndex}). Tekan "Daftar Murid" untuk menyimpan & menandakan DISAHKAN secara automatik.`);
  };

  const handleRejectOrDeleteParentSubmission = (sub: ParentSubmission, action: 'reject' | 'delete') => {
    if (!sheetConfig) return;
    setSheetConfirmDialog({
      title: action === 'delete' ? 'Padam Kiriman dari Tab Semakan Ibu Bapa?' : 'Tandakan Kiriman Sebagai Ditolak?',
      description: action === 'delete'
        ? `Baris #${sub.rowIndex} untuk murid "${sub.nama}" (${sub.pertandingan}) akan dipadam terus daripada tab Semakan Ibu Bapa dalam Google Sheets.`
        : `Status kiriman murid "${sub.nama}" (${sub.pertandingan}) akan ditukar kepada DITOLAK di dalam tab Semakan Ibu Bapa.`,
      confirmLabel: action === 'delete' ? 'Ya, Padam Baris' : 'Ya, Tolak Kiriman',
      variant: 'red',
      onConfirm: async () => {
        setSheetConfirmDialog(null);
        const token = await getAccessToken();
        if (!token) {
          showNotice('info', 'Sila log masuk Google terlebih dahulu.');
          return;
        }
        setParentSubmissionsBusy(true);
        try {
          if (action === 'delete') {
            await deleteParentSubmissionFromSheet(sheetConfig, sub.rowIndex, token);
            showNotice('success', `Baris kiriman "${sub.nama}" dipadam daripada tab Semakan Ibu Bapa.`);
          } else {
            await updateParentSubmissionStatusInSheet(sheetConfig, sub.rowIndex, 'DITOLAK', token);
            showNotice('info', `Kiriman "${sub.nama}" ditandakan sebagai DITOLAK.`);
          }
          await refreshParentSubmissions(true);
        } catch (err) {
          console.error('Reject/Delete parent submission error:', err);
          if (err instanceof SheetApiError && err.isAuthError) {
            clearAccessToken();
            setHasSheetToken(false);
            showNotice('error', 'Sesi Google tamat tempoh. Sila log masuk semula.');
          } else {
            showNotice('error', err instanceof Error ? err.message : 'Gagal mengemas kini tab Semakan Ibu Bapa.');
          }
        } finally {
          setParentSubmissionsBusy(false);
        }
      }
    });
  };

  // Shared Modal Pratonton Surat Pengiktirafan KPM (digunakan oleh Mod Guru & Portal Ibu Bapa)
  const previewDriveFileId = previewSuratModal ? extractDriveFileId(previewSuratModal.data) : null;
  const isPreviewExternalUrl = previewSuratModal ? /^https?:\/\//i.test(previewSuratModal.data) : false;
  const previewIframeSrc = previewSuratModal
    ? (previewDriveFileId ? `https://drive.google.com/file/d/${previewDriveFileId}/preview` : previewSuratModal.data)
    : '';

  const previewSuratModalEl = previewSuratModal ? (
    <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm z-[75] flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-[28px] w-full max-w-3xl max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between gap-4 bg-indigo-50/70">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-indigo-600 text-white p-2.5 rounded-xl shrink-0">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black text-slate-900 uppercase tracking-tight truncate">
                Lampiran Surat KPM / Sijil
              </h3>
              <p className="text-[11px] font-bold text-indigo-700 truncate">
                {previewSuratModal.nama}
                {previewSuratModal.pertandingan ? ` • ${previewSuratModal.pertandingan}` : ''}
                {previewSuratModal.murid ? ` (${previewSuratModal.murid})` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(previewDriveFileId || isPreviewExternalUrl) ? (
              <a
                href={previewSuratModal.data}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{previewDriveFileId ? 'Buka di Google Drive' : 'Buka Fail'}</span>
              </a>
            ) : (
              <a
                href={previewSuratModal.data}
                download={previewSuratModal.nama || 'surat-pengiktirafan-kpm'}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Muat Turun</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => setPreviewSuratModal(null)}
              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 bg-slate-100/80 flex-1 overflow-auto flex items-center justify-center min-h-[320px]">
          {(previewSuratModal.data.startsWith('data:image/') || /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(previewSuratModal.data)) ? (
            <img
              src={previewSuratModal.data}
              alt={previewSuratModal.nama}
              className="max-w-full max-h-[68vh] object-contain rounded-xl shadow-md border border-slate-200 bg-white"
            />
          ) : (
            <iframe
              src={previewIframeSrc}
              title={previewSuratModal.nama}
              className="w-full h-[68vh] rounded-xl border border-slate-200 bg-white shadow-sm"
            />
          )}
        </div>
      </div>
    </div>
  ) : null;

  // Mod Portal Khas Ibu Bapa (Individu Sahaja • 0 Kuota Firebase)
  if (isParentMode || previewParentPortal) {
    return (
      <>
        <ParentPortalView
          appsScriptUrl={parentScriptUrl}
          selectedYear={selectedYear}
          contohSuratUrl={CONTOH_SURAT_KPM_URL}
          senaraiBahagian={senaraiBahagian}
          senaraiPencapaian={senaraiPencapaian}
          senaraiKelas={senaraiKelas}
          senaraiPeringkat={senaraiPeringkat}
          senaraiAliran={senaraiAliran}
          senaraiStatusPertandingan={senaraiStatusPertandingan}
          normalizeStatus={normalizeStatus}
          onPreviewSurat={(info) => setPreviewSuratModal(info)}
          onExitPreview={previewParentPortal && !isParentMode ? () => setPreviewParentPortal(false) : undefined}
        />
        {previewSuratModalEl}
      </>
    );
  }

  if (loading && rekodPajsk.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-amber-500 w-12 h-12" />
          <p className="text-slate-400 font-black text-[10px] tracking-widest uppercase">Memuatkan Data SKAUK...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans flex flex-col lg:flex-row">
      {/* Sidebar Navigation (Compact horizontal bar on mobile/tablet, full sidebar on lg+) */}
      <nav className="w-full lg:w-72 bg-slate-900 text-white p-4 sm:p-5 lg:p-6 flex flex-col shadow-xl z-20 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto transition-all shrink-0">
        <div className="flex flex-row lg:flex-col items-center lg:items-start justify-between gap-3 lg:gap-4 mb-4 lg:mb-6 px-1">
          <div className="flex items-center gap-2.5 lg:gap-3">
            <img src="https://i.postimg.cc/x1yzrs3k/IMG-20220901-WA0001(1).jpg" className="w-9 h-9 lg:w-11 lg:h-11 object-contain bg-white rounded-lg p-0.5 shadow-sm" alt="Logo SKAU" />
            <img src="https://i.postimg.cc/bYsF95Q0/IMG-20220901-WA0002(1).jpg" className="w-9 h-9 lg:w-11 lg:h-11 object-contain bg-white rounded-lg p-0.5 shadow-sm" alt="Logo TS25" />
            <div className="flex items-center gap-2 lg:hidden">
              <h1 className="text-sm font-black tracking-tight italic uppercase leading-tight">
                DATA PENCAPAIAN <span className="text-amber-500">SKAUK</span>
              </h1>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3">
            <div className="bg-amber-500 p-2 rounded-lg shrink-0 text-slate-900 shadow-md">
              <Trophy className="w-5 h-5" />
            </div>
            <h1 className="text-base font-black tracking-tight italic uppercase leading-tight">
              DATA PENCAPAIAN<br/><span className="text-amber-500">SKAUK</span>
            </h1>
          </div>

          {/* Mobile/Tablet Quick Google Sheets Trigger */}
          <button
            type="button"
            onClick={() => setShowSheetModal(true)}
            className={`lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer shrink-0 ${
              sheetConfig && hasSheetToken
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-white/10 text-slate-200 border-white/15 hover:bg-white/15'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>{sheetConfig && hasSheetToken ? 'Sheets Aktif' : 'Google Sheets'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:flex-col gap-2 lg:flex-1">
          <button 
            onClick={() => switchView('dashboard')} 
            className={`w-full flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-1.5 sm:gap-3 lg:gap-4 px-2.5 sm:px-4 py-2.5 lg:py-3.5 rounded-xl transition-all cursor-pointer ${
              activeView === 'dashboard' 
                ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' 
                : 'text-slate-300 bg-white/5 lg:bg-transparent hover:bg-white/10'
            }`}
          >
            <LayoutDashboard className="w-4 h-4 lg:w-5 lg:h-5 shrink-0" />
            <span className="text-[11px] sm:text-xs lg:text-sm font-bold text-center lg:text-left leading-tight">Dashboard Analisis</span>
          </button>

          <button 
            onClick={() => switchView('kemasukan')} 
            className={`w-full flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-1.5 sm:gap-3 lg:gap-4 px-2.5 sm:px-4 py-2.5 lg:py-3.5 rounded-xl transition-all cursor-pointer ${
              activeView === 'kemasukan' 
                ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' 
                : 'text-slate-300 bg-white/5 lg:bg-transparent hover:bg-white/10'
            }`}
          >
            <PlusCircle className="w-4 h-4 lg:w-5 lg:h-5 shrink-0" />
            <div className="flex flex-col text-center lg:text-left">
              <span className="text-[11px] sm:text-xs lg:text-sm font-bold leading-tight">Daftar Pencapaian</span>
              <span className="hidden lg:block text-[9px] font-semibold opacity-75 uppercase tracking-wider">Individu / Pukal</span>
            </div>
          </button>

          <button 
            onClick={() => switchView('senarai')} 
            className={`w-full flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-1.5 sm:gap-3 lg:gap-4 px-2.5 sm:px-4 py-2.5 lg:py-3.5 rounded-xl transition-all cursor-pointer ${
              activeView === 'senarai' 
                ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' 
                : 'text-slate-300 bg-white/5 lg:bg-transparent hover:bg-white/10'
            }`}
          >
            <Users className="w-4 h-4 lg:w-5 lg:h-5 shrink-0" />
            <span className="text-[11px] sm:text-xs lg:text-sm font-bold text-center lg:text-left leading-tight">Rekod Murid</span>
          </button>

          <button 
            onClick={() => switchView('semakan')} 
            className={`w-full flex flex-col sm:flex-row items-center justify-center lg:justify-between gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2.5 lg:py-3.5 rounded-xl transition-all cursor-pointer ${
              activeView === 'semakan' 
                ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' 
                : 'text-slate-300 bg-white/5 lg:bg-transparent hover:bg-white/10'
            }`}
          >
            <div className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 lg:gap-4 min-w-0">
              <Inbox className="w-4 h-4 lg:w-5 lg:h-5 shrink-0" />
              <div className="flex flex-col text-center lg:text-left">
                <span className="text-[11px] sm:text-xs lg:text-sm font-bold leading-tight">Semakan Ibu Bapa</span>
                <span className="hidden lg:block text-[9px] font-semibold opacity-75 uppercase tracking-wider">Portal & Pengesahan</span>
              </div>
            </div>
            {pendingParentCount > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
                activeView === 'semakan' ? 'bg-slate-900 text-amber-400' : 'bg-amber-500 text-slate-900'
              }`}>
                {pendingParentCount}
              </span>
            )}
          </button>
        </div>

        {/* Google Sheets Sandaran & Status Panel (Full card on lg+ sidebar) */}
        <div className="hidden lg:block mt-5 mb-4 p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-[11px] font-black uppercase tracking-wider text-white">Google Sheets</span>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
              sheetConfig && hasSheetToken
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : sheetConfig
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-700 text-slate-300'
            }`}>
              {sheetConfig && hasSheetToken ? 'Aktif' : sheetConfig ? 'Perlu Log Masuk' : 'Belum Sambung'}
            </span>
          </div>

          {sheetConfig && (
            <div className="text-[10px] text-slate-300 bg-black/20 rounded-xl px-2.5 py-2 border border-white/5">
              <div className="font-bold truncate text-white" title={sheetConfig.spreadsheetTitle}>
                {sheetConfig.spreadsheetTitle}
              </div>
              <div className="text-[9px] text-slate-400 truncate mt-0.5">
                Tab: {sheetConfig.sheetTitle}
              </div>
            </div>
          )}

          {!hasSheetToken && (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoggingInGoogle}
              className="w-full bg-white hover:bg-slate-100 text-slate-800 rounded-xl px-3 py-2 flex items-center justify-center gap-2.5 font-bold text-xs shadow-sm transition-all cursor-pointer disabled:opacity-60"
            >
              {isLoggingInGoogle ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
              )}
              <span>Sign in with Google</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowSheetModal(true)}
            className="w-full py-2 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>{sheetConfig ? 'Urus Google Sheets' : 'Sambung Google Sheets'}</span>
          </button>
        </div>

        {quotaWarning && (
          <div className="hidden lg:block mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-[10px] leading-relaxed">
            <span className="font-bold uppercase block mb-1">Had Kuota Firebase Dicapai:</span>
            {dataSource === 'sheets'
              ? 'Data murid kini dipaparkan terus daripada Google Sheets.'
              : 'Gunakan sambungan Google Sheets untuk melihat & menyimpan data terkini.'}
          </div>
        )}
        
        <div className="hidden lg:flex mt-auto pt-4 border-t border-white/10 text-[10px] text-slate-500 font-bold uppercase tracking-widest text-center flex-col items-center gap-1.5">
          <span>
            {dataSource === 'sheets' ? (
              <>Sumber: Google Sheets <span className="text-emerald-400">●</span></>
            ) : dataSource === 'cache' ? (
              <>Sumber: Cache Tempatan <span className="text-amber-400">●</span></>
            ) : sheetConfig && hasSheetToken ? (
              <>Firebase + Sheets Aktif <span className="text-emerald-500">●</span></>
            ) : (
              <>Storan Firebase Aktif <span className="text-emerald-500">●</span></>
            )}
          </span>
          <span className="text-[8px] text-slate-600 font-medium lowercase">skauk-pajsk-system</span>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 lg:h-screen lg:overflow-y-auto w-full max-w-full overflow-x-hidden min-w-0">
        {/* Global Status / Feedback Banner */}
        {sheetFeedback && (
          <div className={`max-w-7xl mx-auto mb-5 p-4 rounded-2xl border flex items-start sm:items-center justify-between gap-3 shadow-sm animate-in fade-in duration-300 ${
            sheetFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : sheetFeedback.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-start sm:items-center gap-3 text-xs font-bold">
              {sheetFeedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : sheetFeedback.type === 'error' ? (
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              ) : (
                <Database className="w-5 h-5 text-amber-600 shrink-0" />
              )}
              <span>{sheetFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setSheetFeedback(null)}
              className="p-1 rounded-lg hover:bg-black/5 cursor-pointer shrink-0"
              title="Tutup makluman"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Firebase Quota Exceeded / Google Sheets Fallback Alert Banner */}
        {(quotaWarning || dataSource === 'sheets') && (
          <div className={`max-w-7xl mx-auto mb-6 p-4 sm:p-5 rounded-[24px] border flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 shadow-sm ${
            quotaWarning
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-emerald-50 border-emerald-200 text-emerald-950'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`p-2.5 rounded-xl shrink-0 ${quotaWarning ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'}`}>
                {quotaWarning ? <CloudOff className="w-5 h-5" /> : <FileSpreadsheet className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wide">
                  {quotaWarning
                    ? 'Had Kuota Firebase Dicapai — Mod Sandaran Google Sheets'
                    : 'Memaparkan Data Murid Daripada Google Sheets'}
                </h3>
                <p className="text-xs font-medium mt-0.5 opacity-90">
                  {quotaWarning && dataSource === 'sheets' && sheetConfig
                    ? `Semua rekod murid (${rekodPajsk.length} rekod) sedang dipaparkan daripada Google Sheet "${sheetConfig.spreadsheetTitle}". Kemasukan data baharu tetap disimpan ke Google Sheets.`
                    : quotaWarning && sheetConfig && !hasSheetToken
                      ? `Sambungan Google Sheet "${sheetConfig.spreadsheetTitle}" dikesan. Sila log masuk Google untuk memaparkan dan menyimpan data terus dari Google Sheets.`
                      : quotaWarning && !sheetConfig
                        ? 'Firebase melebihi had harian. Sila sambungkan Google Sheets supaya data murid boleh dilihat dan rekod baharu dapat disimpan.'
                        : `Paparan kini disegerakkan dengan Google Sheet "${sheetConfig?.spreadsheetTitle}"${sheetLastSyncAt ? ` (Dikemas kini ${sheetLastSyncAt})` : ''}.`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0 w-full lg:w-auto">
              {!hasSheetToken ? (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isLoggingInGoogle}
                  className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 rounded-xl px-4 py-2.5 flex items-center gap-2 font-bold text-xs shadow-xs transition-all cursor-pointer"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  <span>Sign in with Google</span>
                </button>
              ) : sheetConfig ? (
                <button
                  type="button"
                  onClick={() => loadFromGoogleSheets()}
                  disabled={sheetBusy}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-4 py-2.5 flex items-center gap-2 font-black text-xs uppercase tracking-wider shadow-xs transition-all cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${sheetBusy ? 'animate-spin' : ''}`} />
                  <span>Muat Semula dari Google Sheets</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSheetModal(true)}
                  className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl px-4 py-2.5 flex items-center gap-2 font-black text-xs uppercase tracking-wider shadow-xs transition-all cursor-pointer"
                >
                  <Link2 className="w-4 h-4 text-emerald-400" />
                  <span>Sambung Google Sheet</span>
                </button>
              )}
            </div>
          </div>
        )}
        {/* ========================================================= */}
        {/* VIEW 1: DASHBOARD ANALISIS                                */}
        {/* ========================================================= */}
        {activeView === 'dashboard' && (() => {
          const statsDashboard = rekodPajsk.filter(r => r.tahunKalendar === selectedYear);
          const statsBahagian: Record<string, number> = {};
          senaraiBahagian.forEach(b => statsBahagian[b] = 0);
          statsDashboard.forEach(r => { if(statsBahagian[r.bahagian] !== undefined) statsBahagian[r.bahagian]++; });

          return (
            <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-3xl font-black text-slate-800 uppercase italic">Dashboard Analisis</h2>
                  <p className="text-slate-500 font-bold text-xs tracking-widest uppercase">
                    Statistik Keseluruhan Sesi {selectedYear} • Klik pada Peringkat atau Bahagian untuk semak nama murid
                  </p>
                </div>
                <select 
                  value={selectedYear} 
                  onChange={(e) => setSelectedYear(e.target.value)} 
                  className="bg-white border-2 border-slate-200 px-6 py-3 rounded-2xl font-black outline-none focus:border-amber-500 shadow-sm cursor-pointer"
                >
                  {availableYears.map(year => (
                    <option key={year} value={year}>TAHUN {year}</option>
                  ))}
                </select>
              </div>

              {/* Top Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-slate-900 rounded-[40px] p-8 text-white shadow-2xl relative overflow-hidden flex flex-col justify-between h-64">
                  <div className="relative z-10">
                    <p className="text-amber-500 font-black text-[10px] uppercase tracking-widest mb-2">Jumlah Keseluruhan</p>
                    <h3 className="text-7xl font-black italic tracking-tighter">{statsDashboard.length}</h3>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-2">Pencapaian Berdaftar</p>
                  </div>
                  <Award className="absolute -bottom-6 -right-6 w-40 h-40 text-white/5" />
                </div>

                <div className="md:col-span-3 grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {senaraiPeringkat.map(p => {
                    const count = statsDashboard.filter(r => r.peringkat === p).length;
                    return (
                      <div 
                        key={p} 
                        onClick={() => {
                          setSelectedDashboardPeringkat(p);
                          setSelectedPertandinganInModal(null);
                          setModalSearchTerm('');
                          setModalStatusFilter('SEMUA');
                        }}
                        className="bg-white rounded-[32px] p-6 border border-slate-100 shadow-sm flex flex-col justify-center cursor-pointer hover:border-amber-500 hover:shadow-md transition-all group"
                        title="Klik untuk lihat senarai pertandingan & nama murid"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest group-hover:text-amber-500 transition-colors">{p}</p>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-amber-500 transition-transform group-hover:translate-x-0.5" />
                        </div>
                        <h4 className="text-4xl font-black text-slate-800 italic group-hover:scale-105 transition-transform origin-left">{count}</h4>
                        <span className="text-[9px] font-bold text-slate-400 mt-2">Klik untuk semak</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Breakdown by Aliran Year 1 to Year 6 */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {senaraiAliran.map(aliran => {
                  const dataAliran = statsDashboard.filter(r => r.aliran === aliran);
                  return (
                    <div key={aliran} className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-sm">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-slate-100 rounded-lg text-slate-600"><GraduationCap className="w-5 h-5" /></div>
                        <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">Analisis {aliran.toUpperCase()}</h4>
                      </div>
                      <div className="space-y-4">
                        {senaraiPeringkat.map(p => {
                          const count = dataAliran.filter(r => r.peringkat === p).length;
                          const total = dataAliran.length;
                          const percent = total > 0 ? (count / total * 100).toFixed(0) : 0;
                          return (
                            <div key={p}>
                              <div className="flex justify-between text-[10px] font-black uppercase mb-1">
                                <span className="text-slate-500">{p}</span>
                                <span className="text-slate-900 font-bold">{count}</span>
                              </div>
                              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                <div className="bg-amber-500 h-full transition-all duration-1000" style={{ width: `${percent}%` }}></div>
                              </div>
                            </div>
                          );
                        })}
                        <div className="pt-4 border-t border-slate-50 mt-4 flex justify-between items-center">
                          <span className="text-[10px] font-black text-slate-400 uppercase">Jumlah Pencapaian</span>
                          <span className="text-xl font-black text-slate-900 italic">{dataAliran.length}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Breakdown by Bahagian */}
              <div className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-sm">
                <div className="flex items-center gap-3 mb-8">
                  <div className="p-2 bg-amber-100 rounded-lg text-amber-600"><PieChart className="w-5 h-5" /></div>
                  <div>
                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest">Analisis Mengikut Bahagian</h4>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Klik bahagian untuk melihat pertandingan & semak nama murid</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
                  {senaraiBahagian.map(b => (
                    <div 
                      key={b} 
                      onClick={() => {
                        setSelectedDashboardBahagian(b);
                        setSelectedPertandinganInModal(null);
                        setModalSearchTerm('');
                        setModalStatusFilter('SEMUA');
                      }}
                      className="p-5 rounded-3xl bg-slate-50 border border-slate-100 hover:border-amber-400 hover:shadow-md cursor-pointer transition-all group"
                      title="Klik untuk lihat pertandingan dan senarai murid"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-[8px] font-black text-slate-400 uppercase leading-tight group-hover:text-amber-600 transition-colors">{b}</div>
                        <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-amber-500" />
                      </div>
                      <div className="text-2xl font-black text-slate-800 group-hover:scale-105 origin-left transition-transform">{statsBahagian[b]}</div>
                      <span className="text-[8px] font-bold text-slate-400 mt-1 block">Klik semak</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ========================================================= */}
              {/* MODAL 1: PERINGKAT POP-UP & DRILL DOWN KE NAMA MURID      */}
              {/* ========================================================= */}
              {selectedDashboardPeringkat && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                  <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    {/* Modal Header */}
                    <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
                      <div>
                        {selectedPertandinganInModal ? (
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => {
                                setSelectedPertandinganInModal(null);
                                setModalSearchTerm('');
                              }} 
                              className="p-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                            >
                              <ArrowLeft className="w-4 h-4" />
                              <span>Senarai Pertandingan</span>
                            </button>
                            <span className="text-slate-300">/</span>
                            <span className="text-xs font-black uppercase text-amber-600 tracking-wider">Semakan Nama Murid</span>
                          </div>
                        ) : (
                          <>
                            <h3 className="text-xl font-black text-slate-800 uppercase italic">Senarai Pertandingan Peringkat {selectedDashboardPeringkat}</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                              Sesi {selectedYear} • Klik pada mana-mana pertandingan untuk semak senarai nama murid
                            </p>
                          </>
                        )}
                      </div>
                      <button 
                        onClick={() => {
                          setSelectedDashboardPeringkat(null);
                          setSelectedPertandinganInModal(null);
                          setModalSearchTerm('');
                          setModalStatusFilter('SEMUA');
                        }} 
                        className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 rounded-full transition-colors cursor-pointer"
                      >
                        <X className="w-6 h-6" />
                      </button>
                    </div>

                    {/* Modal Content */}
                    <div className="p-6 md:p-8 overflow-y-auto flex-1">
                      {(() => {
                        const filteredList = statsDashboard.filter(r => r.peringkat === selectedDashboardPeringkat);
                        
                        // Group by competition name
                        const grouped = filteredList.reduce((acc, curr) => {
                          const key = curr.pertandingan.trim().toUpperCase();
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(curr);
                          return acc;
                        }, {} as Record<string, typeof filteredList>);
                        
                        const allKeys = Object.keys(grouped).sort();

                        // Count by status
                        const countSemua = allKeys.length;
                        const countKpm = allKeys.filter(k => normalizeStatus(grouped[k][0]?.statusPertandingan) === 'KPM').length;
                        const countLuarPengiktirafan = allKeys.filter(k => normalizeStatus(grouped[k][0]?.statusPertandingan) === 'LUAR KPM (PENGIKTIRAFAN)').length;
                        const countLuarKpm = allKeys.filter(k => normalizeStatus(grouped[k][0]?.statusPertandingan) === 'LUAR KPM').length;

                        // Filter by selected status
                        const keys = modalStatusFilter === 'SEMUA'
                          ? allKeys
                          : allKeys.filter(k => normalizeStatus(grouped[k][0]?.statusPertandingan) === modalStatusFilter);

                        // If user selected a specific competition to drill down:
                        if (selectedPertandinganInModal) {
                          const students = grouped[selectedPertandinganInModal] || [];
                          const compInfo = students[0];
                          const compStatus = normalizeStatus(compInfo?.statusPertandingan);
                          const filteredStudents = students.filter(s => 
                            (s.nama || '').toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                            (s.noKp || '').includes(modalSearchTerm) ||
                            (s.aliran || '').toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                            (s.kelas || '').toLowerCase().includes(modalSearchTerm.toLowerCase())
                          );

                          return (
                            <div className="space-y-6">
                              {/* Competition Summary Banner */}
                              <div className="bg-amber-500/10 border-2 border-amber-500/20 rounded-2xl p-5 md:p-6 space-y-4">
                                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-amber-500/20 pb-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="bg-amber-500 text-slate-900 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm">
                                        Peringkat {selectedDashboardPeringkat}
                                      </span>
                                      <span className={`${getStatusBadgeDark(compStatus)} px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm`}>
                                        {compStatus}
                                      </span>
                                      <span className="bg-white border border-amber-500/30 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm">
                                        {compInfo?.bahagian}
                                      </span>
                                      {formatTarikhPaparan(compInfo?.jenisTarikh, compInfo?.tarikhMula, compInfo?.tarikhTamat) && (
                                        <span className="bg-white border border-amber-500/30 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm inline-flex items-center gap-1">
                                          <Calendar className="w-3 h-3 text-amber-600" />
                                          {formatTarikhPaparan(compInfo?.jenisTarikh, compInfo?.tarikhMula, compInfo?.tarikhTamat)}
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 shrink-0 self-stretch sm:self-auto">
                                      {compInfo?.suratPengiktirafanData && (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewSuratModal({
                                            nama: compInfo.suratPengiktirafanNama || 'Surat Pengiktirafan KPM',
                                            data: compInfo.suratPengiktirafanData || '',
                                            pertandingan: selectedPertandinganInModal
                                          })}
                                          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                                          title="Lihat Surat Pengiktirafan KPM"
                                        >
                                          <Eye className="w-4 h-4" />
                                          <span>Surat KPM</span>
                                        </button>
                                      )}
                                      {compInfo?.sijilMuridData && (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewSuratModal({
                                            nama: compInfo.sijilMuridNama || 'Sijil Pencapaian / Penyertaan Murid',
                                            data: compInfo.sijilMuridData || '',
                                            pertandingan: selectedPertandinganInModal
                                          })}
                                          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                                          title="Lihat Sijil Murid"
                                        >
                                          <Eye className="w-4 h-4" />
                                          <span>Sijil</span>
                                        </button>
                                      )}

                                      <button 
                                        type="button"
                                        onClick={() => copyStudentList(students)} 
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                                        title="Salin senarai nama murid"
                                      >
                                        {copyFeedback ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-400" />}
                                        <span>{copyFeedback ? 'Disalin!' : 'Salin Nama'}</span>
                                      </button>

                                      <button 
                                        type="button"
                                        onClick={() => handleAddMoreToThisCompetition(selectedPertandinganInModal, compInfo?.bahagian, selectedDashboardPeringkat, compStatus, compInfo)}
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-xs font-black shadow-md transition-all cursor-pointer"
                                        title="Tambah murid baru ke pertandingan ini"
                                      >
                                        <UserPlus className="w-4 h-4" />
                                        <span>+ Tambah Murid</span>
                                      </button>
                                    </div>
                                  </div>

                                  <div>
                                    <h4 className="text-base sm:text-lg md:text-xl font-black text-slate-900 uppercase italic tracking-tight break-words leading-snug">
                                      {selectedPertandinganInModal}
                                    </h4>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                                      Jumlah: {students.length} orang murid berdaftar
                                    </p>
                                  </div>
                                </div>

                              {/* Search in Student Roster */}
                              <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
                                <div className="relative w-full sm:w-72">
                                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                  <input 
                                    type="text" 
                                    placeholder="Cari nama atau No. KP..." 
                                    value={modalSearchTerm} 
                                    onChange={(e) => setModalSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-amber-500"
                                  />
                                </div>
                                <span className="text-xs font-bold text-slate-500 self-end sm:self-center">
                                  Menunjukkan <strong className="text-slate-800">{filteredStudents.length}</strong> daripada {students.length} orang murid
                                </span>
                              </div>

                              {/* Student Table */}
                              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-black uppercase text-[10px] tracking-wider">
                                      <th className="py-3 px-4 w-12 text-center">Bil</th>
                                      <th className="py-3 px-4">Nama Murid</th>
                                      <th className="py-3 px-4">No. KP / MyKid</th>
                                      <th className="py-3 px-4">Kelas</th>
                                      <th className="py-3 px-4">Pencapaian</th>
                                      <th className="py-3 px-4 text-right">Tindakan</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {filteredStudents.length === 0 ? (
                                      <tr>
                                        <td colSpan={6} className="py-8 text-center text-slate-400 font-bold uppercase text-xs">
                                          Tiada murid sepadan dengan carian
                                        </td>
                                      </tr>
                                    ) : (
                                      filteredStudents.map((s, idx) => (
                                        <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                                          <td className="py-3 px-4 text-center font-bold text-slate-400">{idx + 1}</td>
                                          <td className="py-3 px-4 font-black text-slate-800 uppercase">{s.nama}</td>
                                          <td className="py-3 px-4 font-semibold text-slate-500">{s.noKp || '-'}</td>
                                          <td className="py-3 px-4">
                                            <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-bold text-[10px]">
                                              {s.aliran} ({s.kelas})
                                            </span>
                                          </td>
                                          <td className="py-3 px-4">
                                            <span className={`inline-block px-2 py-0.5 rounded font-black text-[10px] uppercase tracking-wider ${
                                              s.pencapaian === 'Johan' || s.pencapaian === 'Emas' ? 'bg-amber-100 text-amber-800 font-black' :
                                              s.pencapaian === 'Naib Johan' || s.pencapaian === 'Perak' ? 'bg-slate-200 text-slate-800 font-black' :
                                              s.pencapaian === 'Ketiga' || s.pencapaian === 'Gangsa' ? 'bg-orange-100 text-orange-800 font-black' :
                                              'bg-blue-50 text-blue-700'
                                            }`}>
                                              {s.pencapaian}
                                            </span>
                                          </td>
                                          <td className="py-3 px-4 text-right">
                                            <button 
                                              onClick={() => editRekod(s.id)} 
                                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center gap-1 font-bold text-[10px] cursor-pointer"
                                              title="Kemaskini Maklumat Murid"
                                            >
                                              <Edit3 className="w-3.5 h-3.5" />
                                              <span>Edit</span>
                                            </button>
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        }
                        
                        // Otherwise, show list of competitions in this peringkat:
                        if (allKeys.length === 0) {
                          return <div className="py-12 text-center text-slate-400 font-bold uppercase text-xs tracking-widest italic">Tiada Rekod Pertandingan</div>;
                        }
                        
                        return (
                          <div className="space-y-5">
                            {/* Filter Status Pertandingan Button Group */}
                            <div className="bg-slate-50 border border-slate-200/90 p-4 rounded-2xl space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="p-1.5 bg-amber-500/10 text-amber-600 rounded-lg">
                                    <Filter className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                                      Pilih Status Pertandingan:
                                    </span>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                      Tapis pertandingan mengikut punca pengiktirafan
                                    </p>
                                  </div>
                                </div>
                                {modalStatusFilter !== 'SEMUA' && (
                                  <button 
                                    type="button" 
                                    onClick={() => setModalStatusFilter('SEMUA')}
                                    className="self-start sm:self-auto text-[10px] font-black text-amber-700 hover:text-amber-800 uppercase tracking-wider underline cursor-pointer"
                                  >
                                    Set Semula (Papar Semua {countSemua})
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {/* Button SEMUA */}
                                <button
                                  type="button"
                                  onClick={() => setModalStatusFilter('SEMUA')}
                                  className={`px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-between transition-all cursor-pointer border ${
                                    modalStatusFilter === 'SEMUA'
                                      ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                                  }`}
                                >
                                  <span>Semua</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-black ${
                                    modalStatusFilter === 'SEMUA' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'
                                  }`}>
                                    {countSemua}
                                  </span>
                                </button>

                                {/* Button KPM */}
                                <button
                                  type="button"
                                  onClick={() => setModalStatusFilter('KPM')}
                                  className={`px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-between transition-all cursor-pointer border ${
                                    modalStatusFilter === 'KPM'
                                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                                      : 'bg-white text-emerald-800 border-slate-200 hover:bg-emerald-50 hover:border-emerald-300'
                                  }`}
                                >
                                  <span className="truncate">KPM</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-black ml-1 ${
                                    modalStatusFilter === 'KPM' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-800'
                                  }`}>
                                    {countKpm}
                                  </span>
                                </button>

                                {/* Button LUAR KPM (PENGIKTIRAFAN) */}
                                <button
                                  type="button"
                                  onClick={() => setModalStatusFilter('LUAR KPM (PENGIKTIRAFAN)')}
                                  className={`px-2.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-between transition-all cursor-pointer border ${
                                    modalStatusFilter === 'LUAR KPM (PENGIKTIRAFAN)'
                                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                                      : 'bg-white text-indigo-800 border-slate-200 hover:bg-indigo-50 hover:border-indigo-300'
                                  }`}
                                  title="LUAR KPM (PENGIKTIRAFAN)"
                                >
                                  <span className="truncate text-left text-[10px] sm:text-[11px] leading-tight">Luar (Pengiktirafan)</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-black ml-1 shrink-0 ${
                                    modalStatusFilter === 'LUAR KPM (PENGIKTIRAFAN)' ? 'bg-indigo-700 text-white' : 'bg-indigo-100 text-indigo-800'
                                  }`}>
                                    {countLuarPengiktirafan}
                                  </span>
                                </button>

                                {/* Button LUAR KPM */}
                                <button
                                  type="button"
                                  onClick={() => setModalStatusFilter('LUAR KPM')}
                                  className={`px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-between transition-all cursor-pointer border ${
                                    modalStatusFilter === 'LUAR KPM'
                                      ? 'bg-amber-600 text-white border-amber-600 shadow-md'
                                      : 'bg-white text-amber-800 border-slate-200 hover:bg-amber-50 hover:border-amber-300'
                                  }`}
                                >
                                  <span className="truncate">Luar KPM</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-black ml-1 ${
                                    modalStatusFilter === 'LUAR KPM' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'
                                  }`}>
                                    {countLuarKpm}
                                  </span>
                                </button>
                              </div>
                            </div>

                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                              {modalStatusFilter === 'SEMUA' 
                                ? 'Pilih mana-mana pertandingan di bawah untuk menyemak senarai murid:' 
                                : `Pertandingan berstatus "${modalStatusFilter}" (${keys.length} pertandingan):`}
                            </p>

                            {keys.length === 0 ? (
                              <div className="py-12 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl space-y-3">
                                <p className="text-slate-400 font-bold uppercase text-xs tracking-widest italic">
                                  Tiada pertandingan berstatus "{modalStatusFilter}" di peringkat ini.
                                </p>
                                <button 
                                  type="button" 
                                  onClick={() => setModalStatusFilter('SEMUA')}
                                  className="px-4 py-2 bg-amber-500 text-slate-900 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-amber-400 transition-colors cursor-pointer"
                                >
                                  Papar Semua Pertandingan
                                </button>
                              </div>
                            ) : (
                              keys.map((k, i) => {
                                const competitionStudents = grouped[k];
                                const firstItem = competitionStudents[0];
                                const compStatus = normalizeStatus(firstItem.statusPertandingan);
                                return (
                                  <div 
                                    key={i} 
                                    onClick={() => {
                                      setSelectedPertandinganInModal(k);
                                      setModalSearchTerm('');
                                    }}
                                    className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-5 rounded-2xl bg-slate-50 border border-slate-200 hover:border-amber-400 hover:bg-amber-50/20 hover:shadow-md cursor-pointer transition-all group gap-3"
                                  >
                                    <div>
                                      <div className="font-black text-slate-900 text-sm md:text-base group-hover:text-amber-700 transition-colors">
                                        {k}
                                      </div>
                                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1.5 flex flex-wrap items-center gap-2">
                                        <span className="bg-white border border-slate-200 px-2 py-0.5 rounded font-black text-slate-600">{firstItem.bahagian}</span>
                                        <span className={`px-2 py-0.5 rounded font-black border ${getStatusBadgeClass(compStatus)}`}>
                                          {compStatus}
                                        </span>
                                        {formatTarikhPaparan(firstItem.jenisTarikh, firstItem.tarikhMula, firstItem.tarikhTamat) && (
                                          <span className="bg-white border border-slate-200 px-2 py-0.5 rounded font-bold text-slate-600 inline-flex items-center gap-1">
                                            <Calendar className="w-3 h-3 text-amber-500" />
                                            {formatTarikhPaparan(firstItem.jenisTarikh, firstItem.tarikhMula, firstItem.tarikhTamat)}
                                          </span>
                                        )}
                                        {firstItem.suratPengiktirafanData && (
                                          <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded font-black inline-flex items-center gap-1">
                                            <Paperclip className="w-3 h-3" />
                                            Surat KPM
                                          </span>
                                        )}
                                        {firstItem.sijilMuridData && (
                                          <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded font-black inline-flex items-center gap-1">
                                            <Paperclip className="w-3 h-3" />
                                            Sijil
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                                      <div className="bg-white border border-slate-200 px-3.5 py-2 rounded-xl flex items-center gap-2 shadow-sm">
                                        <Users className="w-4 h-4 text-amber-500" />
                                        <span className="text-xs font-black text-slate-800">{competitionStudents.length} orang murid</span>
                                      </div>
                                      <span className="flex items-center gap-1 text-xs font-black text-amber-600 group-hover:translate-x-1 transition-transform">
                                        Semak Murid <ChevronRight className="w-4 h-4" />
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================= */}
              {/* MODAL 2: BAHAGIAN POP-UP & DRILL DOWN KE NAMA MURID       */}
              {/* ========================================================= */}
              {selectedDashboardBahagian && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                  <div className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    {/* Modal Header */}
                    <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
                      <div>
                        {selectedPertandinganInModal ? (
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => {
                                setSelectedPertandinganInModal(null);
                                setModalSearchTerm('');
                              }} 
                              className="p-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                            >
                              <ArrowLeft className="w-4 h-4" />
                              <span>Senarai Pertandingan</span>
                            </button>
                            <span className="text-slate-300">/</span>
                            <span className="text-xs font-black uppercase text-amber-600 tracking-wider">Semakan Nama Murid</span>
                          </div>
                        ) : (
                          <>
                            <h3 className="text-xl font-black text-slate-800 uppercase italic">Senarai Pertandingan: {selectedDashboardBahagian}</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                              Sesi {selectedYear} • Klik pada mana-mana pertandingan untuk semak senarai nama murid
                            </p>
                          </>
                        )}
                      </div>
                      <button 
                        onClick={() => {
                          setSelectedDashboardBahagian(null);
                          setSelectedPertandinganInModal(null);
                          setModalSearchTerm('');
                          setModalStatusFilter('SEMUA');
                        }} 
                        className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 rounded-full transition-colors cursor-pointer"
                      >
                        <X className="w-6 h-6" />
                      </button>
                    </div>

                    {/* Modal Content */}
                    <div className="p-6 md:p-8 overflow-y-auto flex-1">
                      {(() => {
                        const filteredList = statsDashboard.filter(r => r.bahagian === selectedDashboardBahagian);
                        
                        // Group by competition name
                        const grouped = filteredList.reduce((acc, curr) => {
                          const key = curr.pertandingan.trim().toUpperCase();
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(curr);
                          return acc;
                        }, {} as Record<string, typeof filteredList>);
                        
                        const allKeys = Object.keys(grouped).sort();

                        // Count by status
                        const countSemua = allKeys.length;
                        const countKpm = allKeys.filter(k => normalizeStatus(grouped[k][0]?.statusPertandingan) === 'KPM').length;
                        const countLuarPengiktirafan = allKeys.filter(k => normalizeStatus(grouped[k][0]?.statusPertandingan) === 'LUAR KPM (PENGIKTIRAFAN)').length;
                        const countLuarKpm = allKeys.filter(k => normalizeStatus(grouped[k][0]?.statusPertandingan) === 'LUAR KPM').length;

                        // Filter by selected status
                        const keys = modalStatusFilter === 'SEMUA'
                          ? allKeys
                          : allKeys.filter(k => normalizeStatus(grouped[k][0]?.statusPertandingan) === modalStatusFilter);

                        // If user selected a specific competition to drill down:
                        if (selectedPertandinganInModal) {
                          const students = grouped[selectedPertandinganInModal] || [];
                          const compInfo = students[0];
                          const compStatus = normalizeStatus(compInfo?.statusPertandingan);
                          const filteredStudents = students.filter(s => 
                            (s.nama || '').toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                            (s.noKp || '').includes(modalSearchTerm) ||
                            (s.aliran || '').toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                            (s.kelas || '').toLowerCase().includes(modalSearchTerm.toLowerCase())
                          );

                          return (
                            <div className="space-y-6">
                              {/* Competition Summary Banner */}
                              <div className="bg-amber-500/10 border-2 border-amber-500/20 rounded-2xl p-5 md:p-6 space-y-4">
                                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-amber-500/20 pb-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="bg-amber-500 text-slate-900 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm">
                                      Peringkat {compInfo?.peringkat}
                                    </span>
                                    <span className={`${getStatusBadgeDark(compStatus)} px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm`}>
                                      {compStatus}
                                    </span>
                                    <span className="bg-white border border-amber-500/30 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm">
                                      {selectedDashboardBahagian}
                                    </span>
                                    {formatTarikhPaparan(compInfo?.jenisTarikh, compInfo?.tarikhMula, compInfo?.tarikhTamat) && (
                                      <span className="bg-white border border-amber-500/30 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm inline-flex items-center gap-1">
                                        <Calendar className="w-3 h-3 text-amber-600" />
                                        {formatTarikhPaparan(compInfo?.jenisTarikh, compInfo?.tarikhMula, compInfo?.tarikhTamat)}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 shrink-0 self-stretch sm:self-auto">
                                    {compInfo?.suratPengiktirafanData && (
                                      <button
                                        type="button"
                                        onClick={() => setPreviewSuratModal({
                                          nama: compInfo.suratPengiktirafanNama || 'Surat Pengiktirafan KPM',
                                          data: compInfo.suratPengiktirafanData || '',
                                          pertandingan: selectedPertandinganInModal
                                        })}
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                                        title="Lihat Surat Pengiktirafan KPM"
                                      >
                                        <Eye className="w-4 h-4" />
                                        <span>Surat KPM</span>
                                      </button>
                                    )}
                                    {compInfo?.sijilMuridData && (
                                      <button
                                        type="button"
                                        onClick={() => setPreviewSuratModal({
                                          nama: compInfo.sijilMuridNama || 'Sijil Pencapaian / Penyertaan Murid',
                                          data: compInfo.sijilMuridData || '',
                                          pertandingan: selectedPertandinganInModal
                                        })}
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                                        title="Lihat Sijil Murid"
                                      >
                                        <Eye className="w-4 h-4" />
                                        <span>Sijil</span>
                                      </button>
                                    )}

                                    <button 
                                      type="button"
                                      onClick={() => copyStudentList(students)} 
                                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                                      title="Salin senarai nama murid"
                                    >
                                      {copyFeedback ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-400" />}
                                      <span>{copyFeedback ? 'Disalin!' : 'Salin Nama'}</span>
                                    </button>

                                    <button 
                                      type="button"
                                      onClick={() => handleAddMoreToThisCompetition(selectedPertandinganInModal, selectedDashboardBahagian, compInfo?.peringkat, compStatus, compInfo)}
                                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-xs font-black shadow-md transition-all cursor-pointer"
                                      title="Tambah murid baru ke pertandingan ini"
                                    >
                                      <UserPlus className="w-4 h-4" />
                                      <span>+ Tambah Murid</span>
                                    </button>
                                  </div>
                                </div>

                                <div>
                                  <h4 className="text-base sm:text-lg md:text-xl font-black text-slate-900 uppercase italic tracking-tight break-words leading-snug">
                                    {selectedPertandinganInModal}
                                  </h4>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                                    Jumlah: {students.length} orang murid berdaftar
                                  </p>
                                </div>
                              </div>

                              {/* Search in Student Roster */}
                              <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
                                <div className="relative w-full sm:w-72">
                                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                  <input 
                                    type="text" 
                                    placeholder="Cari nama atau No. KP..." 
                                    value={modalSearchTerm} 
                                    onChange={(e) => setModalSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-amber-500"
                                  />
                                </div>
                                <span className="text-xs font-bold text-slate-500 self-end sm:self-center">
                                  Menunjukkan <strong className="text-slate-800">{filteredStudents.length}</strong> daripada {students.length} orang murid
                                </span>
                              </div>

                              {/* Student Table */}
                              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-black uppercase text-[10px] tracking-wider">
                                      <th className="py-3 px-4 w-12 text-center">Bil</th>
                                      <th className="py-3 px-4">Nama Murid</th>
                                      <th className="py-3 px-4">No. KP / MyKid</th>
                                      <th className="py-3 px-4">Kelas</th>
                                      <th className="py-3 px-4">Pencapaian</th>
                                      <th className="py-3 px-4 text-right">Tindakan</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {filteredStudents.length === 0 ? (
                                      <tr>
                                        <td colSpan={6} className="py-8 text-center text-slate-400 font-bold uppercase text-xs">
                                          Tiada murid sepadan dengan carian
                                        </td>
                                      </tr>
                                    ) : (
                                      filteredStudents.map((s, idx) => (
                                        <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                                          <td className="py-3 px-4 text-center font-bold text-slate-400">{idx + 1}</td>
                                          <td className="py-3 px-4 font-black text-slate-800 uppercase">{s.nama}</td>
                                          <td className="py-3 px-4 font-semibold text-slate-500">{s.noKp || '-'}</td>
                                          <td className="py-3 px-4">
                                            <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-bold text-[10px]">
                                              {s.aliran} ({s.kelas})
                                            </span>
                                          </td>
                                          <td className="py-3 px-4">
                                            <span className={`inline-block px-2 py-0.5 rounded font-black text-[10px] uppercase tracking-wider ${
                                              s.pencapaian === 'Johan' || s.pencapaian === 'Emas' ? 'bg-amber-100 text-amber-800 font-black' :
                                              s.pencapaian === 'Naib Johan' || s.pencapaian === 'Perak' ? 'bg-slate-200 text-slate-800 font-black' :
                                              s.pencapaian === 'Ketiga' || s.pencapaian === 'Gangsa' ? 'bg-orange-100 text-orange-800 font-black' :
                                              'bg-blue-50 text-blue-700'
                                            }`}>
                                              {s.pencapaian}
                                            </span>
                                          </td>
                                          <td className="py-3 px-4 text-right">
                                            <button 
                                              onClick={() => editRekod(s.id)} 
                                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center gap-1 font-bold text-[10px] cursor-pointer"
                                              title="Kemaskini Maklumat Murid"
                                            >
                                              <Edit3 className="w-3.5 h-3.5" />
                                              <span>Edit</span>
                                            </button>
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        }

                        // Otherwise, show list of competitions in this bahagian:
                        if (allKeys.length === 0) {
                          return <div className="py-12 text-center text-slate-400 font-bold uppercase text-xs tracking-widest italic">Tiada Rekod Pertandingan</div>;
                        }
                        
                        return (
                          <div className="space-y-5">
                            {/* Filter Status Pertandingan Button Group */}
                            <div className="bg-slate-50 border border-slate-200/90 p-4 rounded-2xl space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="p-1.5 bg-amber-500/10 text-amber-600 rounded-lg">
                                    <Filter className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                                      Pilih Status Pertandingan:
                                    </span>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                      Tapis pertandingan mengikut punca pengiktirafan
                                    </p>
                                  </div>
                                </div>
                                {modalStatusFilter !== 'SEMUA' && (
                                  <button 
                                    type="button" 
                                    onClick={() => setModalStatusFilter('SEMUA')}
                                    className="self-start sm:self-auto text-[10px] font-black text-amber-700 hover:text-amber-800 uppercase tracking-wider underline cursor-pointer"
                                  >
                                    Set Semula (Papar Semua {countSemua})
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {/* Button SEMUA */}
                                <button
                                  type="button"
                                  onClick={() => setModalStatusFilter('SEMUA')}
                                  className={`px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-between transition-all cursor-pointer border ${
                                    modalStatusFilter === 'SEMUA'
                                      ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                                  }`}
                                >
                                  <span>Semua</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-black ${
                                    modalStatusFilter === 'SEMUA' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'
                                  }`}>
                                    {countSemua}
                                  </span>
                                </button>

                                {/* Button KPM */}
                                <button
                                  type="button"
                                  onClick={() => setModalStatusFilter('KPM')}
                                  className={`px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-between transition-all cursor-pointer border ${
                                    modalStatusFilter === 'KPM'
                                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                                      : 'bg-white text-emerald-800 border-slate-200 hover:bg-emerald-50 hover:border-emerald-300'
                                  }`}
                                >
                                  <span className="truncate">KPM</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-black ml-1 ${
                                    modalStatusFilter === 'KPM' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-800'
                                  }`}>
                                    {countKpm}
                                  </span>
                                </button>

                                {/* Button LUAR KPM (PENGIKTIRAFAN) */}
                                <button
                                  type="button"
                                  onClick={() => setModalStatusFilter('LUAR KPM (PENGIKTIRAFAN)')}
                                  className={`px-2.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-between transition-all cursor-pointer border ${
                                    modalStatusFilter === 'LUAR KPM (PENGIKTIRAFAN)'
                                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                                      : 'bg-white text-indigo-800 border-slate-200 hover:bg-indigo-50 hover:border-indigo-300'
                                  }`}
                                  title="LUAR KPM (PENGIKTIRAFAN)"
                                >
                                  <span className="truncate text-left text-[10px] sm:text-[11px] leading-tight">Luar (Pengiktirafan)</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-black ml-1 shrink-0 ${
                                    modalStatusFilter === 'LUAR KPM (PENGIKTIRAFAN)' ? 'bg-indigo-700 text-white' : 'bg-indigo-100 text-indigo-800'
                                  }`}>
                                    {countLuarPengiktirafan}
                                  </span>
                                </button>

                                {/* Button LUAR KPM */}
                                <button
                                  type="button"
                                  onClick={() => setModalStatusFilter('LUAR KPM')}
                                  className={`px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-between transition-all cursor-pointer border ${
                                    modalStatusFilter === 'LUAR KPM'
                                      ? 'bg-amber-600 text-white border-amber-600 shadow-md'
                                      : 'bg-white text-amber-800 border-slate-200 hover:bg-amber-50 hover:border-amber-300'
                                  }`}
                                >
                                  <span className="truncate">Luar KPM</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-black ml-1 ${
                                    modalStatusFilter === 'LUAR KPM' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'
                                  }`}>
                                    {countLuarKpm}
                                  </span>
                                </button>
                              </div>
                            </div>

                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                              {modalStatusFilter === 'SEMUA' 
                                ? 'Pilih mana-mana pertandingan di bawah untuk menyemak senarai murid:' 
                                : `Pertandingan berstatus "${modalStatusFilter}" (${keys.length} pertandingan):`}
                            </p>

                            {keys.length === 0 ? (
                              <div className="py-12 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl space-y-3">
                                <p className="text-slate-400 font-bold uppercase text-xs tracking-widest italic">
                                  Tiada pertandingan berstatus "{modalStatusFilter}" di bahagian ini.
                                </p>
                                <button 
                                  type="button" 
                                  onClick={() => setModalStatusFilter('SEMUA')}
                                  className="px-4 py-2 bg-amber-500 text-slate-900 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-amber-400 transition-colors cursor-pointer"
                                >
                                  Papar Semua Pertandingan
                                </button>
                              </div>
                            ) : (
                              keys.map((k, i) => {
                                const competitionStudents = grouped[k];
                                const firstItem = competitionStudents[0];
                                const compStatus = normalizeStatus(firstItem.statusPertandingan);
                                return (
                                  <div 
                                    key={i} 
                                    onClick={() => {
                                      setSelectedPertandinganInModal(k);
                                      setModalSearchTerm('');
                                    }}
                                    className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-5 rounded-2xl bg-slate-50 border border-slate-200 hover:border-amber-400 hover:bg-amber-50/20 hover:shadow-md cursor-pointer transition-all group gap-3"
                                  >
                                    <div>
                                      <div className="font-black text-slate-900 text-sm md:text-base group-hover:text-amber-700 transition-colors">
                                        {k}
                                      </div>
                                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1.5 flex flex-wrap items-center gap-2">
                                        <span className="bg-white border border-slate-200 px-2 py-0.5 rounded font-black text-slate-600">Peringkat {firstItem.peringkat}</span>
                                        <span className={`px-2 py-0.5 rounded font-black border ${getStatusBadgeClass(compStatus)}`}>
                                          {compStatus}
                                        </span>
                                        {formatTarikhPaparan(firstItem.jenisTarikh, firstItem.tarikhMula, firstItem.tarikhTamat) && (
                                          <span className="bg-white border border-slate-200 px-2 py-0.5 rounded font-bold text-slate-600 inline-flex items-center gap-1">
                                            <Calendar className="w-3 h-3 text-amber-500" />
                                            {formatTarikhPaparan(firstItem.jenisTarikh, firstItem.tarikhMula, firstItem.tarikhTamat)}
                                          </span>
                                        )}
                                        {firstItem.suratPengiktirafanData && (
                                          <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded font-black inline-flex items-center gap-1">
                                            <Paperclip className="w-3 h-3" />
                                            Surat KPM
                                          </span>
                                        )}
                                        {firstItem.sijilMuridData && (
                                          <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded font-black inline-flex items-center gap-1">
                                            <Paperclip className="w-3 h-3" />
                                            Sijil
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                                      <div className="bg-white border border-slate-200 px-3.5 py-2 rounded-xl flex items-center gap-2 shadow-sm">
                                        <Users className="w-4 h-4 text-amber-500" />
                                        <span className="text-xs font-black text-slate-800">{competitionStudents.length} orang murid</span>
                                      </div>
                                      <span className="flex items-center gap-1 text-xs font-black text-amber-600 group-hover:translate-x-1 transition-transform">
                                        Semak Murid <ChevronRight className="w-4 h-4" />
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ========================================================= */}
        {/* VIEW 2: KEMASUKAN DATA (INDIVIDU & PUKAL)                  */}
        {/* ========================================================= */}
        {activeView === 'kemasukan' && (
          <div className="max-w-5xl mx-auto w-full animate-in slide-in-from-bottom-6 duration-500 pb-16">
            <div className="bg-white p-5 sm:p-8 md:p-10 rounded-[32px] md:rounded-[40px] shadow-xl border border-slate-200/80 w-full max-w-full box-border overflow-hidden">
              
              {/* Header & Mode Switcher */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 pb-6 border-b border-slate-100">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-slate-800 uppercase italic">
                    {editingId ? 'Kemaskini Data Murid' : (kemasukanMode === 'pukal' ? 'Kemasukan Murid Secara Pukal (Pasukan/Ramai)' : 'Daftar Pencapaian Individu')}
                  </h2>
                  <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">
                    {editingId 
                      ? 'Sila kemaskini maklumat murid di bawah' 
                      : (kemasukanMode === 'pukal' 
                        ? 'Isi maklumat pertandingan sekali sahaja, kemudian masukkan nama ramai murid dengan pantas' 
                        : 'Isi maklumat pencapaian murid secara individu')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto shrink-0">
                  <div className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-2xl flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-500 shrink-0" />
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value)}
                      className="bg-transparent text-xs font-black text-slate-800 uppercase tracking-wider outline-none cursor-pointer"
                      title="Pilih Tahun / Sesi untuk rekod ini"
                    >
                      {availableYears.map(year => (
                        <option key={year} value={year}>Sesi {year}</option>
                      ))}
                    </select>
                  </div>

                  {!editingId && (
                    <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-1 flex-1 sm:flex-none border border-slate-200 shrink-0">
                      <button 
                        type="button"
                        onClick={() => setKemasukanMode('individu')}
                        className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                          kemasukanMode === 'individu'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        Individu (1 Murid)
                      </button>
                      <button 
                        type="button"
                        onClick={() => setKemasukanMode('pukal')}
                        className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          kemasukanMode === 'pukal'
                            ? 'bg-amber-500 text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Pukal (Ramai Murid)</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Dual-Storage Status Strip in Kemasukan View */}
              <div className={`mb-6 px-4 py-3 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                sheetConfig && hasSheetToken
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className={`w-4 h-4 shrink-0 ${sheetConfig && hasSheetToken ? 'text-emerald-600' : 'text-slate-400'}`} />
                  <span className="font-bold">
                    {sheetConfig && hasSheetToken
                      ? `Simpanan Berganda Aktif: Setiap rekod disimpan ke Firebase & Google Sheet "${sheetConfig.spreadsheetTitle}".`
                      : sheetConfig
                        ? `Google Sheet "${sheetConfig.spreadsheetTitle}" dipautkan — log masuk Google diperlukan untuk auto-simpan ke Sheet.`
                        : 'Google Sheets belum disambungkan. Sambungkan Google Sheets untuk salinan sandaran automatik.'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => (sheetConfig && !hasSheetToken ? handleGoogleSignIn() : setShowSheetModal(true))}
                  className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:border-emerald-400 text-[11px] font-black uppercase tracking-wider text-slate-800 cursor-pointer shrink-0 transition-all"
                >
                  {sheetConfig && !hasSheetToken ? 'Log Masuk Google' : sheetConfig ? 'Tetapan Sheet' : 'Sambung Google Sheets'}
                </button>
              </div>

              {/* ------------------------------------------------------------- */}
              {/* SUB-MODE A: KEMASUKAN INDIVIDU (OR EDITING SINGLE RECORD)    */}
              {/* ------------------------------------------------------------- */}
              {(kemasukanMode === 'individu' || editingId) && (
                <form onSubmit={handleFormSubmit} className="space-y-6">
                  {/* Card 1: Maklumat Murid */}
                  <div className="bg-slate-50/80 border border-slate-200/80 p-5 sm:p-7 rounded-2xl sm:rounded-3xl space-y-5">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/60">
                      <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-black text-slate-800 uppercase italic text-sm">1. Maklumat Murid</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nama, No. KP dan Kelas</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">Nama Penuh Murid *</label>
                        <input 
                          required 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-black text-xs outline-none focus:border-amber-500" 
                          value={formData.nama} 
                          onChange={(e) => updateFormData('nama', e.target.value.toUpperCase())} 
                          placeholder="NAMA PENUH SEPERTI DALAM MYKID" 
                        />
                      </div>
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">No. KP / MyKid (Tanpa '-')</label>
                        <input 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500" 
                          value={formData.noKp} 
                          onChange={(e) => updateFormData('noKp', e.target.value.replace(/\D/g, ''))} 
                          placeholder="CONTOH: 120101101234" 
                          maxLength={12} 
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">Aliran</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500" 
                          value={formData.aliran} 
                          onChange={(e) => updateFormData('aliran', e.target.value)}
                        >
                          {senaraiAliran.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">Kelas</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500" 
                          value={formData.kelas} 
                          onChange={(e) => updateFormData('kelas', e.target.value)}
                        >
                          {senaraiKelas.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Maklumat Aktiviti & Pencapaian */}
                  <div className="bg-slate-50/80 border border-slate-200/80 p-5 sm:p-7 rounded-2xl sm:rounded-3xl space-y-5">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/60">
                      <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
                        <Trophy className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-black text-slate-800 uppercase italic text-sm">2. Maklumat Aktiviti & Pencapaian</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Aktiviti, Bahagian, Peringkat dan Pencapaian</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">Bahagian</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500" 
                          value={formData.bahagian} 
                          onChange={(e) => updateFormData('bahagian', e.target.value)}
                        >
                          {senaraiBahagian.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">Nama Aktiviti / Pertandingan *</label>
                        <input 
                          required 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-black text-xs outline-none focus:border-amber-500" 
                          value={formData.pertandingan} 
                          onChange={(e) => updateFormData('pertandingan', e.target.value.toUpperCase())} 
                          placeholder="CONTOH: KEJOHANAN BOLA SEPAK MSSD" 
                        />
                      </div>

                      {/* Tarikh Aktiviti / Pertandingan (Satu Hari atau Tempoh Masa) */}
                      <div className="md:col-span-2 bg-white border-2 border-slate-200/90 rounded-2xl p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-[10px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-amber-500" />
                            <span>Tarikh Aktiviti / Pertandingan</span>
                          </label>
                          <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-auto">
                            <button
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, jenisTarikh: 'satu_hari', tarikhTamat: '' }))}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                formData.jenisTarikh === 'satu_hari'
                                  ? 'bg-amber-500 text-slate-900 shadow-xs'
                                  : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              Satu Hari
                            </button>
                            <button
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, jenisTarikh: 'tempoh' }))}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                formData.jenisTarikh === 'tempoh'
                                  ? 'bg-amber-500 text-slate-900 shadow-xs'
                                  : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              Tempoh Masa
                            </button>
                          </div>
                        </div>

                        {formData.jenisTarikh === 'satu_hari' ? (
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pilih Tarikh Aktiviti</span>
                            <input
                              type="date"
                              value={formData.tarikhMula}
                              onChange={(e) => setFormData(prev => ({ ...prev, tarikhMula: e.target.value, tarikhTamat: '' }))}
                              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                            />
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tarikh Mula</span>
                              <input
                                type="date"
                                value={formData.tarikhMula}
                                onChange={(e) => setFormData(prev => ({ ...prev, tarikhMula: e.target.value }))}
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tarikh Tamat</span>
                              <input
                                type="date"
                                min={formData.tarikhMula || undefined}
                                value={formData.tarikhTamat}
                                onChange={(e) => setFormData(prev => ({ ...prev, tarikhTamat: e.target.value }))}
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">Status Pertandingan</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500" 
                          value={formData.statusPertandingan} 
                          onChange={(e) => updateFormData('statusPertandingan', e.target.value)}
                        >
                          {senaraiStatusPertandingan.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">Peringkat</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500" 
                          value={formData.peringkat} 
                          onChange={(e) => updateFormData('peringkat', e.target.value)}
                        >
                          {senaraiPeringkat.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>

                      {/* Lampiran 1: Surat Pengiktirafan KPM */}
                      {(normalizeStatus(formData.statusPertandingan) === 'LUAR KPM (PENGIKTIRAFAN)' || Boolean(formData.suratPengiktirafanData)) && (
                        <div className="md:col-span-2 bg-indigo-50/80 border-2 border-indigo-200 rounded-2xl p-4 sm:p-5 space-y-3 animate-in fade-in duration-200">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5">
                              <div className="p-2 bg-indigo-600 text-white rounded-xl shrink-0">
                                <Paperclip className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                                  Lampiran Surat Pengiktirafan Daripada KPM
                                </h4>
                                <p className="text-[11px] font-medium text-indigo-700 mt-0.5">
                                  Guru atau ibu bapa boleh memuat naik salinan surat pengiktirafan KPM (Gambar JPG/PNG atau PDF maks 350KB). Fail disimpan dalam Firebase & Google Sheets.
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-wrap">
                            <label className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs ${
                              attachmentBusy
                                ? 'bg-indigo-300 text-white pointer-events-none'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}>
                              {attachmentBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                              <span>{formData.suratPengiktirafanData ? 'Tukar Surat Pengiktirafan' : 'Muat Naik Surat Pengiktirafan'}</span>
                              <input
                                type="file"
                                accept="image/*,.pdf,application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  handleAttachmentUpload(file, 'individu');
                                  e.currentTarget.value = '';
                                }}
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() => setPreviewSuratModal({
                                nama: 'Contoh Surat Pengiktirafan KPM (BSKK).jpg',
                                data: CONTOH_SURAT_KPM_URL,
                                pertandingan: 'Rujukan Format Surat Pengiktirafan KPM'
                              })}
                              className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white hover:bg-amber-50 border border-indigo-200 hover:border-amber-400 text-left transition-all cursor-pointer shadow-xs group"
                              title="Klik untuk besarkan contoh surat pengiktirafan KPM"
                            >
                              <img
                                src={CONTOH_SURAT_KPM_URL}
                                alt="Contoh Surat Pengiktirafan KPM"
                                className="w-8 h-10 object-cover rounded-md border border-slate-200 shrink-0 group-hover:scale-105 transition-transform"
                              />
                              <div className="leading-tight">
                                <span className="block text-[10px] font-black text-indigo-950 uppercase tracking-wider">
                                  Contoh Surat KPM
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 group-hover:text-amber-700 mt-0.5">
                                  <Eye className="w-3 h-3" />
                                  <span>Klik untuk lihat rujukan</span>
                                </span>
                              </div>
                            </button>

                            {formData.suratPengiktirafanData && (
                              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px] bg-white border border-indigo-200 px-3 py-2 rounded-xl">
                                <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span className="text-xs font-bold text-slate-700 truncate max-w-[200px]" title={formData.suratPengiktirafanNama}>
                                  {formData.suratPengiktirafanNama || 'Surat Pengiktirafan KPM'}
                                </span>
                                <div className="flex items-center gap-1.5 ml-auto">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewSuratModal({
                                      nama: formData.suratPengiktirafanNama || 'Surat Pengiktirafan KPM',
                                      data: formData.suratPengiktirafanData,
                                      pertandingan: formData.pertandingan,
                                      murid: formData.nama
                                    })}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>Lihat</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, suratPengiktirafanNama: '', suratPengiktirafanData: '' }))}
                                    className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                                  >
                                    Buang
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Lampiran 2: Sijil Pencapaian / Sijil Penyertaan Murid */}
                      {(normalizeStatus(formData.statusPertandingan) !== 'KPM' || Boolean(formData.sijilMuridData)) && (
                        <div className="md:col-span-2 bg-emerald-50/80 border-2 border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-3 animate-in fade-in duration-200">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5">
                              <div className="p-2 bg-emerald-600 text-white rounded-xl shrink-0">
                                <FileCheck2 className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="text-xs font-black text-emerald-950 uppercase tracking-wider">
                                  Lampiran Sijil Pencapaian / Sijil Penyertaan Murid
                                </h4>
                                <p className="text-[11px] font-medium text-emerald-800 mt-0.5">
                                  Salinan sijil murid (kiriman ibu bapa atau muat naik guru maks 350KB). Disimpan berasingan daripada surat pengiktirafan.
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-wrap">
                            <label className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs ${
                              attachmentBusy
                                ? 'bg-emerald-300 text-white pointer-events-none'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            }`}>
                              {attachmentBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                              <span>{formData.sijilMuridData ? 'Tukar Sijil Murid' : 'Muat Naik Sijil Murid'}</span>
                              <input
                                type="file"
                                accept="image/*,.pdf,application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  handleAttachmentUpload(file, 'individu_sijil');
                                  e.currentTarget.value = '';
                                }}
                              />
                            </label>

                            {formData.sijilMuridData && (
                              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px] bg-white border border-emerald-200 px-3 py-2 rounded-xl">
                                <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span className="text-xs font-bold text-slate-700 truncate max-w-[200px]" title={formData.sijilMuridNama}>
                                  {formData.sijilMuridNama || 'Sijil Pencapaian / Penyertaan Murid'}
                                </span>
                                <div className="flex items-center gap-1.5 ml-auto">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewSuratModal({
                                      nama: formData.sijilMuridNama || 'Sijil Pencapaian / Penyertaan Murid',
                                      data: formData.sijilMuridData,
                                      pertandingan: formData.pertandingan,
                                      murid: formData.nama
                                    })}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>Lihat</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, sijilMuridNama: '', sijilMuridData: '' }))}
                                    className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                                  >
                                    Buang
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider ml-0.5">Pencapaian</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500" 
                          value={formData.pencapaian} 
                          onChange={(e) => updateFormData('pencapaian', e.target.value)}
                        >
                          {senaraiPencapaian.map(pen => <option key={pen} value={pen}>{pen}</option>)}
                        </select>
                      </div>

                      {/* Guru Pengiring / Guru Pembimbing / Jurulatih (Khusus Pengisian Guru Sahaja) */}
                      <div className="md:col-span-2 bg-white border-2 border-slate-200/90 rounded-2xl p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <label className="text-[10px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                              <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                              <span>Nama Guru Pengiring / Guru Pembimbing / Jurulatih</span>
                            </label>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                              Khusus pengisian guru sahaja • Klik "+ Tambah Guru" jika lebih daripada seorang guru terlibat
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setFormData(prev => ({
                              ...prev,
                              guruPengiring: [...(prev.guruPengiring || ['']), '']
                            }))}
                            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-[10px] font-black uppercase tracking-wider shadow-xs transition-all cursor-pointer shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Tambah Guru</span>
                          </button>
                        </div>

                        <div className="space-y-2.5">
                          {(formData.guruPengiring && formData.guruPengiring.length > 0 ? formData.guruPengiring : ['']).map((guruName, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="px-2.5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-600 uppercase tracking-wider shrink-0">
                                Guru {idx + 1}
                              </span>
                              <input
                                type="text"
                                className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                                value={guruName}
                                onChange={(e) => {
                                  const val = e.target.value.toUpperCase();
                                  setFormData(prev => {
                                    const next = [...(prev.guruPengiring || [''])];
                                    next[idx] = val;
                                    return { ...prev, guruPengiring: next };
                                  });
                                }}
                                placeholder={`CONTOH: CIKGU AHMAD BIN ALI (${idx + 1})`}
                              />
                              {(formData.guruPengiring?.length || 1) > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setFormData(prev => {
                                    const filtered = (prev.guruPengiring || []).filter((_, i) => i !== idx);
                                    return { ...prev, guruPengiring: filtered.length > 0 ? filtered : [''] };
                                  })}
                                  className="p-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-colors cursor-pointer shrink-0"
                                  title="Buang nama guru ini"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex gap-4">
                    {editingId && (
                      <button 
                        type="button" 
                        onClick={() => {
                          setEditingId(null);
                          resetFormData();
                          switchView('senarai');
                        }}
                        className="px-6 py-4 bg-slate-100 text-slate-700 font-black rounded-2xl uppercase tracking-widest text-xs hover:bg-slate-200 transition-all cursor-pointer"
                      >
                        Batal
                      </button>
                    )}
                    <button 
                      type="submit" 
                      disabled={saving} 
                      className="flex-1 p-4 bg-amber-500 text-slate-900 font-black rounded-2xl uppercase tracking-widest text-xs hover:bg-amber-400 shadow-xl shadow-amber-500/10 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="animate-spin w-4 h-4" />
                          <span>Menyimpan ke Awan...</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>{editingId ? 'Simpan Kemaskini' : 'Daftar Murid'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* ------------------------------------------------------------- */}
              {/* SUB-MODE B: KEMASUKAN PUKAL (BULK STUDENT ENTRY)              */}
              {/* ------------------------------------------------------------- */}
              {!editingId && kemasukanMode === 'pukal' && (
                <form onSubmit={handleBulkSubmit} className="space-y-6">
                  {/* Step 1: Maklumat Pertandingan (Diisi Sekali) */}
                  <div className="bg-amber-500/10 border-2 border-amber-500/20 rounded-2xl sm:rounded-3xl p-5 sm:p-7 space-y-5 w-full box-border">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-amber-500/20">
                      <div className="bg-amber-500 p-2 rounded-xl text-slate-900 font-black text-xs">1</div>
                      <div>
                        <h3 className="font-black text-slate-800 uppercase italic text-sm">Maklumat Pertandingan (Diisi Sekali)</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Semua murid di bawah akan didaftarkan ke dalam pertandingan ini</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider ml-0.5">Nama Aktiviti / Pertandingan *</label>
                        <input 
                          required 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-black text-xs outline-none focus:border-amber-500 shadow-sm"
                          value={bulkHeader.pertandingan}
                          onChange={(e) => setBulkHeader(prev => ({ ...prev, pertandingan: e.target.value.toUpperCase() }))}
                          placeholder="CONTOH: KEJOHANAN BOLA JARING PERINGKAT DAERAH"
                        />
                      </div>

                      {/* Tarikh Aktiviti / Pertandingan (Pukal) */}
                      <div className="md:col-span-2 bg-white border-2 border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-amber-500" />
                            <span>Tarikh Aktiviti / Pertandingan</span>
                          </label>
                          <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-auto">
                            <button
                              type="button"
                              onClick={() => setBulkHeader(prev => ({ ...prev, jenisTarikh: 'satu_hari', tarikhTamat: '' }))}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                bulkHeader.jenisTarikh === 'satu_hari'
                                  ? 'bg-amber-500 text-slate-900 shadow-xs'
                                  : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              Satu Hari
                            </button>
                            <button
                              type="button"
                              onClick={() => setBulkHeader(prev => ({ ...prev, jenisTarikh: 'tempoh' }))}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                bulkHeader.jenisTarikh === 'tempoh'
                                  ? 'bg-amber-500 text-slate-900 shadow-xs'
                                  : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              Tempoh Masa
                            </button>
                          </div>
                        </div>

                        {bulkHeader.jenisTarikh === 'satu_hari' ? (
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pilih Tarikh Aktiviti</span>
                            <input
                              type="date"
                              value={bulkHeader.tarikhMula}
                              onChange={(e) => setBulkHeader(prev => ({ ...prev, tarikhMula: e.target.value, tarikhTamat: '' }))}
                              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                            />
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tarikh Mula</span>
                              <input
                                type="date"
                                value={bulkHeader.tarikhMula}
                                onChange={(e) => setBulkHeader(prev => ({ ...prev, tarikhMula: e.target.value }))}
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tarikh Tamat</span>
                              <input
                                type="date"
                                min={bulkHeader.tarikhMula || undefined}
                                value={bulkHeader.tarikhTamat}
                                onChange={(e) => setBulkHeader(prev => ({ ...prev, tarikhTamat: e.target.value }))}
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider ml-0.5">Bahagian</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer shadow-sm focus:border-amber-500"
                          value={bulkHeader.bahagian}
                          onChange={(e) => setBulkHeader(prev => ({ ...prev, bahagian: e.target.value }))}
                        >
                          {senaraiBahagian.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider ml-0.5">Status Pertandingan</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer shadow-sm focus:border-amber-500"
                          value={bulkHeader.statusPertandingan}
                          onChange={(e) => setBulkHeader(prev => ({ ...prev, statusPertandingan: e.target.value }))}
                        >
                          {senaraiStatusPertandingan.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      {/* Lampiran Surat Pengiktirafan KPM (Pukal) */}
                      {normalizeStatus(bulkHeader.statusPertandingan) === 'LUAR KPM (PENGIKTIRAFAN)' && (
                        <div className="md:col-span-2 bg-indigo-50/90 border-2 border-indigo-200 rounded-2xl p-4 sm:p-5 space-y-3 animate-in fade-in duration-200">
                          <div className="flex items-start gap-2.5">
                            <div className="p-2 bg-indigo-600 text-white rounded-xl shrink-0">
                              <Paperclip className="w-4 h-4" />
                            </div>
                            <div>
                              <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                                Lampiran Surat Pengiktirafan Daripada KPM
                              </h4>
                              <p className="text-[11px] font-medium text-indigo-700 mt-0.5">
                                Muat naik salinan surat pengiktirafan KPM sekali untuk semua murid di bawah (Gambar JPG/PNG atau PDF maks 350KB). Disimpan dalam Firebase & Google Sheets.
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-wrap">
                            <label className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs ${
                              attachmentBusy
                                ? 'bg-indigo-300 text-white pointer-events-none'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}>
                              {attachmentBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                              <span>{bulkHeader.suratPengiktirafanData ? 'Tukar Surat Pengiktirafan' : 'Muat Naik Surat Pengiktirafan'}</span>
                              <input
                                type="file"
                                accept="image/*,.pdf,application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  handleAttachmentUpload(file, 'pukal');
                                  e.currentTarget.value = '';
                                }}
                              />
                            </label>

                            {/* Contoh Surat Pengiktirafan KPM (Rujukan guru & ibu bapa di sebelah butang muat naik) */}
                            <button
                              type="button"
                              onClick={() => setPreviewSuratModal({
                                nama: 'Contoh Surat Pengiktirafan KPM (BSKK).jpg',
                                data: CONTOH_SURAT_KPM_URL,
                                pertandingan: 'Rujukan Format Surat Pengiktirafan KPM'
                              })}
                              className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white hover:bg-amber-50 border border-indigo-200 hover:border-amber-400 text-left transition-all cursor-pointer shadow-xs group"
                              title="Klik untuk besarkan contoh surat pengiktirafan KPM"
                            >
                              <img
                                src={CONTOH_SURAT_KPM_URL}
                                alt="Contoh Surat Pengiktirafan KPM"
                                className="w-8 h-10 object-cover rounded-md border border-slate-200 shrink-0 group-hover:scale-105 transition-transform"
                              />
                              <div className="leading-tight">
                                <span className="block text-[10px] font-black text-indigo-950 uppercase tracking-wider">
                                  Contoh Surat KPM
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 group-hover:text-amber-700 mt-0.5">
                                  <Eye className="w-3 h-3" />
                                  <span>Klik untuk lihat rujukan</span>
                                </span>
                              </div>
                            </button>

                            {bulkHeader.suratPengiktirafanData && (
                              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px] bg-white border border-indigo-200 px-3 py-2 rounded-xl">
                                <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span className="text-xs font-bold text-slate-700 truncate max-w-[200px]" title={bulkHeader.suratPengiktirafanNama}>
                                  {bulkHeader.suratPengiktirafanNama || 'Surat Pengiktirafan KPM'}
                                </span>
                                <div className="flex items-center gap-1.5 ml-auto">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewSuratModal({
                                      nama: bulkHeader.suratPengiktirafanNama || 'Surat Pengiktirafan KPM',
                                      data: bulkHeader.suratPengiktirafanData,
                                      pertandingan: bulkHeader.pertandingan
                                    })}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>Lihat</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setBulkHeader(prev => ({ ...prev, suratPengiktirafanNama: '', suratPengiktirafanData: '' }))}
                                    className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                                  >
                                    Buang
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider ml-0.5">Peringkat</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer shadow-sm focus:border-amber-500"
                          value={bulkHeader.peringkat}
                          onChange={(e) => setBulkHeader(prev => ({ ...prev, peringkat: e.target.value }))}
                        >
                          {senaraiPeringkat.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider ml-0.5">Pencapaian Lalai (Default)</label>
                        <select 
                          className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer shadow-sm focus:border-amber-500"
                          value={bulkHeader.defaultPencapaian}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBulkHeader(prev => ({ ...prev, defaultPencapaian: val }));
                            applyDefaultToAllRows('pencapaian', val);
                          }}
                        >
                          {senaraiPencapaian.map(pen => <option key={pen} value={pen}>{pen}</option>)}
                        </select>
                      </div>

                      {/* Guru Pengiring / Guru Pembimbing / Jurulatih (Pukal - Khusus Pengisian Guru Sahaja) */}
                      <div className="md:col-span-2 bg-white border-2 border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                              <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                              <span>Nama Guru Pengiring / Guru Pembimbing / Jurulatih</span>
                            </label>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                              Khusus pengisian guru sahaja • Semua murid di bawah akan berkongsi senarai guru terlibat ini
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setBulkHeader(prev => ({
                              ...prev,
                              guruPengiring: [...(prev.guruPengiring || ['']), '']
                            }))}
                            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-[10px] font-black uppercase tracking-wider shadow-xs transition-all cursor-pointer shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Tambah Guru</span>
                          </button>
                        </div>

                        <div className="space-y-2.5">
                          {(bulkHeader.guruPengiring && bulkHeader.guruPengiring.length > 0 ? bulkHeader.guruPengiring : ['']).map((guruName, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="px-2.5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-600 uppercase tracking-wider shrink-0">
                                Guru {idx + 1}
                              </span>
                              <input
                                type="text"
                                className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                                value={guruName}
                                onChange={(e) => {
                                  const val = e.target.value.toUpperCase();
                                  setBulkHeader(prev => {
                                    const next = [...(prev.guruPengiring || [''])];
                                    next[idx] = val;
                                    return { ...prev, guruPengiring: next };
                                  });
                                }}
                                placeholder={`CONTOH: CIKGU AHMAD BIN ALI (${idx + 1})`}
                              />
                              {(bulkHeader.guruPengiring?.length || 1) > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setBulkHeader(prev => {
                                    const filtered = (prev.guruPengiring || []).filter((_, i) => i !== idx);
                                    return { ...prev, guruPengiring: filtered.length > 0 ? filtered : [''] };
                                  })}
                                  className="p-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-colors cursor-pointer shrink-0"
                                  title="Buang nama guru ini"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Senarai Nama Murid */}
                  <div className="space-y-4 w-full box-border">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="bg-amber-500 p-2 rounded-xl text-slate-900 font-black text-xs">2</div>
                        <div>
                          <h3 className="font-black text-slate-800 uppercase italic text-sm">Senarai Nama Murid ({bulkRows.length} Baris)</h3>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Masukkan nama murid satu persatu atau gunakan Tampal Pantas</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                        <button 
                          type="button"
                          onClick={() => setShowPasteModal(true)}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer"
                        >
                          <ClipboardList className="w-3.5 h-3.5 text-amber-400" />
                          <span>Tampal Pantas</span>
                        </button>

                        <button 
                          type="button"
                          onClick={addBulkRow}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Tambah Baris</span>
                        </button>
                      </div>
                    </div>

                    {/* Quick Apply Default Bar */}
                    <div className="bg-slate-50 p-3 sm:p-4 rounded-2xl border border-slate-200/80 flex flex-wrap items-center gap-3 text-xs w-full box-border">
                      <span className="font-black text-slate-500 text-[10px] uppercase tracking-wider">Tetapkan Serentak:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Aliran:</span>
                        <select 
                          className="bg-white border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold cursor-pointer outline-none focus:border-amber-500"
                          value={bulkHeader.defaultAliran}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBulkHeader(prev => ({ ...prev, defaultAliran: val }));
                            applyDefaultToAllRows('aliran', val);
                          }}
                        >
                          {senaraiAliran.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Kelas:</span>
                        <select 
                          className="bg-white border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold cursor-pointer outline-none focus:border-amber-500"
                          value={bulkHeader.defaultKelas}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBulkHeader(prev => ({ ...prev, defaultKelas: val }));
                            applyDefaultToAllRows('kelas', val);
                          }}
                        >
                          {senaraiKelas.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Pencapaian:</span>
                        <select 
                          className="bg-white border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold cursor-pointer outline-none focus:border-amber-500"
                          value={bulkHeader.defaultPencapaian}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBulkHeader(prev => ({ ...prev, defaultPencapaian: val }));
                            applyDefaultToAllRows('pencapaian', val);
                          }}
                        >
                          {senaraiPencapaian.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Table of Bulk Rows */}
                    <div className="border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm bg-white w-full max-w-full box-border">
                      <div className="overflow-x-auto w-full max-w-full">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-black uppercase text-[10px] tracking-wider whitespace-nowrap">
                              <th className="py-3 px-3 w-10 text-center">Bil</th>
                              <th className="py-3 px-3 min-w-[200px]">Nama Penuh Murid *</th>
                              <th className="py-3 px-3 min-w-[130px]">No. KP / MyKid</th>
                              <th className="py-3 px-3 min-w-[100px]">Aliran</th>
                              <th className="py-3 px-3 min-w-[95px]">Kelas</th>
                              <th className="py-3 px-3 min-w-[120px]">Pencapaian</th>
                              <th className="py-3 px-3 w-12 text-center">Hapus</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {bulkRows.map((row, index) => (
                              <tr key={row.id} className="hover:bg-slate-50/50">
                                <td className="py-2 px-3 text-center font-bold text-slate-400">{index + 1}</td>
                                <td className="py-2 px-3">
                                  <input 
                                    type="text" 
                                    className="w-full min-w-0 box-border px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold uppercase text-slate-900 focus:bg-white focus:border-amber-500 outline-none text-xs"
                                    placeholder="NAMA PENUH MURID"
                                    value={row.nama}
                                    onChange={(e) => updateBulkRow(row.id, 'nama', e.target.value.toUpperCase())}
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <input 
                                    type="text" 
                                    maxLength={12}
                                    className="w-full min-w-0 box-border px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:bg-white focus:border-amber-500 outline-none text-xs"
                                    placeholder="120101101234"
                                    value={row.noKp}
                                    onChange={(e) => updateBulkRow(row.id, 'noKp', e.target.value.replace(/\D/g, ''))}
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <select 
                                    className="w-full min-w-0 box-border px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 cursor-pointer outline-none focus:border-amber-500 text-xs"
                                    value={row.aliran}
                                    onChange={(e) => updateBulkRow(row.id, 'aliran', e.target.value)}
                                  >
                                    {senaraiAliran.map(a => <option key={a} value={a}>{a}</option>)}
                                  </select>
                                </td>
                                <td className="py-2 px-3">
                                  <select 
                                    className="w-full min-w-0 box-border px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 cursor-pointer outline-none focus:border-amber-500 text-xs"
                                    value={row.kelas}
                                    onChange={(e) => updateBulkRow(row.id, 'kelas', e.target.value)}
                                  >
                                    {senaraiKelas.map(k => <option key={k} value={k}>{k}</option>)}
                                  </select>
                                </td>
                                <td className="py-2 px-3">
                                  <select 
                                    className="w-full min-w-0 box-border px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 cursor-pointer outline-none focus:border-amber-500 text-xs"
                                    value={row.pencapaian}
                                    onChange={(e) => updateBulkRow(row.id, 'pencapaian', e.target.value)}
                                  >
                                    {senaraiPencapaian.map(p => <option key={p} value={p}>{p}</option>)}
                                  </select>
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <button 
                                    type="button" 
                                    onClick={() => removeBulkRow(row.id)}
                                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                    title="Padam baris ini"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-center gap-2 pt-1">
                      <button 
                        type="button" 
                        onClick={addBulkRow}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 text-xs font-black text-amber-700 hover:text-amber-800 px-4 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer border border-amber-200"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Tambah Baris Murid</span>
                      </button>

                      <div className="text-xs font-bold text-slate-500">
                        {bulkRows.filter(r => r.nama.trim().length > 0).length} nama sedia disimpan
                      </div>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="pt-4 border-t border-slate-100">
                    <button 
                      type="submit" 
                      disabled={saving || bulkRows.filter(r => r.nama.trim().length > 0).length === 0} 
                      className="w-full p-4 bg-amber-500 text-slate-900 font-black rounded-2xl uppercase tracking-widest text-xs hover:bg-amber-400 shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="animate-spin w-4 h-4" />
                          <span>
                            {savingProgress 
                              ? `Menyimpan ${savingProgress.current} / ${savingProgress.total} Murid ke Awan...` 
                              : 'Menyimpan Semua Rekod...'}
                          </span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>Simpan Semua ({bulkRows.filter(r => r.nama.trim().length > 0).length}) Murid ke Awan</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* Paste Modal */}
              {showPasteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                  <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl p-6 md:p-8 space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <div>
                        <h4 className="font-black text-slate-800 uppercase italic text-base">Tampal Senarai Pantas</h4>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Satu baris untuk setiap nama murid</p>
                      </div>
                      <button 
                        onClick={() => setShowPasteModal(false)}
                        className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Anda boleh salin (copy) senarai nama daripada <strong>WhatsApp</strong>, <strong>Excel</strong>, atau <strong>Word</strong> dan tampal (paste) di kotak bawah:
                      </p>
                      <textarea 
                        rows={8}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder={`Contoh:\n1. MUHAMMAD ALI BIN AHMAD\n2. NUR FATIMAH BINTI ISMAIL\n3. SITI AISYAH BINTI ZAINAL`}
                        className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl text-xs font-mono outline-none focus:bg-white focus:border-amber-500"
                      />
                    </div>

                    <div className="flex gap-3 justify-end pt-2">
                      <button 
                        type="button"
                        onClick={() => setShowPasteModal(false)}
                        className="px-5 py-3 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        Batal
                      </button>
                      <button 
                        type="button"
                        onClick={handleProcessPaste}
                        className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-xs font-black uppercase tracking-wider shadow-md cursor-pointer flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Masukkan ke Jadual</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 3: SENARAI REKOD MURID                               */}
        {/* ========================================================= */}
        {activeView === 'senarai' && (
          <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 pb-16">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-3xl font-black text-slate-800 uppercase italic">Rekod Murid</h2>
                <p className="text-slate-500 font-bold text-xs tracking-widest uppercase">
                  Jumlah Paparan: {filteredData.length} Daripada {rekodPajsk.filter(r => r.tahunKalendar === selectedYear).length} Rekod (Tahun {selectedYear})
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
                {sheetConfig && hasSheetToken ? (
                  <>
                    <button
                      type="button"
                      onClick={() => loadFromGoogleSheets()}
                      disabled={sheetBusy}
                      className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 px-3.5 py-2.5 rounded-2xl shadow-xs flex items-center gap-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-60"
                      title="Baca & paparkan data murid terus daripada Google Sheets"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${sheetBusy ? 'animate-spin' : ''}`} />
                      <span>Muat dari Sheet</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRequestSyncAllToSheet}
                      disabled={sheetBusy}
                      className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-3.5 py-2.5 rounded-2xl shadow-xs flex items-center gap-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-60"
                      title="Segerakkan rekod Firebase sedia ada yang belum wujud ke Google Sheets"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Segerak ke Sheet</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSheetModal(true)}
                    className="bg-white hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 text-slate-700 px-3.5 py-2.5 rounded-2xl shadow-xs flex items-center gap-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{sheetConfig ? 'Log Masuk Google Sheets' : 'Sambung Google Sheets'}</span>
                  </button>
                )}

                <div className="bg-white border border-slate-200 px-3 py-2 rounded-2xl shadow-sm flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="bg-transparent text-xs font-black text-slate-800 uppercase tracking-wider outline-none cursor-pointer"
                    title="Pilih Sesi / Tahun"
                  >
                    {availableYears.map(year => (
                      <option key={year} value={year}>Sesi {year}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Counter Cards: Bilangan Penyertaan Mengikut Peringkat & Keseluruhan */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Kad 1: Jumlah Penyertaan */}
              <button
                type="button"
                onClick={() => setFilterPeringkat('SEMUA')}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden group ${
                  filterPeringkat === 'SEMUA'
                    ? 'bg-amber-500 text-white border-amber-600 shadow-sm shadow-amber-500/20 ring-2 ring-amber-400'
                    : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-xs'
                }`}
                title="Papar semua peringkat"
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${filterPeringkat === 'SEMUA' ? 'text-amber-100' : 'text-slate-500'}`}>
                    Semua Penyertaan
                  </span>
                  <Award className={`w-4 h-4 shrink-0 ${filterPeringkat === 'SEMUA' ? 'text-amber-200' : 'text-amber-500'}`} />
                </div>
                <div className="text-2xl font-black tracking-tight">
                  {statsPeringkat.totalPenyertaan}
                </div>
                <div className={`text-[10px] font-bold mt-1 truncate ${filterPeringkat === 'SEMUA' ? 'text-amber-100' : 'text-slate-400'}`}>
                  {statsPeringkat.totalTahunSemasa} rekod sesi
                </div>
              </button>

              {/* Kad 2: Peringkat Daerah */}
              <button
                type="button"
                onClick={() => setFilterPeringkat(filterPeringkat === 'Daerah' ? 'SEMUA' : 'Daerah')}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden group ${
                  filterPeringkat === 'Daerah'
                    ? 'bg-teal-600 text-white border-teal-700 shadow-sm shadow-teal-600/20 ring-2 ring-teal-400'
                    : 'bg-white hover:bg-teal-50/50 text-slate-800 border-slate-200 shadow-xs'
                }`}
                title="Klik untuk tapis Peringkat Daerah"
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${filterPeringkat === 'Daerah' ? 'text-teal-100' : 'text-teal-700'}`}>
                    Daerah
                  </span>
                  <span className={`w-2 h-2 rounded-full ${filterPeringkat === 'Daerah' ? 'bg-white animate-pulse' : 'bg-teal-500'}`} />
                </div>
                <div className="text-2xl font-black tracking-tight">
                  {statsPeringkat.countDaerah}
                </div>
                <div className={`text-[10px] font-bold mt-1 truncate ${filterPeringkat === 'Daerah' ? 'text-teal-100' : 'text-slate-400'}`}>
                  {filterPeringkat === 'Daerah' ? '✓ Sedang Ditapis' : 'Klik untuk tapis'}
                </div>
              </button>

              {/* Kad 3: Peringkat Negeri */}
              <button
                type="button"
                onClick={() => setFilterPeringkat(filterPeringkat === 'Negeri' ? 'SEMUA' : 'Negeri')}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden group ${
                  filterPeringkat === 'Negeri'
                    ? 'bg-blue-600 text-white border-blue-700 shadow-sm shadow-blue-600/20 ring-2 ring-blue-400'
                    : 'bg-white hover:bg-blue-50/50 text-slate-800 border-slate-200 shadow-xs'
                }`}
                title="Klik untuk tapis Peringkat Negeri"
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${filterPeringkat === 'Negeri' ? 'text-blue-100' : 'text-blue-700'}`}>
                    Negeri
                  </span>
                  <span className={`w-2 h-2 rounded-full ${filterPeringkat === 'Negeri' ? 'bg-white animate-pulse' : 'bg-blue-500'}`} />
                </div>
                <div className="text-2xl font-black tracking-tight">
                  {statsPeringkat.countNegeri}
                </div>
                <div className={`text-[10px] font-bold mt-1 truncate ${filterPeringkat === 'Negeri' ? 'text-blue-100' : 'text-slate-400'}`}>
                  {filterPeringkat === 'Negeri' ? '✓ Sedang Ditapis' : 'Klik untuk tapis'}
                </div>
              </button>

              {/* Kad 4: Peringkat Kebangsaan */}
              <button
                type="button"
                onClick={() => setFilterPeringkat(filterPeringkat === 'Kebangsaan' ? 'SEMUA' : 'Kebangsaan')}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden group ${
                  filterPeringkat === 'Kebangsaan'
                    ? 'bg-amber-600 text-white border-amber-700 shadow-sm shadow-amber-600/20 ring-2 ring-amber-400'
                    : 'bg-white hover:bg-amber-50/50 text-slate-800 border-slate-200 shadow-xs'
                }`}
                title="Klik untuk tapis Peringkat Kebangsaan"
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${filterPeringkat === 'Kebangsaan' ? 'text-amber-100' : 'text-amber-700'}`}>
                    Kebangsaan
                  </span>
                  <span className={`w-2 h-2 rounded-full ${filterPeringkat === 'Kebangsaan' ? 'bg-white animate-pulse' : 'bg-amber-500'}`} />
                </div>
                <div className="text-2xl font-black tracking-tight">
                  {statsPeringkat.countKebangsaan}
                </div>
                <div className={`text-[10px] font-bold mt-1 truncate ${filterPeringkat === 'Kebangsaan' ? 'text-amber-100' : 'text-slate-400'}`}>
                  {filterPeringkat === 'Kebangsaan' ? '✓ Sedang Ditapis' : 'Klik untuk tapis'}
                </div>
              </button>

              {/* Kad 5: Peringkat Antarabangsa */}
              <button
                type="button"
                onClick={() => setFilterPeringkat(filterPeringkat === 'Antarabangsa' ? 'SEMUA' : 'Antarabangsa')}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden group ${
                  filterPeringkat === 'Antarabangsa'
                    ? 'bg-purple-600 text-white border-purple-700 shadow-sm shadow-purple-600/20 ring-2 ring-purple-400'
                    : 'bg-white hover:bg-purple-50/50 text-slate-800 border-slate-200 shadow-xs'
                }`}
                title="Klik untuk tapis Peringkat Antarabangsa"
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${filterPeringkat === 'Antarabangsa' ? 'text-purple-100' : 'text-purple-700'}`}>
                    Antarabangsa
                  </span>
                  <span className={`w-2 h-2 rounded-full ${filterPeringkat === 'Antarabangsa' ? 'bg-white animate-pulse' : 'bg-purple-500'}`} />
                </div>
                <div className="text-2xl font-black tracking-tight">
                  {statsPeringkat.countAntarabangsa}
                </div>
                <div className={`text-[10px] font-bold mt-1 truncate ${filterPeringkat === 'Antarabangsa' ? 'text-purple-100' : 'text-slate-400'}`}>
                  {filterPeringkat === 'Antarabangsa' ? '✓ Sedang Ditapis' : 'Klik untuk tapis'}
                </div>
              </button>

              {/* Kad 6: Murid Terlibat (Unik) */}
              <div
                className="p-4 rounded-2xl border bg-white text-slate-800 border-slate-200 shadow-xs text-left"
                title="Jumlah murid unik yang terlibat dalam senarai paparan semasa"
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Murid Terlibat
                  </span>
                  <Users className="w-4 h-4 text-indigo-500 shrink-0" />
                </div>
                <div className="text-2xl font-black tracking-tight text-indigo-950">
                  {statsPeringkat.muridUnik}
                </div>
                <div className="text-[10px] font-bold mt-1 text-slate-400 truncate">
                  individu berbeza
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white p-5 md:p-6 rounded-[32px] shadow-sm border border-slate-100 space-y-4">
              {/* Row 1: Search & Export Actions */}
              <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                <div className="relative flex-1">
                  <Search className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
                  <input 
                    type="text" 
                    placeholder="Cari murid, IC atau pertandingan..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    className="w-full pl-12 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white transition-all shadow-inner" 
                  />
                  {searchTerm && (
                    <button 
                      type="button"
                      onClick={() => setSearchTerm('')} 
                      className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                      title="Padam carian"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowGuruReportModal(true)}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-900 px-4 py-3 rounded-xl font-black text-[11px] uppercase tracking-wider shadow-sm transition-all cursor-pointer active:scale-95"
                    title="Lihat rumusan & muat turun senarai guru pengiring tanpa duplikasi"
                  >
                    <UserCheck className="w-4 h-4 text-slate-900" />
                    <span>Rumusan Guru</span>
                  </button>
                  <button 
                    type="button"
                    onClick={exportExcel} 
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl font-black text-[11px] uppercase tracking-wider shadow-sm transition-all cursor-pointer active:scale-95"
                    title="Muat Turun Format Excel mengikut penapis yang dipilih"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-200" />
                    <span>Muat Turun Excel</span>
                  </button>
                  <button 
                    type="button"
                    onClick={exportPDF} 
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-5 py-3 rounded-xl font-black text-[11px] uppercase tracking-wider shadow-sm transition-all cursor-pointer active:scale-95"
                    title="Muat Turun Format PDF mengikut penapis yang dipilih"
                  >
                    <FileText className="w-4 h-4 text-rose-200" />
                    <span>Muat Turun PDF</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Filter Select Dropdowns */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5 text-slate-400 text-xs font-black uppercase tracking-wider pr-1">
                  <Filter className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[11px] text-slate-600">Penapis:</span>
                </div>

                {/* Filter Peringkat */}
                <div className="flex-1 min-w-[150px] sm:flex-initial">
                  <select 
                    onChange={(e) => setFilterPeringkat(e.target.value)} 
                    value={filterPeringkat} 
                    className={`w-full bg-slate-50 border px-3.5 py-2.5 rounded-xl font-bold text-xs outline-none cursor-pointer transition-all ${
                      filterPeringkat !== 'SEMUA' 
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-950 font-black ring-2 ring-emerald-200' 
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <option value="SEMUA">Semua Peringkat</option>
                    {senaraiPeringkat.map(p => (
                      <option key={p} value={p}>Peringkat {p}</option>
                    ))}
                  </select>
                </div>

                {/* Filter Status Pertandingan */}
                <div className="flex-1 min-w-[170px] sm:flex-initial">
                  <select 
                    onChange={(e) => setFilterStatus(e.target.value)} 
                    value={filterStatus} 
                    className={`w-full bg-slate-50 border px-3.5 py-2.5 rounded-xl font-bold text-xs outline-none cursor-pointer transition-all ${
                      filterStatus !== 'SEMUA' 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-900 font-black ring-2 ring-indigo-200' 
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <option value="SEMUA">Semua Status (KPM / Luar)</option>
                    {senaraiStatusPertandingan.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Filter Bahagian Unit */}
                <div className="flex-1 min-w-[180px] sm:flex-initial">
                  <select 
                    onChange={(e) => setFilterBahagian(e.target.value)} 
                    value={filterBahagian} 
                    className={`w-full bg-slate-50 border px-3.5 py-2.5 rounded-xl font-bold text-xs outline-none cursor-pointer transition-all ${
                      filterBahagian !== 'SEMUA' 
                        ? 'border-amber-500 bg-amber-50 text-amber-950 font-black ring-2 ring-amber-200' 
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <option value="SEMUA">Semua Bahagian Unit</option>
                    {senaraiBahagian.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                {/* Filter Aliran */}
                <div className="flex-1 min-w-[130px] sm:flex-initial">
                  <select 
                    onChange={(e) => setFilterAliran(e.target.value)} 
                    value={filterAliran} 
                    className={`w-full bg-slate-50 border px-3.5 py-2.5 rounded-xl font-bold text-xs outline-none cursor-pointer transition-all ${
                      filterAliran !== 'SEMUA' 
                        ? 'border-amber-500 bg-amber-50 text-amber-950 font-black ring-2 ring-amber-200' 
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <option value="SEMUA">Semua Aliran</option>
                    {senaraiAliran.map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>

                {/* Filter Kelas */}
                <div className="flex-1 min-w-[130px] sm:flex-initial">
                  <select 
                    onChange={(e) => setFilterKelas(e.target.value)} 
                    value={filterKelas} 
                    className={`w-full bg-slate-50 border px-3.5 py-2.5 rounded-xl font-bold text-xs outline-none cursor-pointer transition-all ${
                      filterKelas !== 'SEMUA' 
                        ? 'border-amber-500 bg-amber-50 text-amber-950 font-black ring-2 ring-amber-200' 
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <option value="SEMUA">Semua Kelas</option>
                    {senaraiKelas.map(k => (
                      <option key={k} value={k}>Kelas {k}</option>
                    ))}
                  </select>
                </div>

                {/* Reset Filters button if any filter is active */}
                {(filterStatus !== 'SEMUA' || filterBahagian !== 'SEMUA' || filterPeringkat !== 'SEMUA' || filterAliran !== 'SEMUA' || filterKelas !== 'SEMUA' || searchTerm) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStatus('SEMUA');
                      setFilterBahagian('SEMUA');
                      setFilterPeringkat('SEMUA');
                      setFilterAliran('SEMUA');
                      setFilterKelas('SEMUA');
                      setSearchTerm('');
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    title="Set Semula Semua Penapis"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Set Semula</span>
                  </button>
                )}
              </div>

              {/* Active Filter Indicators / Summary Bar for Quick Verification & Download Context */}
              {(filterStatus !== 'SEMUA' || filterBahagian !== 'SEMUA' || filterPeringkat !== 'SEMUA' || filterAliran !== 'SEMUA' || filterKelas !== 'SEMUA') && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Penapis Dipilih Untuk Muat Turun ({filteredData.length} rekod):</span>
                  {filterPeringkat !== 'SEMUA' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black border bg-emerald-50 text-emerald-800 border-emerald-200 shadow-xs">
                      <span>Peringkat: {filterPeringkat}</span>
                      <button type="button" onClick={() => setFilterPeringkat('SEMUA')} className="hover:text-emerald-950 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                  {filterStatus !== 'SEMUA' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black border bg-indigo-50 text-indigo-700 border-indigo-200 shadow-xs">
                      <span>Status: {filterStatus}</span>
                      <button type="button" onClick={() => setFilterStatus('SEMUA')} className="hover:text-indigo-950 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                  {filterBahagian !== 'SEMUA' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black border bg-amber-50 text-amber-800 border-amber-200 shadow-xs">
                      <span>Bahagian: {filterBahagian}</span>
                      <button type="button" onClick={() => setFilterBahagian('SEMUA')} className="hover:text-amber-950 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                  {filterAliran !== 'SEMUA' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black border bg-slate-100 text-slate-700 border-slate-300 shadow-xs">
                      <span>Aliran: {filterAliran}</span>
                      <button type="button" onClick={() => setFilterAliran('SEMUA')} className="hover:text-slate-950 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                  {filterKelas !== 'SEMUA' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black border bg-slate-100 text-slate-700 border-slate-300 shadow-xs">
                      <span>Kelas: {filterKelas}</span>
                      <button type="button" onClick={() => setFilterKelas('SEMUA')} className="hover:text-slate-950 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Records Table */}
            <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest rounded-tl-[32px]">Profil Murid</th>
                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Kelas</th>
                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Aktiviti & Bahagian</th>
                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Pencapaian</th>
                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest">Guru Pengiring</th>
                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right rounded-tr-[32px]">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-20 text-center text-slate-300 font-black uppercase italic tracking-widest">
                        Tiada rekod disimpan
                      </td>
                    </tr>
                  ) : filteredData.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="font-black text-slate-800 text-sm uppercase">{r.nama}</div>
                        <div className="text-[10px] font-bold text-slate-400 tracking-widest mt-0.5">{r.noKp || '-'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="bg-white border border-slate-200 text-slate-600 px-2 py-1 rounded-md text-[9px] font-black uppercase">{r.aliran}</span>
                          <span className="bg-white border border-slate-200 text-slate-600 px-2 py-1 rounded-md text-[9px] font-black uppercase">{r.kelas}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-700 text-xs uppercase max-w-[260px] truncate" title={r.pertandingan}>{r.pertandingan}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest truncate max-w-[150px]">{r.bahagian}</div>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black tracking-wider border ${getStatusBadgeClass(r.statusPertandingan)}`}>
                            {normalizeStatus(r.statusPertandingan)}
                          </span>
                          {formatTarikhPaparan(r.jenisTarikh, r.tarikhMula, r.tarikhTamat) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                              <Calendar className="w-2.5 h-2.5 text-amber-600" />
                              {formatTarikhPaparan(r.jenisTarikh, r.tarikhMula, r.tarikhTamat)}
                            </span>
                          )}
                          {r.suratPengiktirafanData && (
                            <button
                              type="button"
                              onClick={() => setPreviewSuratModal({
                                nama: r.suratPengiktirafanNama || 'Surat Pengiktirafan KPM',
                                data: r.suratPengiktirafanData || '',
                                pertandingan: r.pertandingan,
                                murid: r.nama
                              })}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer transition-colors"
                              title="Lihat Surat Pengiktirafan KPM"
                            >
                              <Eye className="w-2.5 h-2.5" />
                              <span>Surat KPM</span>
                            </button>
                          )}
                          {r.sijilMuridData && (
                            <button
                              type="button"
                              onClick={() => setPreviewSuratModal({
                                nama: r.sijilMuridNama || 'Sijil Pencapaian / Penyertaan Murid',
                                data: r.sijilMuridData || '',
                                pertandingan: r.pertandingan,
                                murid: r.nama
                              })}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition-colors"
                              title="Lihat Sijil Murid"
                            >
                              <Eye className="w-2.5 h-2.5" />
                              <span>Sijil</span>
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-black text-xs text-slate-900 uppercase italic">{r.peringkat}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">{r.pencapaian}</div>
                      </td>
                      <td className="px-6 py-4">
                        {r.guruPengiring && r.guruPengiring.length > 0 ? (
                          <div className="flex flex-col gap-1 items-start">
                            {r.guruPengiring.map((g, gIdx) => (
                              <span
                                key={gIdx}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-900 uppercase max-w-[220px] truncate"
                                title={g}
                              >
                                <ShieldCheck className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                                <span className="truncate">{g}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2 items-center">
                          {deleteConfirmId === r.id ? (
                            <div className="flex gap-2">
                              <button onClick={() => deleteRekod(r.id)} className="p-2.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-red-700 transition-all cursor-pointer">Sah Padam</button>
                              <button onClick={() => setDeleteConfirmId(null)} className="p-2.5 bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-300 transition-all cursor-pointer">Batal</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirmId(r.id)} title="Padam Rekod" className="p-2.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-xl transition-all flex items-center justify-center cursor-pointer">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => editRekod(r.id)} title="Edit Rekod" className="p-2.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer">
                            <Edit3 className="w-4 h-4" />
                            <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Edit</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 4: SEMAKAN KIRIMAN IBU BAPA                         */}
        {/* ========================================================= */}
        {activeView === 'semakan' && (
          <ParentReviewView
            sheetConfig={sheetConfig}
            hasSheetToken={hasSheetToken}
            parentScriptUrl={parentScriptUrl}
            onSaveParentScriptUrl={handleSaveParentScriptUrl}
            submissions={parentSubmissions}
            reviewTabExists={reviewTabExists}
            busy={parentSubmissionsBusy}
            onRefresh={() => { void refreshParentSubmissions(false); }}
            onEnsureReviewTab={() => { void handleEnsureParentReviewTab(); }}
            onApprove={handleApproveParentSubmission}
            onEditBeforeApprove={handleEditBeforeApproveParentSubmission}
            onRejectOrDelete={handleRejectOrDeleteParentSubmission}
            onPreviewSurat={(info) => setPreviewSuratModal(info)}
            onOpenPreviewParentPortal={() => setPreviewParentPortal(true)}
            onOpenSheetModal={() => setShowSheetModal(true)}
            onGoogleSignIn={() => { void handleGoogleSignIn(); }}
            normalizeStatus={normalizeStatus}
            getStatusBadgeClass={getStatusBadgeClass}
            formatTarikhPaparan={formatTarikhPaparan}
          />
        )}
      </main>

      {/* ========================================================= */}
      {/* MODAL: TETAPAN & SANDARAN GOOGLE SHEETS                   */}
      {/* ========================================================= */}
      {showSheetModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 flex flex-col">
            <div className="p-6 sm:p-8 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/70 rounded-t-[32px]">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-600 text-white p-3 rounded-2xl shadow-md shadow-emerald-600/20">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-black text-slate-900 uppercase italic">
                    Sandaran & Integrasi Google Sheets
                  </h3>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">
                    Simpanan Berganda Firebase + Google Sheets
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSheetModal(false)}
                className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              {/* Step 1: Google Sign-In Status */}
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                      Langkah 1 • Akaun Google Guru
                    </span>
                    <h4 className="text-sm font-black text-slate-800 mt-0.5">
                      {googleUser && hasSheetToken
                        ? `Disambungkan sebagai ${googleUser.email || googleUser.displayName}`
                        : googleUser
                          ? `Akaun dikesan (${googleUser.email}) — Sila sahkan sesi Google Sheets`
                          : 'Log masuk dengan akaun Google untuk menyambung Google Sheets'}
                    </h4>
                  </div>

                  {hasSheetToken ? (
                    <button
                      type="button"
                      onClick={handleGoogleLogout}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-xs font-bold text-slate-600 cursor-pointer transition-all self-start sm:self-auto"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Log Keluar</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isLoggingInGoogle}
                      className="bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-xl px-4 py-2.5 flex items-center gap-2.5 font-bold text-xs shadow-xs transition-all cursor-pointer disabled:opacity-60 self-start sm:self-auto"
                    >
                      {isLoggingInGoogle ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                      ) : (
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                        </svg>
                      )}
                      <span>Sign in with Google</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Step 2: Connected Spreadsheet or Setup Options */}
              {sheetConfig ? (
                <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 block">
                        Langkah 2 • Fail Google Sheet Terpaut
                      </span>
                      <h4 className="text-base font-black text-slate-900 mt-1">
                        {sheetConfig.spreadsheetTitle}
                      </h4>
                      <p className="text-xs font-bold text-slate-600 mt-0.5">
                        Tab Helaian: <span className="text-emerald-800">{sheetConfig.sheetTitle}</span>
                      </p>
                      <p className="text-[10px] font-mono text-slate-400 mt-1 break-all">
                        ID: {sheetConfig.spreadsheetId}
                      </p>
                    </div>

                    <a
                      href={sheetConfig.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-600 hover:text-white text-emerald-800 text-xs font-black uppercase tracking-wider shadow-xs transition-all shrink-0 self-start"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Buka Sheet</span>
                    </a>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-200/70">
                    <button
                      type="button"
                      onClick={() => loadFromGoogleSheets()}
                      disabled={sheetBusy || !hasSheetToken}
                      className="py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 ${sheetBusy ? 'animate-spin' : ''}`} />
                      <span>Muat Data Dari Google Sheet</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleRequestSyncAllToSheet}
                      disabled={sheetBusy || !hasSheetToken}
                      className="py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Sheet className="w-4 h-4 text-amber-400" />
                      <span>Segerak Rekod Ke Sheet</span>
                    </button>
                  </div>

                  <div className="flex justify-between items-center pt-1 text-[11px]">
                    <span className="text-slate-500 font-semibold">
                      {sheetLastSyncAt ? `Segerak terakhir: ${sheetLastSyncAt}` : 'Auto-simpan aktif untuk setiap kemasukan baharu.'}
                    </span>
                    <button
                      type="button"
                      onClick={handleDisconnectSheet}
                      className="text-rose-600 hover:text-rose-800 font-bold underline cursor-pointer"
                    >
                      Tukar / Putus Pautan
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Option A: Create New Google Sheet */}
                  <div className="p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 block">
                      Pilihan A • Cipta Fail Baharu Automatik
                    </span>
                    <p className="text-xs text-slate-600 font-medium">
                      Sistem akan mencipta satu fail Google Sheet baharu bernama <strong>REKOD PENCAPAIAN PAJSK SKAUK</strong> lengkap dengan tajuk kolum dan format sedia guna di Google Drive anda.
                    </p>
                    <button
                      type="button"
                      onClick={handleCreateNewSheet}
                      disabled={sheetBusy || !hasSheetToken}
                      className="w-full sm:w-auto px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {sheetBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
                      <span>Cipta Google Sheet Baharu</span>
                    </button>
                  </div>

                  {/* Option B: Link Existing Google Sheet */}
                  <form onSubmit={handleLinkExistingSheet} className="p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 block">
                      Pilihan B • Pautkan Google Sheet Sedia Ada
                    </span>
                    <p className="text-xs text-slate-600 font-medium">
                      Jika sekolah sudah mempunyai fail Google Sheet khas (atau dikongsi antara guru), tampal pautan URL atau ID Google Sheet di bawah:
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="text"
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        value={sheetUrlInput}
                        onChange={(e) => setSheetUrlInput(e.target.value)}
                        className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-emerald-500 focus:bg-white"
                      />
                      <button
                        type="submit"
                        disabled={sheetBusy || !hasSheetToken}
                        className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        Pautkan Sheet
                      </button>
                    </div>
                  </form>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                <strong className="uppercase text-[10px] tracking-wider block mb-1">Bagaimana Sandaran Ini Berfungsi?</strong>
                Setiap kali rekod baharu dimasukkan (Individu atau Pukal), sistem akan menyimpan ke <strong>Firebase</strong> dan menambah baris ke <strong>Google Sheets</strong> secara serentak. Sekiranya Firebase mencapai had kuota harian, anda boleh terus melihat dan mengurus rekod murid terus daripada Google Sheets.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL PENGESAHAN MUTASI GOOGLE SHEETS (MANDATORY)         */}
      {/* ========================================================= */}
      {sheetConfirmDialog && (
        <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-[28px] w-full max-w-md shadow-2xl border border-slate-200 p-6 sm:p-7 space-y-5">
            <div className="flex items-start gap-3.5">
              <div className={`p-3 rounded-2xl shrink-0 ${
                sheetConfirmDialog.variant === 'red'
                  ? 'bg-rose-100 text-rose-600'
                  : sheetConfirmDialog.variant === 'emerald'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-amber-100 text-amber-600'
              }`}>
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 leading-snug">
                  {sheetConfirmDialog.title}
                </h3>
                <p className="text-xs font-medium text-slate-600 mt-2 leading-relaxed">
                  {sheetConfirmDialog.description}
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSheetConfirmDialog(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => sheetConfirmDialog.onConfirm()}
                className={`px-5 py-2.5 rounded-xl text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer ${
                  sheetConfirmDialog.variant === 'red'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : sheetConfirmDialog.variant === 'emerald'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {sheetConfirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ========================================================= */}
      {/* MODAL RUMUSAN & LAPORAN KHAS GURU PENGIRING               */}
      {/* ========================================================= */}
      {showGuruReportModal && (
        <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-[32px] w-full max-w-5xl max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-slate-100 bg-amber-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="bg-amber-500 text-slate-900 p-3 rounded-2xl shadow-sm shrink-0">
                  <UserCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-black text-slate-900 uppercase italic tracking-tight">
                    Rumusan & Laporan Guru Pengiring
                  </h3>
                  <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mt-0.5">
                    Sesi {selectedYear} • {guruPengiringSummaries.length} Orang Guru • Digabungkan Tanpa Duplikasi Pasukan
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={exportGuruExcel}
                  disabled={guruPengiringSummaries.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer disabled:opacity-40"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-200" />
                  <span>Excel Guru</span>
                </button>
                <button
                  type="button"
                  onClick={exportGuruPDF}
                  disabled={guruPengiringSummaries.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer disabled:opacity-40"
                >
                  <FileText className="w-4 h-4 text-rose-200" />
                  <span>PDF Guru</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowGuruReportModal(false)}
                  className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 cursor-pointer"
                  title="Tutup"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Search & Sort Controls */}
            <div className="p-4 sm:px-6 border-b border-slate-100 bg-white flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Cari nama guru pengiring atau nama pertandingan..."
                  value={guruReportSearch}
                  onChange={(e) => setGuruReportSearch(e.target.value)}
                  className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                />
                {guruReportSearch && (
                  <button
                    type="button"
                    onClick={() => setGuruReportSearch('')}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <ArrowUpDown className="w-4 h-4 text-amber-600 shrink-0" />
                <select
                  value={guruReportSort}
                  onChange={(e) => setGuruReportSort(e.target.value as 'az' | 'za' | 'aktif')}
                  className="bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl text-xs font-black text-slate-800 uppercase tracking-wider outline-none cursor-pointer focus:border-amber-500"
                >
                  <option value="az">Susun Nama: A → Z</option>
                  <option value="za">Susun Nama: Z → A</option>
                  <option value="aktif">Paling Aktif (Bil. Pertandingan)</option>
                </select>
              </div>
            </div>

            {/* Modal Body: Grouped Teacher List */}
            <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-50/60 space-y-3">
              {guruPengiringSummaries.length === 0 ? (
                <div className="py-16 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2">
                  <Users className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-sm font-black text-slate-600">
                    Tiada nama guru pengiring dijumpai bagi paparan ini.
                  </p>
                  <p className="text-xs font-medium text-slate-400 max-w-md mx-auto">
                    Pastikan medan "Nama Guru Pengiring / Guru Pembimbing / Jurulatih" telah diisi dalam borang Daftar Pencapaian atau kemaskini rekod murid.
                  </p>
                </div>
              ) : (
                guruPengiringSummaries.map((guru, idx) => (
                  <div
                    key={guru.namaGuru}
                    className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs hover:border-amber-300 transition-all space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-lg bg-slate-900 text-amber-400 text-xs font-black flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <h4 className="text-sm sm:text-base font-black text-slate-900 uppercase tracking-tight">
                          {guru.namaGuru}
                        </h4>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-black uppercase tracking-wider">
                          {guru.bilPertandingan} Pertandingan
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-wider">
                          {guru.totalMurid} Penyertaan Murid
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {guru.competitions.map((comp) => (
                        <div
                          key={comp.key}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5"
                        >
                          <div className="text-xs font-black text-slate-800 uppercase leading-snug">
                            {comp.pertandingan}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                            <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                              {comp.peringkat}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                              {comp.bahagian}
                            </span>
                            {comp.tarikh !== '-' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                                <Calendar className="w-2.5 h-2.5 text-amber-600" />
                                {comp.tarikh}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
                            <span className="font-black text-amber-700">
                              Pencapaian: {comp.pencapaian}
                            </span>
                            <span className="font-bold text-slate-500 shrink-0">
                              {comp.bilMurid} murid
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL PRATONTON SURAT PENGIKTIRAFAN KPM                   */}
      {/* ========================================================= */}
      {previewSuratModalEl}
    </div>
  );
}
