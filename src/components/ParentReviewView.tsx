import React, { useState, useMemo } from 'react';
import {
  Inbox, Share2, Code2, Copy, Check, RefreshCw, Eye, CheckCircle2, XCircle,
  Edit3, Trash2, ExternalLink, FileSpreadsheet, Paperclip, Clock, AlertTriangle,
  Link2, X, Loader2, ShieldCheck, Calendar, UserCheck, PlusCircle
} from 'lucide-react';
import {
  SheetConfig,
  ParentSubmission,
  generateParentAppsScriptCode,
  PARENT_REVIEW_TAB_NAME
} from '../lib/googleSheets';

interface ParentReviewViewProps {
  sheetConfig: SheetConfig | null;
  hasSheetToken: boolean;
  parentScriptUrl: string;
  onSaveParentScriptUrl: (url: string) => void;
  submissions: ParentSubmission[];
  reviewTabExists: boolean;
  busy: boolean;
  onRefresh: () => void;
  onEnsureReviewTab: () => void;
  onApprove: (sub: ParentSubmission) => void;
  onEditBeforeApprove: (sub: ParentSubmission) => void;
  onRejectOrDelete: (sub: ParentSubmission, action: 'reject' | 'delete') => void;
  onPreviewSurat: (info: { nama: string; data: string; pertandingan?: string; murid?: string }) => void;
  onOpenPreviewParentPortal: () => void;
  onOpenSheetModal: () => void;
  onGoogleSignIn: () => void;
  normalizeStatus: (status?: string) => 'KPM' | 'LUAR KPM (PENGIKTIRAFAN)' | 'LUAR KPM';
  getStatusBadgeClass: (status?: string) => string;
  formatTarikhPaparan: (jenisTarikh?: string, tarikhMula?: string, tarikhTamat?: string) => string;
}

