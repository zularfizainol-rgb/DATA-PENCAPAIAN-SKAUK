import React, { useState } from 'react';
import {
  Trophy, Users, Calendar, Upload, Eye, FileCheck2, Paperclip,
  Send, Loader2, CheckCircle2, AlertTriangle, ArrowLeft, PlusCircle, Phone, UserCheck
} from 'lucide-react';
import { submitParentEntryToAppsScript } from '../lib/googleSheets';

interface ParentPortalViewProps {
  appsScriptUrl: string;
  selectedYear: string;
  contohSuratUrl: string;
  senaraiBahagian: string[];
  senaraiPencapaian: string[];
  senaraiKelas: string[];
  senaraiPeringkat: string[];
  senaraiAliran: string[];
  senaraiStatusPertandingan: string[];
  normalizeStatus: (status?: string) => 'KPM' | 'LUAR KPM (PENGIKTIRAFAN)' | 'LUAR KPM';
  onPreviewSurat: (info: { nama: string; data: string; pertandingan?: string; murid?: string }) => void;
  onExitPreview?: () => void;
}

const MAX_PARENT_FILE_BYTES = 4 * 1024 * 1024; // 4 MB terus ke Google Drive melalui Apps Script

async function readFileForDrive(file: File): Promise<{
  fileName: string;
  fileMimeType: string;
  fileBase64: string;
  previewDataUrl: string;
}> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) {
    throw new Error('Format fail tidak disokong. Sila muat naik gambar (JPG/PNG) atau dokumen PDF sahaja.');
  }
  if (file.size > MAX_PARENT_FILE_BYTES) {
    throw new Error('Saiz fail melebihi had 4MB. Sila pilih fail yang lebih kecil.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca fail lampiran.'));
    reader.readAsDataURL(file);
  });

  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const mime = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');

  return {
    fileName: file.name,
    fileMimeType: mime,
    fileBase64: base64,
    previewDataUrl: dataUrl
  };
}

