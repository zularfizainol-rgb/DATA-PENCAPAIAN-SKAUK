import React, { useState, useEffect, useMemo } from 'react';
import {
  Loader2, LayoutDashboard, PlusCircle, Users, Trophy, GraduationCap,
  PieChart, X, Save, Search, FileSpreadsheet, FileText, Award, Edit3, Trash2,
  Plus, ClipboardList, CheckCircle2, ArrowLeft, Copy, Check, ChevronRight, UserPlus
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  db, 
  collection, doc, setDoc, onSnapshot, query, 
  serverTimestamp, deleteDoc
} from './lib/firebase';

const senaraiBahagian = [
  "Unit Beruniform", 
  "Kelab & Persatuan", 
  "Sukan & Permainan", 
  "Ko-akademik BM", 
  "Ko-akademik BI", 
  "STEM", 
  "Kesenian / Kebudayaan"
];

const senaraiPencapaian = [
  "Penyertaan", 
  "Kelima", 
  "Keempat", 
  "Ketiga", 
  "Naib Johan", 
  "Johan"
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
  "Anjuran Agensi Luar"
];

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
  const [activeView, setActiveView] = useState<'dashboard' | 'kemasukan' | 'senarai'>('dashboard');
  const [rekodPajsk, setRekodPajsk] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProgress, setSavingProgress] = useState<{ current: number; total: number } | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAliran, setFilterAliran] = useState('SEMUA');
  const [filterKelas, setFilterKelas] = useState('SEMUA');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [quotaWarning, setQuotaWarning] = useState(false);

  // Dashboard Modal States
  const [selectedDashboardPeringkat, setSelectedDashboardPeringkat] = useState<string | null>(null);
  const [selectedDashboardBahagian, setSelectedDashboardBahagian] = useState<string | null>(null);
  const [selectedPertandinganInModal, setSelectedPertandinganInModal] = useState<string | null>(null);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);

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
    statusPertandingan: 'KPM',
    peringkat: 'Daerah',
    pencapaian: 'Penyertaan',
    creatorId: ''
  });

  // Bulk Entry Form Header
  const [bulkHeader, setBulkHeader] = useState({
    pertandingan: '',
    bahagian: 'Unit Beruniform',
    statusPertandingan: 'KPM',
    peringkat: 'Daerah',
    defaultPencapaian: 'Penyertaan',
    defaultAliran: 'Tahun 1',
    defaultKelas: 'UIAM'
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

  // Initial Data Subscription with LocalStorage Caching & Quota Protection
  useEffect(() => {
    try {
      const cached = localStorage.getItem('cached_rekod_pajsk');
      if (cached) {
        setRekodPajsk(JSON.parse(cached));
        setLoading(false);
      }
    } catch (e) {
      console.warn("Could not load from localStorage cache:", e);
    }

    const q = query(collection(db, 'pencapaian'));
    const unsubscribeSnap = onSnapshot(q, (snapshot) => {
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
      setLoading(false);
      setQuotaWarning(false);
    }, (err: any) => {
      console.error("Firestore error:", err);
      if (err?.message?.includes('Quota') || err?.code === 'resource-exhausted') {
        setQuotaWarning(true);
      }
      setLoading(false);
    });

    return () => {
      unsubscribeSnap();
    };
  }, []);

  const filteredData = useMemo(() => {
    return rekodPajsk.filter(r => {
      const matchesYear = r.tahunKalendar === selectedYear;
      const matchesSearch = (r.nama || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                            (r.pertandingan || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (r.noKp || '').includes(searchTerm);
      const matchesAliran = filterAliran === 'SEMUA' || r.aliran === filterAliran;
      const matchesKelas = filterKelas === 'SEMUA' || r.kelas === filterKelas;
      return matchesYear && matchesSearch && matchesAliran && matchesKelas;
    });
  }, [rekodPajsk, selectedYear, searchTerm, filterAliran, filterKelas]);

  const switchView = (view: 'dashboard' | 'kemasukan' | 'senarai') => {
    setActiveView(view);
    if (view !== 'kemasukan') {
      setEditingId(null);
      resetFormData();
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
      statusPertandingan: 'KPM',
      peringkat: 'Daerah',
      pencapaian: 'Penyertaan',
      creatorId: ''
    });
  };

  const updateFormData = (key: string, val: string) => {
    setFormData(prev => ({ ...prev, [key]: val }));
  };

  // Helper to generate a clean valid Firestore ID
  const generateValidId = (index?: number) => {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 9);
    return `${timestamp}_${randomPart}${index !== undefined ? `_${index}` : ''}`;
  };

  // Handle Single Student Save
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nama.trim() || !formData.pertandingan.trim()) {
      alert("Sila isi Nama Murid dan Nama Pertandingan.");
      return;
    }
    
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
        statusPertandingan: formData.statusPertandingan,
        peringkat: formData.peringkat,
        pencapaian: formData.pencapaian,
        tahunKalendar: selectedYear,
        creatorId: editingId ? (formData.creatorId || 'guru_skauk') : 'guru_skauk',
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, 'pencapaian', id), payload, { merge: true });
      
      // Update local state immediately for seamless responsiveness
      setRekodPajsk(prev => {
        const existingIdx = prev.findIndex(item => item.id === id);
        const updatedItem = { id, ...payload };
        if (existingIdx >= 0) {
          const clone = [...prev];
          clone[existingIdx] = updatedItem;
          return clone;
        }
        return [updatedItem, ...prev];
      });

      resetFormData();
      setEditingId(null);
      switchView('senarai');
    } catch (error) {
      console.error("Error saving data:", error);
      alert("Terdapat ralat semasa menyimpan data ke Firestore.");
    } finally {
      setSaving(false);
    }
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
      alert("Sekurang-kurangnya satu baris murid diperlukan.");
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

  // Handle Bulk Submit
  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkHeader.pertandingan.trim()) {
      alert("Sila masukkan Nama Aktiviti / Pertandingan terlebih dahulu.");
      return;
    }

    const validRows = bulkRows.filter(r => r.nama.trim().length > 0);
    if (validRows.length === 0) {
      alert("Sila masukkan sekurang-kurangnya satu nama murid yang lengkap.");
      return;
    }

    setSaving(true);
    setSavingProgress({ current: 0, total: validRows.length });

    try {
      const addedRecords: RecordData[] = [];

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
          statusPertandingan: bulkHeader.statusPertandingan,
          peringkat: bulkHeader.peringkat,
          pencapaian: student.pencapaian || bulkHeader.defaultPencapaian,
          tahunKalendar: selectedYear,
          creatorId: 'guru_skauk',
          updatedAt: serverTimestamp()
        };

        await setDoc(doc(db, 'pencapaian', docId), payload);
        addedRecords.push({ id: docId, ...payload });

        setSavingProgress({ current: i + 1, total: validRows.length });
      }

      // Update local state with the saved records
      setRekodPajsk(prev => [...addedRecords, ...prev]);

      alert(`Berjaya mendaftarkan ${validRows.length} orang murid untuk pertandingan ${bulkHeader.pertandingan.toUpperCase()}!`);
      
      // Reset bulk form
      setBulkRows([
        { id: '1', nama: '', noKp: '', aliran: bulkHeader.defaultAliran, kelas: bulkHeader.defaultKelas, pencapaian: bulkHeader.defaultPencapaian },
        { id: '2', nama: '', noKp: '', aliran: bulkHeader.defaultAliran, kelas: bulkHeader.defaultKelas, pencapaian: bulkHeader.defaultPencapaian }
      ]);
      setBulkHeader(prev => ({ ...prev, pertandingan: '' }));
      switchView('senarai');
    } catch (error) {
      console.error("Error bulk saving data:", error);
      alert("Terdapat ralat semasa menyimpan rekod pukal. Sila semak sambungan internet anda.");
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
        statusPertandingan: item.statusPertandingan || 'KPM',
        peringkat: item.peringkat,
        pencapaian: item.pencapaian,
        creatorId: item.creatorId || ''
      });
      setEditingId(id);
      setKemasukanMode('individu');
      // Close any open modals
      setSelectedDashboardPeringkat(null);
      setSelectedDashboardBahagian(null);
      setSelectedPertandinganInModal(null);
      setActiveView('kemasukan');
    }
  };

  const deleteRekod = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'pencapaian', id));
      setRekodPajsk(prev => prev.filter(r => r.id !== id));
      setDeleteConfirmId(null);
    } catch (error) {
      console.error("Error deleting data:", error);
      alert("Ralat semasa memadam data.");
    }
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
      "STATUS PERTANDINGAN": r.statusPertandingan || 'KPM',
      "PERINGKAT": r.peringkat,
      "PENCAPAIAN": r.pencapaian,
      "TAHUN": r.tahunKalendar
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekod PAJSK");
    XLSX.writeFile(wb, `REKOD_PENYERTAAN_SKAUK_${selectedYear}.xlsx`);
  };

  const exportPDF = () => {
    const docPdf = new jsPDF('landscape');
    docPdf.setFontSize(14);
    docPdf.text(`REKOD PENCAPAIAN KO-KURIKULUM SKAUK (${selectedYear})`, 14, 15);
    docPdf.setFontSize(9);
    docPdf.text(`Jumlah Rekod: ${filteredData.length} | Tarikh Cetakan: ${new Date().toLocaleDateString('ms-MY')}`, 14, 22);

    const tableRows = filteredData.map((r, i) => [
      i + 1,
      r.nama,
      r.noKp || '-',
      `${r.aliran} (${r.kelas})`,
      r.bahagian,
      r.pertandingan,
      r.statusPertandingan || 'KPM',
      r.peringkat,
      r.pencapaian
    ]);

    autoTable(docPdf, {
      head: [['BIL', 'NAMA MURID', 'NO. KP', 'KELAS', 'BAHAGIAN', 'PERTANDINGAN', 'STATUS', 'PERINGKAT', 'PENCAPAIAN']],
      body: tableRows,
      startY: 28,
      theme: 'grid',
      styles: { fontSize: 7, font: 'helvetica' },
      headStyles: { fillColor: [245, 158, 11], textColor: [0, 0, 0], fontStyle: 'bold' }
    });

    docPdf.save(`LAPORAN_SKAUK_${selectedYear}.pdf`);
  };

  // Helper to copy student names from competition modal
  const copyStudentList = (students: RecordData[]) => {
    const text = students.map((s, idx) => `${idx + 1}. ${s.nama} (${s.aliran} ${s.kelas}) - ${s.pencapaian}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Shortcut to add more students to this exact competition
  const handleAddMoreToThisCompetition = (pertandinganName: string, bahagian: string, peringkat: string, statusPertandingan: string) => {
    setBulkHeader({
      pertandingan: pertandinganName,
      bahagian: bahagian || 'Unit Beruniform',
      statusPertandingan: statusPertandingan || 'KPM',
      peringkat: peringkat || 'Daerah',
      defaultPencapaian: 'Penyertaan',
      defaultAliran: 'Tahun 1',
      defaultKelas: 'UIAM'
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
      {/* Sidebar Navigation */}
      <nav className="w-full lg:w-72 bg-slate-900 text-white p-6 flex flex-col shadow-2xl z-20 sticky top-0 lg:h-screen transition-all shrink-0">
        <div className="flex flex-col gap-6 mb-10 px-2">
          <div className="flex items-center gap-3">
            <img src="https://i.postimg.cc/x1yzrs3k/IMG-20220901-WA0001(1).jpg" className="w-12 h-12 object-contain bg-white rounded-lg p-0.5 shadow-sm" alt="Logo SKAU" />
            <img src="https://i.postimg.cc/bYsF95Q0/IMG-20220901-WA0002(1).jpg" className="w-12 h-12 object-contain bg-white rounded-lg p-0.5 shadow-sm" alt="Logo TS25" />
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-amber-500 p-2 rounded-lg shrink-0 text-slate-900 shadow-md">
              <Trophy className="w-5 h-5" />
            </div>
            <h1 className="text-base font-black tracking-tight italic uppercase leading-tight">
              DATA PENCAPAIAN<br/><span className="text-amber-500">SKAUK</span>
            </h1>
          </div>
        </div>

        <div className="space-y-2 flex-1">
          <button 
            onClick={() => switchView('dashboard')} 
            className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all cursor-pointer ${
              activeView === 'dashboard' 
                ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' 
                : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-sm font-bold">Dashboard Analisis</span>
          </button>

          <button 
            onClick={() => switchView('kemasukan')} 
            className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all cursor-pointer ${
              activeView === 'kemasukan' 
                ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' 
                : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            <PlusCircle className="w-5 h-5" />
            <div className="flex flex-col text-left">
              <span className="text-sm font-bold">Daftar Pencapaian</span>
              <span className="text-[9px] font-semibold opacity-75 uppercase tracking-wider">Individu / Pukal</span>
            </div>
          </button>

          <button 
            onClick={() => switchView('senarai')} 
            className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all cursor-pointer ${
              activeView === 'senarai' 
                ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' 
                : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            <Users className="w-5 h-5" />
            <span className="text-sm font-bold">Rekod Murid</span>
          </button>
        </div>

        {quotaWarning && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-[10px] leading-relaxed">
            <span className="font-bold uppercase block mb-1">Mod Sandaran Cache:</span>
            Had kuota harian Firestore dicapai. Data terkini diselamatkan secara automatik dan kekal boleh diakses.
          </div>
        )}
        
        <div className="mt-auto pt-6 border-t border-white/10 text-[10px] text-slate-500 font-bold uppercase tracking-widest text-center flex flex-col items-center gap-2">
          <span>Storan Awan Aktif <span className="text-emerald-500">●</span></span>
          <span className="text-[8px] text-slate-600 font-medium lowercase">skauk-pajsk-system</span>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 lg:h-screen lg:overflow-y-auto w-full max-w-full overflow-x-hidden min-w-0">
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
                  <option value="2023">TAHUN 2023</option>
                  <option value="2024">TAHUN 2024</option>
                  <option value="2025">TAHUN 2025</option>
                  <option value="2026">TAHUN 2026</option>
                  <option value="2027">TAHUN 2027</option>
                  <option value="2028">TAHUN 2028</option>
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
                        
                        const keys = Object.keys(grouped).sort();

                        // If user selected a specific competition to drill down:
                        if (selectedPertandinganInModal) {
                          const students = grouped[selectedPertandinganInModal] || [];
                          const compInfo = students[0];
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
                                    <span className="bg-slate-800 text-white px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm">
                                      {compInfo?.statusPertandingan || 'KPM'}
                                    </span>
                                    <span className="bg-white border border-amber-500/30 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm">
                                      {compInfo?.bahagian}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto">
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
                                      onClick={() => handleAddMoreToThisCompetition(selectedPertandinganInModal, compInfo?.bahagian, selectedDashboardPeringkat, compInfo?.statusPertandingan)}
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
                                              s.pencapaian === 'Johan' ? 'bg-amber-100 text-amber-800 font-black' :
                                              s.pencapaian === 'Naib Johan' ? 'bg-slate-200 text-slate-800' :
                                              s.pencapaian === 'Ketiga' ? 'bg-orange-100 text-orange-800' :
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
                        if (keys.length === 0) {
                          return <div className="py-12 text-center text-slate-400 font-bold uppercase text-xs tracking-widest italic">Tiada Rekod Pertandingan</div>;
                        }
                        
                        return (
                          <div className="space-y-4">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                              Pilih satu pertandingan di bawah untuk menyemak senarai nama murid yang terlibat:
                            </p>
                            {keys.map((k, i) => {
                              const competitionStudents = grouped[k];
                              const firstItem = competitionStudents[0];
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
                                      <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-black">{firstItem.statusPertandingan || 'KPM'}</span>
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
                            })}
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
                        
                        const keys = Object.keys(grouped).sort();

                        // If user selected a specific competition to drill down:
                        if (selectedPertandinganInModal) {
                          const students = grouped[selectedPertandinganInModal] || [];
                          const compInfo = students[0];
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
                                    <span className="bg-slate-800 text-white px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm">
                                      {compInfo?.statusPertandingan || 'KPM'}
                                    </span>
                                    <span className="bg-white border border-amber-500/30 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm">
                                      {selectedDashboardBahagian}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto">
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
                                      onClick={() => handleAddMoreToThisCompetition(selectedPertandinganInModal, selectedDashboardBahagian, compInfo?.peringkat, compInfo?.statusPertandingan)}
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
                                              s.pencapaian === 'Johan' ? 'bg-amber-100 text-amber-800 font-black' :
                                              s.pencapaian === 'Naib Johan' ? 'bg-slate-200 text-slate-800' :
                                              s.pencapaian === 'Ketiga' ? 'bg-orange-100 text-orange-800' :
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
                        if (keys.length === 0) {
                          return <div className="py-12 text-center text-slate-400 font-bold uppercase text-xs tracking-widest italic">Tiada Rekod Pertandingan</div>;
                        }
                        
                        return (
                          <div className="space-y-4">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                              Pilih satu pertandingan di bawah untuk menyemak senarai nama murid yang terlibat:
                            </p>
                            {keys.map((k, i) => {
                              const competitionStudents = grouped[k];
                              const firstItem = competitionStudents[0];
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
                                      <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-black">{firstItem.statusPertandingan || 'KPM'}</span>
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
                            })}
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

                {!editingId && (
                  <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-1 w-full sm:w-auto border border-slate-200 shrink-0">
                    <button 
                      type="button"
                      onClick={() => setKemasukanMode('individu')}
                      className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
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
                      className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
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

              <div className="bg-white border border-slate-200 px-4 py-2.5 rounded-2xl shadow-sm flex items-center gap-2 self-start sm:self-auto">
                <Trophy className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                  Sesi {selectedYear}
                </span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white p-4 md:p-6 rounded-[32px] shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-1 flex-wrap gap-3 w-full">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
                  <input 
                    type="text" 
                    placeholder="Cari murid, IC atau pertandingan..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500" 
                  />
                </div>
                <select 
                  onChange={(e) => setFilterAliran(e.target.value)} 
                  value={filterAliran} 
                  className="flex-1 md:flex-none bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold text-xs outline-none focus:border-amber-500 min-w-[140px] cursor-pointer"
                >
                  <option value="SEMUA">SEMUA ALIRAN</option>
                  {senaraiAliran.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
                </select>
                <select 
                  onChange={(e) => setFilterKelas(e.target.value)} 
                  value={filterKelas} 
                  className="flex-1 md:flex-none bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold text-xs outline-none focus:border-amber-500 min-w-[140px] cursor-pointer"
                >
                  <option value="SEMUA">SEMUA KELAS</option>
                  {senaraiKelas.map(k => <option key={k} value={k}>KELAS {k}</option>)}
                </select>
              </div>

              <div className="flex gap-3 w-full md:w-auto">
                <button 
                  onClick={exportExcel} 
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" /> EXCEL
                </button>
                <button 
                  onClick={exportPDF} 
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-rose-50 text-rose-700 px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-100 transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4" /> PDF
                </button>
              </div>
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
                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right rounded-tr-[32px]">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-20 text-center text-slate-300 font-black uppercase italic tracking-widest">
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
                        <div className="font-bold text-slate-700 text-xs uppercase max-w-[250px] truncate" title={r.pertandingan}>{r.pertandingan}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest truncate max-w-[150px]">{r.bahagian}</div>
                          <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest">{r.statusPertandingan || 'KPM'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-black text-xs text-slate-900 uppercase italic">{r.peringkat}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">{r.pencapaian}</div>
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
      </main>
    </div>
  );
}
