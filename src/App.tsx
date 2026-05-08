import React, { useState, useEffect, useMemo } from 'react';
import {
  Loader2, LayoutDashboard, PlusCircle, Users, Trophy, GraduationCap,
  PieChart, X, Save, Search, FileSpreadsheet, FileText, Award, Edit3, Trash2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  db, 
  collection, doc, setDoc, onSnapshot, query, 
  serverTimestamp, deleteDoc
} from './lib/firebase';

const senaraiBahagian = ["Unit Beruniform", "Kelab & Persatuan", "Sukan & Permainan", "Ko-akademik BM", "Ko-akademik BI", "STEM", "Kesenian / Kebudayaan"];
const senaraiPencapaian = ["Penyertaan", "Kelima", "Keempat", "Ketiga", "Naib Johan", "Johan"];
const senaraiKelas = ["UIAM", "UM", "USM", "UPM", "UKM", "UTM", "UUM", "UITM", "USIM", "UPSI", "UNISZA"];
const senaraiPeringkat = ["Antarabangsa", "Kebangsaan", "Negeri", "Daerah"];
const senaraiAliran = ["Tahun 1", "Tahun 2", "Tahun 3", "Tahun 4", "Tahun 5", "Tahun 6"];

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

export default function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'kemasukan' | 'senarai'>('dashboard');
  const [rekodPajsk, setRekodPajsk] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAliran, setFilterAliran] = useState('SEMUA');
  const [filterKelas, setFilterKelas] = useState('SEMUA');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [selectedDashboardPeringkat, setSelectedDashboardPeringkat] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    nama: '', noKp: '', aliran: 'Tahun 1', kelas: 'UIAM',
    bahagian: 'Unit Beruniform', pertandingan: '', 
    statusPertandingan: 'KPM', peringkat: 'Daerah', pencapaian: 'Penyertaan',
    creatorId: ''
  });

  useEffect(() => {
    const q = query(collection(db, 'pencapaian'));
    const unsubscribeSnap = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RecordData[];
      setRekodPajsk(data);
      setLoading(false);
    }, (err) => {
      console.error("Firestore error:", err);
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
      nama: '', noKp: '', aliran: 'Tahun 1', kelas: 'UIAM',
      bahagian: 'Unit Beruniform', pertandingan: '', 
      statusPertandingan: 'KPM', peringkat: 'Daerah', pencapaian: 'Penyertaan',
      creatorId: ''
    });
  };

  const updateFormData = (key: string, val: string) => {
    setFormData(prev => ({ ...prev, [key]: val }));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setSaving(true);
    try {
      const id = editingId || Math.random().toString(36).substring(2, 15);
      
      const payload = {
        nama: formData.nama,
        noKp: formData.noKp || '',
        aliran: formData.aliran,
        kelas: formData.kelas,
        bahagian: formData.bahagian,
        pertandingan: formData.pertandingan,
        statusPertandingan: formData.statusPertandingan,
        peringkat: formData.peringkat,
        pencapaian: formData.pencapaian,
        tahunKalendar: selectedYear,
        creatorId: editingId ? formData.creatorId : 'public_user',
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, 'pencapaian', id), payload, { merge: true });
      
      resetFormData();
      setEditingId(null);
      switchView('senarai');
    } catch (error) {
      console.error("Error saving data:", error);
      alert("Terdapat ralat semasa menyimpan data. Jika menggunakan akaun log masuk baru, sila refresh applıkasi.");
    } finally {
      setSaving(false);
    }
  };

  const editRekod = (id: string) => {
    const item = rekodPajsk.find(r => r.id === id);
    if (item) {
      setFormData({
        nama: item.nama, noKp: item.noKp, aliran: item.aliran, kelas: item.kelas,
        bahagian: item.bahagian, pertandingan: item.pertandingan,
        statusPertandingan: item.statusPertandingan, peringkat: item.peringkat, pencapaian: item.pencapaian,
        creatorId: item.creatorId || ''
      });
      setEditingId(id);
      setActiveView('kemasukan');
    }
  };

  const deleteRekod = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'pencapaian', id));
      setDeleteConfirmId(null);
    } catch (error) {
      console.error("Error deleting record:", error);
      alert("Ralat semasa memadam.");
    }
  };

  const exportExcel = () => {
    const dataToExport = filteredData.map((r, i) => ({
      'BIL': i + 1,
      'NAMA MURID': r.nama,
      'NO KP': r.noKp,
      'ALIRAN': r.aliran,
      'KELAS': r.kelas,
      'BAHAGIAN': r.bahagian,
      'PERTANDINGAN': r.pertandingan,
      'STATUS': r.statusPertandingan,
      'PERINGKAT': r.peringkat,
      'PENCAPAIAN': r.pencapaian
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `REKOD_SKAUK_${selectedYear}.xlsx`);
  };

  const exportPDF = () => {
    const docPdf = new jsPDF('l', 'mm', 'a4');
    docPdf.setFontSize(14).text(`LAPORAN PENCAPAIAN SKAUK ${selectedYear}`, 14, 15);
    const body = filteredData.map((r, i) => [i + 1, r.nama, `${r.aliran}/${r.kelas}`, r.bahagian, r.pertandingan, r.statusPertandingan, r.peringkat, r.pencapaian]);
    
    autoTable(docPdf, {
      startY: 20,
      head: [['BIL', 'NAMA', 'KELAS', 'BAHAGIAN', 'AKTIVITI', 'STATUS', 'PERINGKAT', 'PENCAPAIAN']],
      body: body,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42] }
    });
    docPdf.save(`LAPORAN_SKAUK_${selectedYear}.pdf`);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-amber-500 w-12 h-12" />
          <p className="text-slate-400 font-black text-[10px] tracking-widest uppercase">Memuatkan Data Awan...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans flex flex-col lg:flex-row">
      <nav className="w-full lg:w-72 bg-slate-900 text-white p-6 flex flex-col shadow-2xl z-20 sticky top-0 lg:h-screen transition-all">
        <div className="flex flex-col gap-6 mb-10 px-2">
          <div className="flex items-center gap-3">
            <img src="https://i.postimg.cc/x1yzrs3k/IMG-20220901-WA0001(1).jpg" className="w-12 h-12 object-contain bg-white rounded-lg p-0.5" alt="Logo SKAU" />
            <img src="https://i.postimg.cc/bYsF95Q0/IMG-20220901-WA0002(1).jpg" className="w-12 h-12 object-contain bg-white rounded-lg p-0.5" alt="Logo TS25" />
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-amber-500 p-2 rounded-lg shrink-0 text-slate-900"><Trophy className="w-5 h-5" /></div>
            <h1 className="text-base font-black tracking-tight italic uppercase leading-tight">
              DATA PENCAPAIAN<br/><span className="text-amber-500">SKAUK</span>
            </h1>
          </div>
        </div>

        <div className="space-y-1 flex-1">
          <button onClick={() => switchView('dashboard')} className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all ${activeView === 'dashboard' ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:bg-white/5'}`}>
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-sm font-semibold">Dashboard</span>
          </button>
          <button onClick={() => switchView('kemasukan')} className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all ${activeView === 'kemasukan' ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:bg-white/5'}`}>
            <PlusCircle className="w-5 h-5" />
            <span className="text-sm font-semibold">Daftar Baru</span>
          </button>
          <button onClick={() => switchView('senarai')} className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all ${activeView === 'senarai' ? 'bg-amber-500 text-slate-900 font-black shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:bg-white/5'}`}>
            <Users className="w-5 h-5" />
            <span className="text-sm font-semibold">Rekod Murid</span>
          </button>
        </div>
        
        <div className="mt-auto pt-6 border-t border-white/10 text-[10px] text-slate-500 font-bold uppercase tracking-widest text-center flex flex-col items-center gap-2">
          <span>Storan Awan Aktif <span className="text-emerald-500">●</span></span>
        </div>
      </nav>

      <main className="flex-1 p-4 md:p-8 lg:h-screen lg:overflow-y-auto w-full max-w-full">
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
                  <p className="text-slate-500 font-bold text-xs tracking-widest uppercase">Statistik Keseluruhan Sesi {selectedYear}</p>
                </div>
                <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="bg-white border-2 border-slate-200 px-6 py-3 rounded-2xl font-black outline-none focus:border-amber-500 shadow-sm cursor-pointer">
                  <option value="2023">TAHUN 2023</option>
                  <option value="2024">TAHUN 2024</option>
                  <option value="2025">TAHUN 2025</option>
                  <option value="2026">TAHUN 2026</option>
                  <option value="2027">TAHUN 2027</option>
                  <option value="2028">TAHUN 2028</option>
                </select>
              </div>

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
                        onClick={() => setSelectedDashboardPeringkat(p)}
                        className="bg-white rounded-[32px] p-6 border border-slate-100 shadow-sm flex flex-col justify-center cursor-pointer hover:border-amber-500 hover:shadow-md transition-all group"
                      >
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-amber-500 transition-colors">{p}</p>
                        <h4 className="text-4xl font-black text-slate-800 italic group-hover:scale-105 transition-transform origin-left">{count}</h4>
                      </div>
                    );
                  })}
                </div>
              </div>

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
                                <span className="text-slate-900">{count}</span>
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

              <div className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-sm">
                <div className="flex items-center gap-3 mb-8">
                  <div className="p-2 bg-amber-100 rounded-lg text-amber-600"><PieChart className="w-5 h-5" /></div>
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest">Analisis Mengikut Bahagian</h4>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
                  {senaraiBahagian.map(b => (
                    <div key={b} className="p-5 rounded-3xl bg-slate-50 border border-slate-100 hover:border-amber-200 transition-colors">
                      <div className="text-[8px] font-black text-slate-400 uppercase mb-2 leading-tight h-8">{b}</div>
                      <div className="text-2xl font-black text-slate-800">{statsBahagian[b]}</div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedDashboardPeringkat && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
                  <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                    <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <div>
                        <h3 className="text-xl font-black text-slate-800 uppercase italic">Senarai Pertandingan</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                          Peringkat {selectedDashboardPeringkat} ({selectedYear})
                        </p>
                      </div>
                      <button onClick={() => setSelectedDashboardPeringkat(null)} className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 rounded-full transition-colors">
                        <X className="w-6 h-6" />
                      </button>
                    </div>
                    <div className="p-6 md:p-8 overflow-y-auto flex-1">
                      {(() => {
                        const filteredList = statsDashboard.filter(r => r.peringkat === selectedDashboardPeringkat);
                        const grouped = filteredList.reduce((acc, curr) => {
                          const key = curr.pertandingan.trim().toUpperCase();
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(curr);
                          return acc;
                        }, {} as Record<string, typeof filteredList>);
                        
                        const keys = Object.keys(grouped).sort();
                        
                        if (keys.length === 0) {
                          return <div className="py-12 text-center text-slate-400 font-bold uppercase text-xs tracking-widest italic">Tiada Rekod Pertandingan</div>;
                        }
                        
                        return (
                          <div className="space-y-4">
                            {keys.map((k, i) => (
                              <div key={i} className="flex justify-between items-center p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-amber-300 transition-colors">
                                <div>
                                  <div className="font-bold text-slate-800 text-xs md:text-sm">{k}</div>
                                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
                                    {grouped[k][0].bahagian}
                                  </div>
                                </div>
                                <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-sm shrink-0">
                                  <Users className="w-3 h-3 text-slate-400" />
                                  <span className="text-xs font-black text-amber-600">{grouped[k].length} murid</span>
                                </div>
                              </div>
                            ))}
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


        {activeView === 'kemasukan' && (
          <div className="max-w-4xl mx-auto animate-in slide-in-from-bottom-6 duration-500">
            <div className="bg-white p-6 md:p-12 rounded-[48px] shadow-xl border border-slate-100">
              <div className="flex justify-between items-center mb-10">
                <div>
                  <h2 className="text-2xl font-black text-slate-800 uppercase italic">{editingId ? 'Kemaskini Data Murid' : 'Daftar Pencapaian Baru'}</h2>
                  <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">
                    {editingId ? 'Sila kemaskini maklumat murid' : 'Isi maklumat pencapaian murid dengan tepat (Disimpan ke Awan)'}
                  </p>
                </div>
                <button onClick={() => switchView('senarai')} className="text-slate-300 hover:text-red-500 transition-colors">
                  <X className="w-8 h-8" />
                </button>
              </div>
              
              <form onSubmit={handleFormSubmit} className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-6 md:p-8 rounded-[32px]">
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nama Penuh Murid</label>
                    <input required className="w-full p-5 bg-white border-2 border-slate-100 rounded-2xl font-black outline-none focus:border-amber-500" value={formData.nama} onChange={(e) => updateFormData('nama', e.target.value.toUpperCase())} placeholder="NAMA PENUH" />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">No. KP / MyKid (Tanpa '-')</label>
                    <input className="w-full p-5 bg-white border-2 border-slate-100 rounded-2xl font-black outline-none focus:border-amber-500" value={formData.noKp} onChange={(e) => updateFormData('noKp', e.target.value.replace(/\D/g, ''))} placeholder="CONTOH: 120101101234" maxLength={12} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Aliran</label>
                    <select className="w-full p-5 bg-white border-2 border-slate-100 rounded-2xl font-black outline-none cursor-pointer" value={formData.aliran} onChange={(e) => updateFormData('aliran', e.target.value)}>
                      {senaraiAliran.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Kelas</label>
                    <select className="w-full p-5 bg-white border-2 border-slate-100 rounded-2xl font-black outline-none cursor-pointer" value={formData.kelas} onChange={(e) => updateFormData('kelas', e.target.value)}>
                      {senaraiKelas.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-2">
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Bahagian</label>
                    <select className="w-full p-5 bg-slate-100 border-2 border-transparent rounded-2xl font-black outline-none cursor-pointer" value={formData.bahagian} onChange={(e) => updateFormData('bahagian', e.target.value)}>
                      {senaraiBahagian.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nama Aktiviti / Pertandingan</label>
                    <input required className="w-full p-5 bg-slate-100 border-2 border-transparent rounded-2xl font-black outline-none focus:border-amber-500" value={formData.pertandingan} onChange={(e) => updateFormData('pertandingan', e.target.value.toUpperCase())} placeholder="CONTOH: KEJOHANAN BOLA SEPAK" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Peringkat</label>
                    <select className="w-full p-5 bg-slate-100 border-2 border-transparent rounded-2xl font-black outline-none cursor-pointer" value={formData.peringkat} onChange={(e) => updateFormData('peringkat', e.target.value)}>
                      {senaraiPeringkat.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Pencapaian</label>
                    <select className="w-full p-5 bg-slate-100 border-2 border-transparent rounded-2xl font-black outline-none cursor-pointer" value={formData.pencapaian} onChange={(e) => updateFormData('pencapaian', e.target.value)}>
                      {senaraiPencapaian.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Status Pertandingan</label>
                    <select className="w-full p-5 bg-slate-100 border-2 border-transparent rounded-2xl font-black outline-none cursor-pointer" value={formData.statusPertandingan} onChange={(e) => updateFormData('statusPertandingan', e.target.value)}>
                      <option value="KPM">KPM</option>
                      <option value="LUAR KPM">LUAR KPM</option>
                      <option value="LUAR KPM (PENGIKTIRAFAN)">LUAR KPM (PENGIKTIRAFAN)</option>
                    </select>
                  </div>
                </div>

                <button disabled={saving} type="submit" className="w-full py-6 bg-slate-900 text-amber-500 rounded-[32px] font-black text-lg shadow-xl hover:bg-slate-800 flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                  {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Save className="w-6 h-6" />}
                  {saving ? 'SEDANG MENYIMPAN...' : (editingId ? 'SIMPAN PERUBAHAN' : 'SIMPAN REKOD')}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeView === 'senarai' && (
          <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 pb-20">
            <header className="bg-white p-6 md:p-8 rounded-[40px] shadow-sm border border-slate-100 flex flex-col xl:flex-row justify-between gap-6">
              <div className="flex-1">
                <h2 className="text-2xl font-black text-slate-800 uppercase italic leading-none">Senarai Rekod Murid</h2>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">{filteredData.length} Rekod Semasa (Sesi {selectedYear})</p>
                </div>
              </div>
              
              <div className="w-full xl:w-auto relative min-w-[300px]">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 w-5 h-5" />
                <input placeholder="Cari nama, KP atau aktiviti..." onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:border-amber-500 text-sm" value={searchTerm} />
              </div>
            </header>

            <div className="bg-white p-4 md:p-6 rounded-[32px] shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-wrap gap-3 w-full md:w-auto">
                <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="flex-1 md:flex-none bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-3 rounded-xl font-black text-xs outline-none focus:border-indigo-500 min-w-[140px] cursor-pointer">
                  <option value="2023">TAHUN 2023</option>
                  <option value="2024">TAHUN 2024</option>
                  <option value="2025">TAHUN 2025</option>
                  <option value="2026">TAHUN 2026</option>
                  <option value="2027">TAHUN 2027</option>
                  <option value="2028">TAHUN 2028</option>
                </select>
                <select onChange={(e) => setFilterAliran(e.target.value)} value={filterAliran} className="flex-1 md:flex-none bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold text-xs outline-none focus:border-amber-500 min-w-[140px] cursor-pointer">
                  <option value="SEMUA">SEMUA ALIRAN</option>
                  {senaraiAliran.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
                </select>
                <select onChange={(e) => setFilterKelas(e.target.value)} value={filterKelas} className="flex-1 md:flex-none bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold text-xs outline-none focus:border-amber-500 min-w-[140px] cursor-pointer">
                  <option value="SEMUA">SEMUA KELAS</option>
                  {senaraiKelas.map(k => <option key={k} value={k}>KELAS {k}</option>)}
                </select>
              </div>

              <div className="flex gap-3 w-full md:w-auto">
                <button onClick={exportExcel} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-100">
                  <FileSpreadsheet className="w-4 h-4" /> EXCEL
                </button>
                <button onClick={exportPDF} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-rose-50 text-rose-700 px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-100">
                  <FileText className="w-4 h-4" /> PDF
                </button>
              </div>
            </div>

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
                              <button onClick={() => deleteRekod(r.id)} className="p-2.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-red-700 transition-all">Sah Padam</button>
                              <button onClick={() => setDeleteConfirmId(null)} className="p-2.5 bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-300 transition-all">Batal</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirmId(r.id)} title="Padam Rekod" className="p-2.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-xl transition-all flex items-center justify-center">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => editRekod(r.id)} title="Edit Rekod" className="p-2.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-xl transition-all flex items-center justify-center gap-2">
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
