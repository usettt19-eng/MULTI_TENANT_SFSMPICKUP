import React from 'react';
import { TopNav } from '../components/TopNav';
import { 
  Heart, 
  Activity, 
  ClipboardList, 
  AlertTriangle, 
  Plus, 
  CheckCircle2,
  Clock,
  Stethoscope
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export function WellnessHub() {
  const { t } = useLanguage();

  return (
    <>
      <TopNav title="SafePickup" subtitle={t('wellness.title')} />
      
      <div className="p-6 max-w-7xl mx-auto space-y-6 w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-black text-primary tracking-tight">{t('wellness.title')}</h1>
            <p className="text-sm text-slate-500 font-medium">{t('wellness.subtitle')}</p>
          </div>
          <button className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-primary-container transition-colors shadow-md">
            <Plus className="w-4 h-4" />
            {t('wellness.logIncident')}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Alerts & Meds */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Critical Alerts */}
            <div className="bg-error-container/50 border border-error/20 rounded-[1.5rem] p-6">
              <h2 className="text-lg font-bold text-on-error-container mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-error" />
                {t('wellness.activeAlerts')}
              </h2>
              <div className="space-y-3">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-error/10 flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <img 
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuCeqJsN89bdIQvO0RuxseFRBUW-P41DJu6vVbe7JSjYMA4OUX9QWQANfWHPqE0nRA0xSjkaRaU_8VPCukPcI-XrMTFyydM-UAAYpD7NO3K12TsRDihAjRbFw5P5gbYU3DBea0UwTlHL5NhRo01Zq8HcaY1c8fktvHLEFaiKW_yYykTSuZvwZTNjXdeKuegTO-4YVzB7MYdLCCDXdXvlkp44d_PsGqJSY9tjZN6X84Bb7i6aiFlauaA_Yrbt2a5wMKWRh_GopPi3jUxE" 
                      alt="Leo" 
                      className="w-10 h-10 rounded-full object-cover"
                    />
                    <div>
                      <h3 className="font-bold text-primary">Leo Brooks <span className="text-xs font-normal text-slate-500 ml-2">Pre-K</span></h3>
                      <p className="text-sm text-error font-semibold mt-0.5">Severe Peanut Allergy</p>
                      <p className="text-xs text-slate-500 mt-1">EpiPen located in Nurse Station A. Action plan verified.</p>
                    </div>
                  </div>
                  <button className="text-xs font-bold text-primary bg-surface-container px-3 py-1.5 rounded-lg hover:bg-surface-variant transition-colors">
                    {t('wellness.viewPlan')}
                  </button>
                </div>
              </div>
            </div>

            {/* Medication Schedule */}
            <div className="bg-surface-container-lowest rounded-[1.5rem] p-6 shadow-sm border border-outline-variant/10">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  {t('wellness.medSchedule')}
                </h2>
                <span className="text-xs font-bold text-secondary bg-secondary-container/30 px-3 py-1 rounded-full">
                  2 {t('wellness.pending')}
                </span>
              </div>

              <div className="space-y-4">
                {/* Med Item 1 */}
                <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border-l-4 border-secondary">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm text-secondary font-black text-lg">
                      12p
                    </div>
                    <div>
                      <h3 className="font-bold text-primary">Amoxicillin (5ml)</h3>
                      <p className="text-xs text-slate-500">Maya Lin • Prescribed by Dr. Smith</p>
                    </div>
                  </div>
                  <button className="flex items-center gap-2 bg-secondary text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-secondary/90 transition-colors shadow-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    {t('wellness.markAdministered')}
                  </button>
                </div>

                {/* Med Item 2 (Completed) */}
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border-l-4 border-slate-300 opacity-75">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-200 flex items-center justify-center text-slate-500 font-black text-lg line-through">
                      9a
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-600 line-through">Inhaler (2 puffs)</h3>
                      <p className="text-xs text-slate-400">Julian Thorne • Administered by Nurse Joy</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-bold text-slate-500">
                    <CheckCircle2 className="w-4 h-4" /> {t('wellness.done')}
                  </span>
                </div>
              </div>
            </div>

          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <div className="bg-primary text-white rounded-[1.5rem] p-6 shadow-xl">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5" />
                {t('wellness.dailyOverview')}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/10 p-4 rounded-xl">
                  <p className="text-[10px] uppercase tracking-widest font-bold opacity-80 mb-1">{t('wellness.incidents')}</p>
                  <p className="text-3xl font-black">0</p>
                </div>
                <div className="bg-white/10 p-4 rounded-xl">
                  <p className="text-[10px] uppercase tracking-widest font-bold opacity-80 mb-1">{t('wellness.medsGiven')}</p>
                  <p className="text-3xl font-black">4</p>
                </div>
              </div>
            </div>

            {/* Recent Logs */}
            <div className="bg-surface-container-lowest rounded-[1.5rem] p-6 shadow-sm border border-outline-variant/10">
              <h3 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
                <ClipboardList className="w-5 h-5" />
                {t('wellness.recentLogs')}
              </h3>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center shrink-0 mt-1">
                    <Stethoscope className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-primary">Temperature Check</p>
                    <p className="text-xs text-slate-500">Sienna Ray (98.6°F) - Normal</p>
                    <p className="text-[10px] text-slate-400 mt-1">10:30 AM</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center shrink-0 mt-1">
                    <Heart className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-primary">Nap Time Logged</p>
                    <p className="text-xs text-slate-500">Toddler Wing - All asleep</p>
                    <p className="text-[10px] text-slate-400 mt-1">1:00 PM</p>
                  </div>
                </div>
              </div>
              <button className="w-full mt-6 py-2 bg-surface-container-low text-primary font-bold rounded-xl text-sm hover:bg-surface-container transition-colors">
                {t('wellness.viewAllLogs')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
