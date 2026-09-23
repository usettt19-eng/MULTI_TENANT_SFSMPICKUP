import {apiFetch} from '../lib/apiFetch';
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Building2, Plus, ArrowRight, ShieldCheck, Settings, Users, Activity, Mail, Lock, User, LogOut, Eye, EyeOff, LogIn, X, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';

interface Tenant {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  created_at: string;
}

export function SuperAdminDashboard() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTenant, setNewTenant] = useState({
    schoolName: '',
    domain: '',
    firstName: '',
    lastName: '',
    email: ''
  });

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  // Password Reset State
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [showEditModalPassword, setShowEditModalPassword] = useState(false);

  const { profile, enterTenantAsAdmin } = useAuth() as any;
  const { t, language, setLanguage } = useLanguage();

  const [stats, setStats] = useState<Record<string, any>>({});
  const [staffListModal, setStaffListModal] = useState<Tenant | null>(null);

  useEffect(() => {
    fetchTenants();
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await apiFetch('/api/tenants/stats');
      const data = await response.json();
      if (data.success) {
        setStats(data.data || {});
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchTenants = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTenants(data || []);
    } catch (error) {
      console.error('Error fetching tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenant.schoolName || !newTenant.email) return;
    setIsSubmitting(true);

    try {
      const response = await apiFetch(`/api/tenants/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTenant)
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || t('superAdmin.errorRegisteringInstitution'));
      }

      // Refresh list
      await fetchTenants();
      setShowAddModal(false);
      setNewTenant({ schoolName: '', domain: '', firstName: '', lastName: '', email: '' });
      alert(t('superAdmin.alertInstitutionCreated'));
    } catch (error: any) {
      console.error('Error creating tenant:', error);
      alert(`${t('superAdmin.errorPrefix')} ${error.message || t('superAdmin.unknownError')}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (tenant: Tenant) => {
    setEditingTenant({ ...tenant });
    setShowEditModal(true);
  };

  const handleUpdateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;
    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          name: editingTenant.name,
          domain: editingTenant.domain || null,
          status: editingTenant.status
        })
        .eq('id', editingTenant.id);

      if (error) throw error;

      await fetchTenants();
      setShowEditModal(false);
      setEditingTenant(null);
      setNewAdminPassword('');
    } catch (error: any) {
      console.error("Error updating tenant:", error);
      alert(`${t('superAdmin.errorUpdating')} ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!editingTenant || !newAdminPassword || newAdminPassword.length < 6) {
      alert(t('superAdmin.alertPasswordMinLength'));
      return;
    }
    setIsResettingPassword(true);
    try {
      const response = await apiFetch('/api/tenants/reset-admin-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: editingTenant.id,
          newPassword: newAdminPassword
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || t('superAdmin.errorResettingPassword'));
      }

      alert(t('superAdmin.alertPasswordUpdated'));
      setNewAdminPassword('');
    } catch (error: any) {
      console.error("Error reseting password:", error);
      alert(`${t('superAdmin.errorPrefix')} ${error.message}`);
    } finally {
      setIsResettingPassword(false);
    }
  };

  if (profile?.role !== 'super_admin') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <ShieldCheck className="mx-auto h-16 w-16 text-rose-500 mb-4" />
          <h1 className="text-2xl font-bold text-slate-800">{t('superAdmin.accessDenied')}</h1>
          <p className="text-slate-500 mt-2">{t('superAdmin.noPermissions')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto">
        
        {/* Header Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-indigo-600" />
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">OS SuperAdmin</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-slate-500">
               {profile?.email || t('superAdmin.superAdminFallback')}
            </div>
            <button
              type="button"
              onClick={() => setLanguage(language === 'es' ? 'en' : 'es', { manual: true })}
              title={t('superAdmin.languageToggleTitle')}
              className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-2 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors shadow-sm"
            >
              <Globe className="w-4 h-4" />
              {language === 'es' ? 'ES' : 'EN'}
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              className="inline-flex items-center gap-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-xl font-bold hover:bg-slate-200 transition-colors shadow-sm text-sm"
            >
              <LogOut className="w-4 h-4" />
              {t('superAdmin.logOut')}
            </button>
          </div>
        </div>

        {/* Page Title & Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-6">
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">{t('superAdmin.institutionsManagement')}</h2>
            <p className="text-slate-500 font-medium">{t('superAdmin.institutionsManagementSubtitle')}</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5" />
            {t('superAdmin.newSchoolBtn')}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 text-slate-500 mb-3">
              <Building2 className="w-5 h-5" />
              <span className="font-bold">{t('superAdmin.totalSchools')}</span>
            </div>
            <div className="text-4xl font-black text-slate-900">{tenants.length}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 text-slate-500 mb-3">
              <Activity className="w-5 h-5" />
              <span className="font-bold">{t('superAdmin.activeSchools')}</span>
            </div>
            <div className="text-4xl font-black text-emerald-600">
              {tenants.filter(t => t.status === 'active').length}
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 text-slate-500 mb-3">
              <Users className="w-5 h-5" />
              <span className="font-bold">{t('superAdmin.systemReports')}</span>
            </div>
            <div className="text-4xl font-black text-indigo-600">--</div>
          </div>
        </div>

        {/* Tenant List */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900">{t('superAdmin.registeredInstitutions')}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-sm border-b border-slate-100">
                  <th className="font-bold p-4 pl-6">{t('superAdmin.tableHeaderSchoolName')}</th>
                  <th className="font-bold p-4">{t('superAdmin.tableHeaderAdmin')}</th>
                  <th className="font-bold p-4">{t('superAdmin.tableHeaderDomain')}</th>
                  <th className="font-bold p-4">{t('superAdmin.tableHeaderStatus')}</th>
                  <th className="font-bold p-4">{t('superAdmin.tableHeaderCreatedDate')}</th>
                  <th className="font-bold p-4 pr-6 text-right">{t('superAdmin.tableHeaderActions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      {t('superAdmin.loadingInstitutions')}
                    </td>
                  </tr>
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      {t('superAdmin.noSchoolsRegistered')}
                    </td>
                  </tr>
                ) : (
                  tenants.map(tenant => (
                    <tr key={tenant.id} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                      <td className="p-4 pl-6 font-bold text-slate-900">
                        <div>{tenant.name}</div>
                        {stats[tenant.id] && (
                          <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] text-slate-500 font-medium">
                            <span className="bg-slate-100 px-1.5 py-0.5 rounded">👩🏽‍🎓 {stats[tenant.id].students} {t('superAdmin.students')}</span>
                            <span className="bg-slate-100 px-1.5 py-0.5 rounded">👨‍👩‍👦 {stats[tenant.id].parents} {t('superAdmin.parents')}</span>
                            <span className="bg-slate-100 px-1.5 py-0.5 rounded">👨🏽‍🏫 {stats[tenant.id].staff} {t('superAdmin.staffLabel')}</span>
                            <span className="bg-slate-100 px-1.5 py-0.5 rounded">🚪 {stats[tenant.id].doors} {t('superAdmin.doors')}</span>
                            <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
                              🟢 {stats[tenant.id].parentsActiveToday ?? 0} {t('superAdmin.parentsActiveToday')}
                            </span>
                            <button
                              type="button"
                              onClick={() => setStaffListModal(tenant)}
                              disabled={!(stats[tenant.id].staffActiveToday?.length > 0)}
                              title={t('superAdmin.staffActiveTitle')}
                              className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:hover:bg-indigo-50 disabled:cursor-default"
                            >
                              🧑‍🏫 {stats[tenant.id].staffActiveToday?.length ?? 0} {t('superAdmin.staffActiveToday')}
                            </button>
                            {(stats[tenant.id].latitude && stats[tenant.id].longitude) && (
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded">
                                📍 {stats[tenant.id].latitude}, {stats[tenant.id].longitude}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-slate-600">
                        {stats[tenant.id]?.admin ? (
                          <div>
                            <p className="font-bold text-slate-800 text-sm">
                              {stats[tenant.id].admin!.first_name} {stats[tenant.id].admin!.last_name}
                            </p>
                            <p className="text-xs text-slate-400">{stats[tenant.id].admin!.email || t('superAdmin.noEmail')}</p>
                            {stats[tenant.id].admin!.phone && (
                              <p className="text-xs text-slate-400">{stats[tenant.id].admin!.phone}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300 italic">{t('superAdmin.noAdmin')}</span>
                        )}
                      </td>
                      <td className="p-4 text-slate-500">
                        {tenant.domain ? (
                          <span className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-xs font-semibold">
                            {tenant.domain}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          tenant.status === 'active' 
                            ? 'bg-emerald-100 text-emerald-700' 
                            : tenant.status === 'suspended' ? 'bg-amber-100 text-amber-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}>
                          {tenant.status === 'active' ? t('superAdmin.statusActive') : tenant.status === 'suspended' ? t('superAdmin.statusSuspended') : t('superAdmin.statusInactive')}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-500">
                        {new Date(tenant.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-4 pr-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => enterTenantAsAdmin(tenant.id)}
                            title={t('superAdmin.enterAsAdminTitle')}
                            className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-600 px-3 py-2 rounded-lg font-bold text-xs hover:bg-indigo-600 hover:text-white transition-colors"
                          >
                            <LogIn className="w-4 h-4" />
                            {t('superAdmin.enterAsAdminBtn')}
                          </button>
                          <button
                            onClick={() => handleEditClick(tenant)}
                            className="p-2 text-slate-400 hover:text-indigo-600 transition-colors rounded-lg hover:bg-indigo-50"
                          >
                            <Settings className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl my-8">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">{t('superAdmin.registerNewSchoolTitle')}</h2>
            </div>
            <form onSubmit={handleCreateTenant} className="p-6">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* School Details */}
                <div className="space-y-4">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
                    <Building2 className="w-4 h-4 text-indigo-500" /> {t('superAdmin.institutionSection')}
                  </h3>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">{t('superAdmin.schoolNameLabel')}</label>
                    <input
                      type="text"
                      required
                      value={newTenant.schoolName}
                      onChange={(e) => setNewTenant({...newTenant, schoolName: e.target.value})}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none font-medium text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">{t('superAdmin.subdomainOptionalLabel')}</label>
                    <div className="flex bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-600">
                      <input
                        type="text"
                        value={newTenant.domain}
                        onChange={(e) => setNewTenant({...newTenant, domain: e.target.value})}
                        className="flex-1 bg-transparent px-3 py-2.5 font-medium text-slate-900 outline-none w-full"
                      />
                      <span className="bg-slate-100 px-3 py-2.5 text-slate-500 text-xs font-bold border-l border-slate-200 flex items-center">
                        .safesmartpickup.com
                      </span>
                    </div>
                  </div>
                </div>

                {/* Admin Details */}
                <div className="space-y-4">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
                    <User className="w-4 h-4 text-indigo-500" /> {t('superAdmin.mainAdminSection')}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">{t('superAdmin.firstNameLabel')}</label>
                      <input type="text" required value={newTenant.firstName} onChange={(e) => setNewTenant({...newTenant, firstName: e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-600 font-medium" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">{t('superAdmin.lastNameLabel')}</label>
                      <input type="text" required value={newTenant.lastName} onChange={(e) => setNewTenant({...newTenant, lastName: e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-600 font-medium" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">{t('superAdmin.emailLabel')}</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                      <input type="email" required value={newTenant.email} onChange={(e) => setNewTenant({...newTenant, email: e.target.value})} className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-600 font-medium" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 bg-indigo-50/50 border border-indigo-100 rounded-xl px-3 py-2.5">
                    {t('superAdmin.invitationEmailNote')}
                  </p>
                </div>
              </div>

              <div className="mt-8 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  {t('superAdmin.cancelBtn')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? t('superAdmin.creatingBtn') : t('superAdmin.createInstitutionBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingTenant && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">{t('superAdmin.editSchoolTitle')}</h2>
            </div>
            <form onSubmit={handleUpdateTenant} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">{t('superAdmin.nameLabel')}</label>
                <input
                  type="text"
                  required
                  value={editingTenant.name}
                  onChange={(e) => setEditingTenant({...editingTenant, name: e.target.value})}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none font-medium text-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">{t('superAdmin.subdomainLabel')}</label>
                <div className="flex bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-600">
                  <input
                    type="text"
                    value={editingTenant.domain || ''}
                    onChange={(e) => setEditingTenant({...editingTenant, domain: e.target.value})}
                    className="flex-1 bg-transparent px-3 py-2.5 font-medium text-slate-900 outline-none"
                  />
                  <span className="bg-slate-100 px-3 py-2.5 text-slate-500 text-sm font-bold border-l border-slate-200 flex items-center">
                    .safesmartpickup.com
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">{t('superAdmin.tableHeaderStatus')}</label>
                <select
                  value={editingTenant.status}
                  onChange={(e) => setEditingTenant({...editingTenant, status: e.target.value})}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none font-medium text-slate-900"
                >
                  <option value="active">{t('superAdmin.statusActive')}</option>
                  <option value="suspended">{t('superAdmin.statusSuspended')}</option>
                  <option value="inactive">{t('superAdmin.statusInactive')}</option>
                </select>
              </div>

              <div className="mt-8 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  {t('superAdmin.cancelBtn')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? t('superAdmin.savingBtn') : t('superAdmin.saveChangesBtn')}
                </button>
              </div>
            </form>

            <div className="px-6 pb-6 pt-4 border-t border-slate-100 bg-slate-50 rounded-b-3xl">
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                <Lock className="w-4 h-4 text-slate-500" /> {t('superAdmin.changeAdminPasswordTitle')}
              </h3>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <input
                    type={showEditModalPassword ? "text" : "password"}
                    placeholder={t('superAdmin.newPasswordPlaceholder')}
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-4 pr-10 py-2.5 bg-white focus:ring-2 focus:ring-indigo-600 outline-none font-medium text-slate-900"
                  />
                  <button type="button" onClick={() => setShowEditModalPassword(!showEditModalPassword)} className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600">
                    {showEditModalPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={isResettingPassword || !newAdminPassword || newAdminPassword.length < 6}
                  className="px-4 py-2.5 rounded-xl font-bold text-white bg-slate-800 hover:bg-slate-900 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {isResettingPassword ? t('superAdmin.updatingBtn') : t('superAdmin.updateBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Staff logueado hoy */}
      {staffListModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{t('superAdmin.staffActiveToday')}</h2>
                <p className="text-xs text-slate-500 font-medium">{staffListModal.name}</p>
              </div>
              <button onClick={() => setStaffListModal(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="px-6 pt-4 text-[11px] text-slate-400 font-medium leading-relaxed">
              {t('superAdmin.staffActiveExplainer')}
            </p>
            <div className="p-4 overflow-y-auto space-y-2">
              {(stats[staffListModal.id]?.staffActiveToday ?? []).map((s: any) => (
                <div key={s.name} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <p className="text-sm font-bold text-slate-800">{s.name}</p>
                  <div className="text-right">
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                      {s.action_count} {s.action_count === 1 ? t('superAdmin.actionSingular') : t('superAdmin.actionPlural')}
                    </span>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {new Date(s.last_action_at).toLocaleTimeString(language === 'es' ? 'es-PA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