export default function ParentPortalView({
  appsScriptUrl,
  selectedYear,
  contohSuratUrl,
  senaraiBahagian,
  senaraiPencapaian,
  senaraiKelas,
  senaraiPeringkat,
  senaraiAliran,
  senaraiStatusPertandingan,
  normalizeStatus,
  onPreviewSurat,
  onExitPreview
}: ParentPortalViewProps) {
  const [submitting, setSubmitting] = useState(false);
  const [fileBusyTarget, setFileBusyTarget] = useState<'surat' | 'sijil' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedSummary, setSubmittedSummary] = useState<{
    id: string;
    nama: string;
    pertandingan: string;
    pencapaian: string;
    peringkat: string;
    fileUrl?: string;
    sijilUrl?: string;
  } | null>(null);

  const [form, setForm] = useState({
    nama: '',
    noKp: '',
    aliran: 'Tahun 1',
    kelas: 'UIAM',
    namaPenjaga: '',
    noTelefon: '',
    bahagian: 'Unit Beruniform',
    pertandingan: '',
    jenisTarikh: 'satu_hari' as 'satu_hari' | 'tempoh',
    tarikhMula: '',
    tarikhTamat: '',
    statusPertandingan: 'LUAR KPM (PENGIKTIRAFAN)',
    peringkat: 'Daerah',
    pencapaian: 'Penyertaan'
  });

  const [suratAttachment, setSuratAttachment] = useState<{
    fileName: string;
    fileMimeType: string;
    fileBase64: string;
    previewDataUrl: string;
  } | null>(null);

  const [sijilAttachment, setSijilAttachment] = useState<{
    fileName: string;
    fileMimeType: string;
    fileBase64: string;
    previewDataUrl: string;
  } | null>(null);

  const handleFileChange = async (target: 'surat' | 'sijil', file?: File) => {
    if (!file) return;
    setErrorMsg(null);
    setFileBusyTarget(target);
    try {
      const parsed = await readFileForDrive(file);
      if (target === 'surat') {
        setSuratAttachment(parsed);
      } else {
        setSijilAttachment(parsed);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membaca fail lampiran.');
    } finally {
      setFileBusyTarget(null);
    }
  };

  const resetForm = () => {
    setForm({
      nama: '',
      noKp: '',
      aliran: 'Tahun 1',
      kelas: 'UIAM',
      namaPenjaga: '',
      noTelefon: '',
      bahagian: 'Unit Beruniform',
      pertandingan: '',
      jenisTarikh: 'satu_hari',
    tarikhMula: '',
      tarikhTamat: '',
      statusPertandingan: 'LUAR KPM (PENGIKTIRAFAN)',
      peringkat: 'Daerah',
      pencapaian: 'Penyertaan'
    });
    setSuratAttachment(null);
    setSijilAttachment(null);
    setErrorMsg(null);
    setSubmittedSummary(null);
  };

  const parentStatusOptions = React.useMemo(() => {
    const allowed = senaraiStatusPertandingan.filter((s) => {
      const norm = normalizeStatus(s);
      return norm === 'LUAR KPM (PENGIKTIRAFAN)' || norm === 'LUAR KPM';
    });
    return allowed.length > 0 ? allowed : ['LUAR KPM (PENGIKTIRAFAN)', 'LUAR KPM'];
  }, [senaraiStatusPertandingan, normalizeStatus]);

  const isRecognized = normalizeStatus(form.statusPertandingan) === 'LUAR KPM (PENGIKTIRAFAN)';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!appsScriptUrl.trim()) {
      setErrorMsg('Pautan portal ini belum dipautkan kepada Apps Script sekolah. Sila hubungi guru penyelaras PAJSK untuk mendapatkan pautan rasmi.');
      return;
    }
    if (!form.nama.trim() || !form.pertandingan.trim() || !form.namaPenjaga.trim()) {
      setErrorMsg('Sila lengkapkan Nama Murid, Nama Ibu Bapa/Penjaga, dan Nama Aktiviti/Pertandingan.');
      return;
    }
    if (form.jenisTarikh === 'tempoh' && form.tarikhMula && form.tarikhTamat && form.tarikhTamat < form.tarikhMula) {
      setErrorMsg('Tarikh Tamat tidak boleh lebih awal daripada Tarikh Mula.');
      return;
    }
    if (isRecognized && !suratAttachment) {
      setErrorMsg('Sila muat naik 1. Surat Pengiktirafan Daripada KPM bagi status LUAR KPM (PENGIKTIRAFAN).');
      return;
    }
    if (!sijilAttachment) {
      setErrorMsg('Sila muat naik 2. Sijil Pencapaian / Sijil Penyertaan Murid sebelum menghantar.');
      return;
    }

    const penjagaCombined = form.noTelefon.trim()
      ? `${form.namaPenjaga.trim().toUpperCase()} (${form.noTelefon.trim()})`
      : form.namaPenjaga.trim().toUpperCase();

    setSubmitting(true);
    try {
      const result = await submitParentEntryToAppsScript(appsScriptUrl, {
        nama: form.nama.trim().toUpperCase(),
        noKp: form.noKp.trim(),
        aliran: form.aliran,
        kelas: form.kelas,
        bahagian: form.bahagian,
        pertandingan: form.pertandingan.trim().toUpperCase(),
        jenisTarikh: form.jenisTarikh,
        tarikhMula: form.tarikhMula.trim(),
        tarikhTamat: form.jenisTarikh === 'tempoh' ? form.tarikhTamat.trim() : '',
        statusPertandingan: form.statusPertandingan,
        peringkat: form.peringkat,
        pencapaian: form.pencapaian,
        tahunKalendar: selectedYear,
        penjagaInfo: penjagaCombined,
        fileName: suratAttachment?.fileName || '',
        fileMimeType: suratAttachment?.fileMimeType || '',
        fileBase64: suratAttachment?.fileBase64 || '',
        sijilFileName: sijilAttachment.fileName,
        sijilFileMimeType: sijilAttachment.fileMimeType,
        sijilFileBase64: sijilAttachment.fileBase64
      });

      setSubmittedSummary({
        id: result.id,
        nama: form.nama.trim().toUpperCase(),
        pertandingan: form.pertandingan.trim().toUpperCase(),
        pencapaian: form.pencapaian,
        peringkat: form.peringkat,
        fileUrl: result.fileUrl,
        sijilUrl: result.sijilUrl
      });
    } catch (err) {
      console.error('Parent submission error:', err);
      setErrorMsg(
        err instanceof Error
          ? `${err.message} Pastikan skrip Apps Script telah dideploy dengan akses "Anyone".`
          : 'Gagal menghantar maklumat. Sila semak sambungan internet dan cuba sebentar lagi.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-16">
      {/* Top School Header */}
      <header className="bg-slate-900 text-white shadow-lg">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="https://i.postimg.cc/x1yzrs3k/IMG-20220901-WA0001(1).jpg" className="w-10 h-10 object-contain bg-white rounded-lg p-0.5 shadow-sm" alt="Logo SKAU" />
            <img src="https://i.postimg.cc/bYsF95Q0/IMG-20220901-WA0002(1).jpg" className="w-10 h-10 object-contain bg-white rounded-lg p-0.5 shadow-sm" alt="Logo TS25" />
            <div>
              <h1 className="text-sm sm:text-base font-black tracking-tight italic uppercase leading-tight">
                PORTAL PENCAPAIAN MURID <span className="text-amber-500">SKAUK</span>
              </h1>
              <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mt-0.5">
                Kemasukan Khas Ibu Bapa / Penjaga (Individu) • Sesi {selectedYear}
              </p>
            </div>
          </div>

          {onExitPreview && (
            <button
              type="button"
              onClick={onExitPreview}
              className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-black uppercase tracking-wider cursor-pointer transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Kembali ke Mod Guru</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        {!appsScriptUrl.trim() && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 flex items-start gap-3 text-xs font-bold">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-black uppercase tracking-wider text-[11px]">Portal Belum Dipautkan</p>
              <p className="font-medium mt-1">
                Pautan Apps Script belum disertakan pada URL ini. Sila minta pautan rasmi daripada guru penyelaras PAJSK sekolah.
              </p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3 text-xs font-bold animate-in fade-in duration-200">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {submittedSummary ? (
          <div className="bg-white rounded-[32px] p-6 sm:p-10 shadow-xl border border-emerald-200 text-center space-y-6 animate-in fade-in duration-300">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 uppercase italic">
                Rekod Berjaya Dihantar!
              </h2>
              <p className="text-xs sm:text-sm font-medium text-slate-600 max-w-lg mx-auto leading-relaxed">
                Terima kasih. Maklumat pencapaian anak tuan/puan telah dihantar ke senarai semakan guru PAJSK SKAUK untuk pengesahan rasmi.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-left space-y-2.5 text-xs max-w-md mx-auto">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-bold uppercase text-[10px]">ID Rujukan:</span>
                <span className="font-mono font-black text-slate-700">{submittedSummary.id}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Nama Murid:</span>
                <span className="font-black text-slate-900 text-right">{submittedSummary.nama}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Aktiviti:</span>
                <span className="font-bold text-slate-800 text-right">{submittedSummary.pertandingan}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Pencapaian:</span>
                <span className="font-black text-amber-700 text-right">{submittedSummary.pencapaian} ({submittedSummary.peringkat})</span>
              </div>
              {submittedSummary.fileUrl && (
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                  <span className="text-indigo-700 font-black uppercase text-[10px]">1. Surat Pengiktirafan:</span>
                  <span className="text-emerald-700 font-bold">✓ Disimpan ke Google Drive</span>
                </div>
              )}
              {submittedSummary.sijilUrl && (
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                  <span className="text-emerald-700 font-black uppercase text-[10px]">2. Sijil Murid:</span>
                  <span className="text-emerald-700 font-bold">✓ Disimpan ke Google Drive</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-black uppercase tracking-widest shadow-lg transition-all cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Hantar Pencapaian Lain</span>
            </button>
          </div>
        ) : (
          <div className="bg-white p-5 sm:p-8 rounded-[32px] shadow-xl border border-slate-200/80 space-y-6">
            <div className="pb-4 border-b border-slate-100">
              <h2 className="text-lg sm:text-xl font-black text-slate-800 uppercase italic">
                Borang Daftar Pencapaian Murid (Individu)
              </h2>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                Sila isi maklumat pencapaian anak tuan/puan dengan tepat. Rekod akan disemak oleh guru sebelum dimasukkan ke rekod rasmi sekolah.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Kad 1: Maklumat Murid & Penjaga */}
              <div className="bg-slate-50/80 border border-slate-200/80 p-5 sm:p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/60">
                  <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 uppercase italic text-sm">1. Maklumat Murid & Penjaga</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Butiran murid dan maklumat ibu bapa untuk semakan guru</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Nama Penuh Murid *</label>
                    <input
                      required
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-black text-xs outline-none focus:border-amber-500"
                      value={form.nama}
                      onChange={(e) => setForm(prev => ({ ...prev, nama: e.target.value.toUpperCase() }))}
                      placeholder="NAMA PENUH SEPERTI DALAM MYKID"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">No. KP / MyKid (Tanpa '-')</label>
                    <input
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500"
                      value={form.noKp}
                      onChange={(e) => setForm(prev => ({ ...prev, noKp: e.target.value.replace(/\D/g, '') }))}
                      placeholder="CONTOH: 150101101234"
                      maxLength={12}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Aliran</label>
                    <select
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500"
                      value={form.aliran}
                      onChange={(e) => setForm(prev => ({ ...prev, aliran: e.target.value }))}
                    >
                      {senaraiAliran.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Kelas</label>
                    <select
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500"
                      value={form.kelas}
                      onChange={(e) => setForm(prev => ({ ...prev, kelas: e.target.value }))}
                    >
                      {senaraiKelas.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5 text-amber-600" />
                      <span>Nama Ibu Bapa / Penjaga *</span>
                    </label>
                    <input
                      required
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500"
                      value={form.namaPenjaga}
                      onChange={(e) => setForm(prev => ({ ...prev, namaPenjaga: e.target.value.toUpperCase() }))}
                      placeholder="NAMA IBU / BAPA / PENJAGA"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-amber-600" />
                      <span>No. Telefon (Untuk Hubungan Guru)</span>
                    </label>
                    <input
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500"
                      value={form.noTelefon}
                      onChange={(e) => setForm(prev => ({ ...prev, noTelefon: e.target.value.replace(/[^0-9+\-\s]/g, '') }))}
                      placeholder="CONTOH: 0123456789"
                    />
                  </div>
                </div>
              </div>

              {/* Kad 2: Maklumat Aktiviti & Pencapaian */}
              <div className="bg-slate-50/80 border border-slate-200/80 p-5 sm:p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/60">
                  <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
                    <Trophy className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 uppercase italic text-sm">2. Maklumat Aktiviti & Pencapaian</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tarikh, status pengiktirafan dan pencapaian murid</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Bahagian</label>
                    <select
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500"
                      value={form.bahagian}
                      onChange={(e) => setForm(prev => ({ ...prev, bahagian: e.target.value }))}
                    >
                      {senaraiBahagian.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Nama Aktiviti / Pertandingan *</label>
                    <input
                      required
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-black text-xs outline-none focus:border-amber-500"
                      value={form.pertandingan}
                      onChange={(e) => setForm(prev => ({ ...prev, pertandingan: e.target.value.toUpperCase() }))}
                      placeholder="CONTOH: KEJOHANAN TAEKWONDO KEBANGSAAN"
                    />
                  </div>

                  {/* Tarikh Aktiviti */}
                  <div className="md:col-span-2 bg-white border-2 border-slate-200/90 rounded-2xl p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="text-[10px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-amber-500" />
                        <span>Tarikh Aktiviti / Pertandingan</span>
                      </label>
                      <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-auto">
                        <button
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, jenisTarikh: 'satu_hari', tarikhTamat: '' }))}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            form.jenisTarikh === 'satu_hari'
                              ? 'bg-amber-500 text-slate-900 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          Satu Hari
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, jenisTarikh: 'tempoh' }))}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            form.jenisTarikh === 'tempoh'
                              ? 'bg-amber-500 text-slate-900 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          Tempoh Masa
                        </button>
                      </div>
                    </div>

                    {form.jenisTarikh === 'satu_hari' ? (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pilih Tarikh Aktiviti</span>
                        <input
                          type="date"
                          value={form.tarikhMula}
                          onChange={(e) => setForm(prev => ({ ...prev, tarikhMula: e.target.value, tarikhTamat: '' }))}
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tarikh Mula</span>
                          <input
                            type="date"
                            value={form.tarikhMula}
                            onChange={(e) => setForm(prev => ({ ...prev, tarikhMula: e.target.value }))}
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tarikh Tamat</span>
                          <input
                            type="date"
                            min={form.tarikhMula || undefined}
                            value={form.tarikhTamat}
                            onChange={(e) => setForm(prev => ({ ...prev, tarikhTamat: e.target.value }))}
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-500 focus:bg-white"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Status Pertandingan</label>
                    <select
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500"
                      value={form.statusPertandingan}
                      onChange={(e) => setForm(prev => ({ ...prev, statusPertandingan: e.target.value }))}
                    >
                      {parentStatusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Peringkat</label>
                    <select
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500"
                      value={form.peringkat}
                      onChange={(e) => setForm(prev => ({ ...prev, peringkat: e.target.value }))}
                    >
                      {senaraiPeringkat.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  {/* Lampiran 1 (Asing): Surat Pengiktirafan Daripada KPM */}
                  <div className="md:col-span-2 bg-indigo-50/80 border-2 border-indigo-200 rounded-2xl p-4 sm:p-5 space-y-3 animate-in fade-in duration-200">
                    <div className="flex items-start gap-2.5">
                      <div className="p-2 bg-indigo-600 text-white rounded-xl shrink-0">
                        <Paperclip className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                          {isRecognized
                            ? '1. Lampiran Surat Pengiktirafan Daripada KPM *'
                            : '1. Lampiran Surat Pengiktirafan (Jika Ada / Pilihan)'}
                        </h4>
                        <p className="text-[11px] font-medium text-indigo-700 mt-0.5">
                          {isRecognized
                            ? 'Wajib muat naik salinan surat pengiktirafan daripada KPM (Gambar JPG/PNG atau PDF sehingga 4MB). Fail disimpan terus ke Google Drive sekolah.'
                            : 'Jika pertandingan ini mempunyai surat pengiktirafan atau surat kelulusan penganjur, anda boleh muat naik di sini (JPG/PNG atau PDF sehingga 4MB).'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-wrap">
                      <label className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs ${
                        fileBusyTarget === 'surat'
                          ? 'bg-indigo-300 text-white pointer-events-none'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      }`}>
                        {fileBusyTarget === 'surat' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        <span>{suratAttachment ? 'Tukar Surat Pengiktirafan' : 'Muat Naik Surat Pengiktirafan'}</span>
                        <input
                          type="file"
                          accept="image/*,.pdf,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            handleFileChange('surat', file);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => onPreviewSurat({
                          nama: 'Contoh Surat Pengiktirafan KPM (BSKK).jpg',
                          data: contohSuratUrl,
                          pertandingan: 'Rujukan Format Surat Pengiktirafan KPM'
                        })}
                        className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white hover:bg-amber-50 border border-indigo-200 hover:border-amber-400 text-left transition-all cursor-pointer shadow-xs group"
                        title="Klik untuk besarkan contoh surat pengiktirafan KPM"
                      >
                        <img
                          src={contohSuratUrl}
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

                      {suratAttachment && (
                        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px] bg-white border border-indigo-200 px-3 py-2 rounded-xl">
                          <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="text-xs font-bold text-slate-700 truncate max-w-[180px]" title={suratAttachment.fileName}>
                            {suratAttachment.fileName}
                          </span>
                          <div className="flex items-center gap-1.5 ml-auto">
                            <button
                              type="button"
                              onClick={() => onPreviewSurat({
                                nama: suratAttachment.fileName,
                                data: suratAttachment.previewDataUrl,
                                pertandingan: form.pertandingan,
                                murid: form.nama
                              })}
                              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Lihat</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSuratAttachment(null)}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                            >
                              Buang
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Lampiran 2 (Asing): Sijil Pencapaian / Sijil Penyertaan Murid */}
                  <div className="md:col-span-2 bg-emerald-50/80 border-2 border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-3 animate-in fade-in duration-200">
                    <div className="flex items-start gap-2.5">
                      <div className="p-2 bg-emerald-600 text-white rounded-xl shrink-0">
                        <FileCheck2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-emerald-950 uppercase tracking-wider">
                          2. Lampiran Sijil Pencapaian / Sijil Penyertaan Murid *
                        </h4>
                        <p className="text-[11px] font-medium text-emerald-800 mt-0.5">
                          Wajib muat naik salinan sijil pencapaian atau sijil penyertaan murid (Gambar JPG/PNG atau PDF sehingga 4MB). Fail disimpan terus ke Google Drive sekolah.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-wrap">
                      <label className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs ${
                        fileBusyTarget === 'sijil'
                          ? 'bg-emerald-300 text-white pointer-events-none'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}>
                        {fileBusyTarget === 'sijil' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        <span>{sijilAttachment ? 'Tukar Sijil Murid' : 'Muat Naik Sijil Murid'}</span>
                        <input
                          type="file"
                          accept="image/*,.pdf,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            handleFileChange('sijil', file);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>

                      {sijilAttachment && (
                        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px] bg-white border border-emerald-200 px-3 py-2 rounded-xl">
                          <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="text-xs font-bold text-slate-700 truncate max-w-[180px]" title={sijilAttachment.fileName}>
                            {sijilAttachment.fileName}
                          </span>
                          <div className="flex items-center gap-1.5 ml-auto">
                            <button
                              type="button"
                              onClick={() => onPreviewSurat({
                                nama: sijilAttachment.fileName,
                                data: sijilAttachment.previewDataUrl,
                                pertandingan: form.pertandingan,
                                murid: form.nama
                              })}
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Lihat</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSijilAttachment(null)}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                            >
                              Buang
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Pencapaian</label>
                    <select
                      className="w-full p-3.5 bg-white border-2 border-slate-200 rounded-xl font-bold text-xs outline-none cursor-pointer focus:border-amber-500"
                      value={form.pencapaian}
                      onChange={(e) => setForm(prev => ({ ...prev, pencapaian: e.target.value }))}
                    >
                      {senaraiPencapaian.map(pen => <option key={pen} value={pen}>{pen}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full p-4 bg-amber-500 hover:bg-amber-400 text-slate-900 font-black rounded-2xl uppercase tracking-widest text-xs shadow-xl shadow-amber-500/15 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin w-4 h-4" />
                    <span>Menghantar ke Senarai Semakan Guru...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Hantar Pencapaian untuk Semakan Guru</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
