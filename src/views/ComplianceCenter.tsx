import React, { useState, useEffect } from 'react';
import { TopNav } from '../components/TopNav';
import { 
  Gavel, 
  ShieldCheck, 
  FileText, 
  AlertTriangle, 
  CheckCircle2,
  Clock,
  Download,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { fetchComplianceData, ComplianceData } from '../services/complianceService';

export function ComplianceCenter() {
  const { t } = useLanguage();
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchComplianceData().then(result => {
      setData(result);
      setLoading(false);
    });
  }, []);

  const handleExport = () => {
    if (!data || !data.auditLogs || data.auditLogs.length === 0) return;

    const headers = ['Título', 'Descripción', 'Fecha'];
    const csvContent = [
      headers.join(','),
      ...data.auditLogs.map(log => [
        `"${(log.title || '').replace(/"/g, '""')}"`,
        `"${(log.description || '').replace(/"/g, '""')}"`,
        `"${log.created_at}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `compliance_audit_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  if (!data) return <div>Error loading compliance data</div>;

  return (
    <>
      <TopNav title="SafePickup" subtitle={t('compliance.title')} />
      
      <div className="p-6 max-w-7xl mx-auto space-y-6 w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-black text-primary tracking-tight">{t('compliance.title')}</h1>
            <p className="text-sm text-slate-500 font-medium">{t('compliance.subtitle')}</p>
          </div>
          <button onClick={handleExport} className="flex items-center gap-2 bg-surface-container-high text-primary px-4 py-2 rounded-xl font-bold text-sm hover:bg-surface-variant transition-colors shadow-sm border border-outline-variant/20">
            <Download className="w-4 h-4" />
            {t('compliance.exportReport')}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Compliance Status */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Overall Status Card */}
            <div className="bg-secondary text-white rounded-[1.5rem] p-8 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl"></div>
              <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/20">
                    <ShieldCheck className="w-10 h-10 text-secondary-fixed" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-secondary-fixed uppercase tracking-widest mb-1">{t('compliance.auditStatus')}</p>
                    <h2 className="text-4xl font-black">{data.status.percentage}% Compliant</h2>
                    <p className="text-sm opacity-90 mt-2">{data.status.warningCount} minor warnings require attention. {data.status.criticalViolations} critical violations.</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs opacity-80 mb-1">Last Automated Audit</p>
                  <p className="font-bold">{new Date(data.status.lastAuditAt).toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Regulation Categories */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.regulations.map((reg, idx) => (
                <div key={idx} className={`bg-surface-container-lowest rounded-[1.5rem] p-6 shadow-sm border border-outline-variant/10 ${reg.status === 'WARNING' ? 'border-l-4 border-l-tertiary' : ''}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${reg.status === 'WARNING' ? 'bg-tertiary-fixed/30' : 'bg-green-100'}`}>
                        {reg.status === 'WARNING' ? <AlertTriangle className="w-5 h-5 text-tertiary" /> : <CheckCircle2 className="w-5 h-5 text-green-600" />}
                      </div>
                      <div>
                        <h3 className="font-bold text-primary">{reg.name}</h3>
                        <p className="text-xs text-slate-500">{reg.description}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${reg.status === 'WARNING' ? 'text-tertiary bg-tertiary-fixed/50' : 'text-green-700 bg-green-100'}`}>{reg.status}</span>
                  </div>
                  <div className="space-y-2">
                    {reg.metrics.map((m: any, mIdx: number) => (
                      <div key={mIdx} className="flex justify-between text-sm">
                        <span className="text-slate-600">{m.label}</span>
                        <span className={`font-bold ${reg.status === 'WARNING' && m.value === 'Approaching Limit' ? 'text-tertiary' : 'text-primary'}`}>{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Action Items */}
            <div className="bg-surface-container-lowest rounded-[1.5rem] p-6 shadow-sm border border-outline-variant/10">
              <h3 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5" />
                {t('compliance.actionRequired')}
              </h3>
              <div className="space-y-3">
                {data.actionItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl hover:bg-surface-container transition-colors cursor-pointer group">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full ${item.priority === 'high' ? 'bg-error' : 'bg-tertiary'}`}></div>
                      <div>
                        <h4 className="font-bold text-primary text-sm group-hover:text-cyan-700 transition-colors">{item.title}</h4>
                        <p className="text-xs text-slate-500">{item.description}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Audit Log */}
            <div className="bg-surface-container-lowest rounded-[1.5rem] p-6 shadow-sm border border-outline-variant/10">
              <h3 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Recent Audit Log
              </h3>
              <div className="relative border-l-2 border-surface-container ml-3 space-y-6 pb-4">
                {data.auditLogs.map((log, idx) => (
                  <div key={idx} className="relative pl-6">
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-4 border-white ${idx === 0 ? 'bg-secondary' : 'bg-surface-variant'}`}></div>
                    <p className="text-sm font-bold text-primary">{log.title}</p>
                    <p className="text-xs text-slate-500">{log.description}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-1">{new Date(log.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              <button className="w-full mt-2 py-2 text-primary font-bold text-sm hover:underline transition-colors">
                View Full History
              </button>
            </div>

            {/* Quick Links */}
            <div className="bg-primary-container/10 rounded-[1.5rem] p-6 border border-primary/10">
              <h3 className="text-sm font-bold text-primary mb-3 uppercase tracking-wider">Resources</h3>
              <ul className="space-y-2">
                {data.resources.map((res, idx) => (
                  <li key={idx}>
                    <a href={res.url} className="text-sm text-cyan-800 hover:underline flex items-center gap-2">
                      <FileText className="w-4 h-4" /> {res.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