export default function ParentReviewView({
  sheetConfig,
  hasSheetToken,
  parentScriptUrl,
  onSaveParentScriptUrl,
  submissions,
  reviewTabExists,
  busy,
  onRefresh,
  onEnsureReviewTab,
  onApprove,
  onEditBeforeApprove,
  onRejectOrDelete,
  onPreviewSurat,
  onOpenPreviewParentPortal,
  onOpenSheetModal,
  onGoogleSignIn,
  normalizeStatus,
  getStatusBadgeClass,
  formatTarikhPaparan
}: ParentReviewViewProps) {
  const [urlDraft, setUrlDraft] = useState(parentScriptUrl);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'MENUNGGU SEMAKAN' | 'DISAHKAN' | 'DITOLAK' | 'SEMUA'>('MENUNGGU SEMAKAN');

  const shareableParentLink = useMemo(() => {
    const cleanScript = (parentScriptUrl || '').trim();
    if (!cleanScript || typeof window === 'undefined') return '';
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?mod=ibubapa&ep=${encodeURIComponent(cleanScript)}`;
  }, [parentScriptUrl]);

  const counts = useMemo(() => {
    const menunggu = submissions.filter(s => s.statusSemakan === 'MENUNGGU SEMAKAN').length;
    const disahkan = submissions.filter(s => s.statusSemakan === 'DISAHKAN').length;
    const ditolak = submissions.filter(s => s.statusSemakan === 'DITOLAK').length;
    return { menunggu, disahkan, ditolak, semua: submissions.length };
  }, [submissions]);

  const filteredSubmissions = useMemo(() => {
    if (statusFilter === 'SEMUA') return submissions;
    return submissions.filter(s => s.statusSemakan === statusFilter);
  }, [submissions, statusFilter]);

  const appsScriptCode = useMemo(
    () => generateParentAppsScriptCode(sheetConfig?.spreadsheetId),
    [sheetConfig?.spreadsheetId]
  );

  const handleSaveUrl = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveParentScriptUrl(urlDraft.trim());
  };

  const handleCopyParentLink = () => {
    if (!shareableParentLink) return;
    navigator.clipboard.writeText(shareableParentLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleCopyScriptCode = () => {
    navigator.clipboard.writeText(appsScriptCode);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300 pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800 uppercase italic flex items-center gap-3">
            <Inbox className="w-7 h-7 text-amber-500 shrink-0" />
            <span>Semakan Kiriman Ibu Bapa</span>
          </h2>
          <p className="text-slate-500 font-bold text-xs tracking-wider uppercase mt-1">
            Portal Individu Ibu Bapa (0 Kuota Firebase) • Semak & Sahkan ke Rekod Rasmi Sekolah
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowScriptModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer"
          >
            <Code2 className="w-4 h-4" />
            <span>Kod & Panduan Apps Script</span>
          </button>

          <button
            type="button"
            onClick={onOpenPreviewParentPortal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer"
          >
            <Eye className="w-4 h-4 text-amber-400" />
            <span>Pratonton Borang Ibu Bapa</span>
          </button>
        </div>
      </div>

      {/* Card 1: Tetapan Pautan Portal Ibu Bapa */}
      <div className="bg-white rounded-[28px] p-5 sm:p-7 border border-slate-200/80 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-600 shrink-0">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-800 uppercase italic">
                1. Pautan Rasmi Portal Ibu Bapa (Apps Script)
              </h3>
              <p className="text-xs font-medium text-slate-500 mt-0.5">
                Ibu bapa mengisi borang individu sahaja tanpa log masuk. Data terus masuk ke tab <strong>"{PARENT_REVIEW_TAB_NAME}"</strong> & lampiran disimpan ke Google Drive.
              </p>
            </div>
          </div>

          <span className={`self-start sm:self-auto px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
            parentScriptUrl.trim()
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            {parentScriptUrl.trim() ? 'URL Skrip Ditetapkan' : 'Perlu URL Apps Script'}
          </span>
        </div>

        <form onSubmit={handleSaveUrl} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://script.google.com/macros/s/AKfycb.../exec"
            className="flex-1 px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-amber-500 focus:bg-white"
          />
          <button
            type="submit"
            className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shrink-0 shadow-xs"
          >
            Simpan URL Skrip
          </button>
        </form>

        {shareableParentLink ? (
          <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800 block">
                Pautan Khas Untuk Dikongsi Kepada Ibu Bapa (WhatsApp / Telegram Sekolah):
              </span>
              <p className="text-xs font-mono font-bold text-slate-800 truncate mt-1" title={shareableParentLink}>
                {shareableParentLink}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyParentLink}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider transition-all cursor-pointer shrink-0 shadow-xs"
            >
              {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedLink ? 'Pautan Disalin!' : 'Salin Pautan Ibu Bapa'}</span>
            </button>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-3 flex-wrap">
            <span>
              Belum ada URL Web App Apps Script. Tekan butang <strong>"Kod & Panduan Apps Script"</strong> di atas untuk dapatkan skrip siap pakai (3 langkah mudah).
            </span>
          </div>
        )}
      </div>

      {/* Card 2: Senarai Semakan Dari Tab "Semakan Ibu Bapa" */}
      <div className="bg-white rounded-[28px] p-5 sm:p-7 border border-slate-200/80 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm sm:text-base font-black text-slate-800 uppercase italic">
              2. Peti Masuk Kiriman Ibu Bapa ({counts.menunggu} Menunggu Semakan)
            </h3>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
              Sumber: Google Sheets Tab "{PARENT_REVIEW_TAB_NAME}"
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {sheetConfig && (
              <a
                href={sheetConfig.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Buka Google Sheet</span>
              </a>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={busy || !sheetConfig || !hasSheetToken}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span>Muat Semula</span>
            </button>
          </div>
        </div>

        {/* Status Sambungan Google Sheets */}
        {!sheetConfig ? (
          <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-3">
            <FileSpreadsheet className="w-10 h-10 text-slate-400 mx-auto" />
            <h4 className="text-sm font-black text-slate-800 uppercase">Google Sheets Belum Disambungkan</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Sila sambungkan fail Google Sheet sekolah terlebih dahulu supaya sistem boleh membaca kiriman daripada tab "{PARENT_REVIEW_TAB_NAME}".
            </p>
            <button
              type="button"
              onClick={onOpenSheetModal}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider cursor-pointer"
            >
              <Link2 className="w-4 h-4 text-emerald-400" />
              <span>Sambung Google Sheets</span>
            </button>
          </div>
        ) : !hasSheetToken ? (
          <div className="p-8 rounded-2xl bg-amber-50/80 border border-amber-200 text-center space-y-3">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <h4 className="text-sm font-black text-slate-900 uppercase">Log Masuk Google Diperlukan</h4>
            <p className="text-xs text-amber-900 max-w-md mx-auto">
              Sila log masuk dengan akaun Google guru untuk membaca kiriman ibu bapa dan mengesahkan rekod ke Google Sheet "{sheetConfig.spreadsheetTitle}".
            </p>
            <button
              type="button"
              onClick={onGoogleSignIn}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-black uppercase tracking-wider cursor-pointer shadow-xs"
            >
              <span>Sign in with Google</span>
            </button>
          </div>
        ) : !reviewTabExists ? (
          <div className="p-8 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-center space-y-3">
            <PlusCircle className="w-10 h-10 text-indigo-600 mx-auto" />
            <h4 className="text-sm font-black text-indigo-950 uppercase">
              Tab "{PARENT_REVIEW_TAB_NAME}" Belum Wujud dalam Google Sheet
            </h4>
            <p className="text-xs text-indigo-800 max-w-lg mx-auto">
              Klik butang di bawah untuk mencipta tab khas "{PARENT_REVIEW_TAB_NAME}" dalam Google Sheet "{sheetConfig.spreadsheetTitle}" dengan tajuk kolum yang lengkap secara automatik.
            </p>
            <button
              type="button"
              onClick={onEnsureReviewTab}
              disabled={busy}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
              <span>Cipta Tab "{PARENT_REVIEW_TAB_NAME}" Sekarang</span>
            </button>
          </div>
        ) : (
          <>
            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center gap-2">
              {([
                { key: 'MENUNGGU SEMAKAN', label: 'Menunggu Semakan', count: counts.menunggu, activeCls: 'bg-amber-500 text-slate-900' },
                { key: 'DISAHKAN', label: 'Disahkan', count: counts.disahkan, activeCls: 'bg-emerald-600 text-white' },
                { key: 'DITOLAK', label: 'Ditolak', count: counts.ditolak, activeCls: 'bg-rose-600 text-white' },
                { key: 'SEMUA', label: 'Semua Kiriman', count: counts.semua, activeCls: 'bg-slate-900 text-white' }
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer inline-flex items-center gap-2 ${
                    statusFilter === tab.key
                      ? tab.activeCls
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                    statusFilter === tab.key ? 'bg-black/15' : 'bg-white text-slate-700'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Submissions List */}
            {busy && submissions.length === 0 ? (
              <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                <span className="text-xs font-bold uppercase tracking-wider">Membaca kiriman ibu bapa daripada Google Sheets...</span>
              </div>
            ) : filteredSubmissions.length === 0 ? (
              <div className="py-12 px-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
                <Inbox className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-500">
                  Tiada rekod kiriman ibu bapa dalam kategori "{statusFilter}".
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredSubmissions.map(sub => {
                  const dateDisplay = formatTarikhPaparan(sub.jenisTarikh, sub.tarikhMula, sub.tarikhTamat);
                  const isRecognized = normalizeStatus(sub.statusPertandingan) === 'LUAR KPM (PENGIKTIRAFAN)';
                  return (
                    <div
                      key={`${sub.id}_${sub.rowIndex}`}
                      className="p-5 rounded-2xl border border-slate-200 bg-slate-50/60 hover:bg-white transition-all space-y-4 shadow-2xs"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                              sub.statusSemakan === 'DISAHKAN'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : sub.statusSemakan === 'DITOLAK'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}>
                              {sub.statusSemakan === 'DISAHKAN' ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : sub.statusSemakan === 'DITOLAK' ? (
                                <XCircle className="w-3 h-3" />
                              ) : (
                                <Clock className="w-3 h-3" />
                              )}
                              <span>{sub.statusSemakan}</span>
                            </span>

                            <span className="text-[10px] font-mono text-slate-400 font-bold">
                              Baris #{sub.rowIndex} • {sub.tarikhHantar || '-'}
                            </span>
                          </div>

                          <h4 className="text-base font-black text-slate-900 uppercase">
                            {sub.nama}
                          </h4>
                          <p className="text-xs font-bold text-slate-500">
                            {sub.aliran} ({sub.kelas}) {sub.noKp ? `• KP: ${sub.noKp}` : ''}
                          </p>
                        </div>

                        {sub.penjagaInfo && (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-700 self-start">
                            <UserCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Penjaga: {sub.penjagaInfo}</span>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 bg-white p-3.5 rounded-xl border border-slate-200/80 text-xs">
                        <div className="lg:col-span-2">
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Aktiviti / Pertandingan</span>
                          <span className="font-black text-slate-800">{sub.pertandingan}</span>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className="text-[10px] font-bold text-slate-500">{sub.bahagian}</span>
                            {dateDisplay && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                <Calendar className="w-3 h-3 text-amber-600" />
                                {dateDisplay}
                              </span>
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Status & Peringkat</span>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${getStatusBadgeClass(sub.statusPertandingan)}`}>
                              {normalizeStatus(sub.statusPertandingan)}
                            </span>
                            <span className="text-xs font-black text-slate-700">• {sub.peringkat}</span>
                          </div>
                        </div>

                        <div>
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Pencapaian ({sub.tahunKalendar})</span>
                          <span className="font-black text-amber-700 text-sm">{sub.pencapaian}</span>
                        </div>
                      </div>

                      {/* Footer Bar: Attachment + Action Buttons */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {sub.suratPengiktirafanData ? (
                            <button
                              type="button"
                              onClick={() => onPreviewSurat({
                                nama: sub.suratPengiktirafanNama || 'Surat Pengiktirafan KPM',
                                data: sub.suratPengiktirafanData,
                                pertandingan: sub.pertandingan,
                                murid: sub.nama
                              })}
                              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-800 text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                            >
                              <Paperclip className="w-3.5 h-3.5" />
                              <span>Lihat Surat Pengiktirafan</span>
                            </button>
                          ) : isRecognized ? (
                            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 inline-block">
                              Tiada Surat Pengiktirafan dimuat naik
                            </span>
                          ) : null}

                          {sub.sijilMuridData ? (
                            <button
                              type="button"
                              onClick={() => onPreviewSurat({
                                nama: sub.sijilMuridNama || 'Sijil Pencapaian / Penyertaan Murid',
                                data: sub.sijilMuridData,
                                pertandingan: sub.pertandingan,
                                murid: sub.nama
                              })}
                              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                            >
                              <Paperclip className="w-3.5 h-3.5" />
                              <span>Lihat Sijil Murid</span>
                            </button>
                          ) : (
                            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 inline-block">
                              Tiada Sijil Murid dimuat naik
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {sub.statusSemakan !== 'DISAHKAN' && (
                            <>
                              <button
                                type="button"
                                onClick={() => onApprove(sub)}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 shadow-xs"
                              >
                                <ShieldCheck className="w-4 h-4" />
                                <span>Sahkan & Terima</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onEditBeforeApprove(sub)}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:border-amber-500 hover:bg-amber-50 text-slate-800 text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit Dahulu</span>
                              </button>
                            </>
                          )}

                          {sub.statusSemakan === 'MENUNGGU SEMAKAN' && (
                            <button
                              type="button"
                              onClick={() => onRejectOrDelete(sub, 'reject')}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Tolak</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onRejectOrDelete(sub, 'delete')}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-rose-50 hover:border-rose-300 text-slate-500 hover:text-rose-700 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                            title="Padam baris daripada tab Semakan Ibu Bapa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Padam</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal: Kod & Panduan Pemasangan Google Apps Script */}
      {showScriptModal && (
        <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm z-[75] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-[28px] w-full max-w-3xl max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between gap-4 bg-indigo-50/70">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-600 text-white">
                  <Code2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 uppercase italic">
                    Panduan & Kod Google Apps Script (3 Langkah)
                  </h3>
                  <p className="text-[11px] font-bold text-indigo-700">
                    Menghantar kiriman ibu bapa terus ke Tab "{PARENT_REVIEW_TAB_NAME}" & Google Drive sekolah
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowScriptModal(false)}
                className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[10px] font-black text-indigo-600 uppercase">Langkah 1</span>
                  <p className="font-bold text-slate-800">Buka Apps Script</p>
                  <p className="text-slate-500 font-medium">
                    Dalam Google Sheet sekolah, klik menu <strong>Extensions &gt; Apps Script</strong>. Padam kod asal dan tampal kod di bawah.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[10px] font-black text-indigo-600 uppercase">Langkah 2</span>
                  <p className="font-bold text-slate-800">Deploy Web App</p>
                  <p className="text-slate-500 font-medium">
                    Klik <strong>Deploy &gt; New deployment &gt; Web app</strong>. Pilih Execute as: <strong>Me</strong> dan Who has access: <strong>Anyone</strong>.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[10px] font-black text-indigo-600 uppercase">Langkah 3</span>
                  <p className="font-bold text-slate-800">Tampal & Kongsi Pautan</p>
                  <p className="text-slate-500 font-medium">
                    Salin <strong>Web app URL</strong>, tampal di kotak atas, tekan Simpan, kemudian salin <strong>Pautan Ibu Bapa</strong> untuk WhatsApp.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Kod Skrip (Code.gs) {sheetConfig ? `• Dipautkan ke ID: ${sheetConfig.spreadsheetId}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyScriptCode}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-black uppercase tracking-wider cursor-pointer"
                  >
                    {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedScript ? 'Kod Disalin!' : 'Salin Semua Kod'}</span>
                  </button>
                </div>
                <pre className="p-4 rounded-2xl bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto max-h-80 leading-relaxed">
                  {appsScriptCode}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
