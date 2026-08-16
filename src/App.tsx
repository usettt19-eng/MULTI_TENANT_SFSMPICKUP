import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { SuperAdminDashboard } from './views/SuperAdminDashboard';
import { Layout } from './components/Layout';
import { OperationsDashboard } from './views/OperationsDashboard';
import { GuardianVerification } from './views/GuardianVerification';
import { SmartCheckIn } from './views/SmartCheckIn';
import { WellnessCenter } from './views/WellnessCenter';
import { ComplianceCenter } from './views/ComplianceCenter';
import { FormBuilder } from './views/FormBuilder';
import { VerificationDisplay } from './views/VerificationDisplay';
import { Students } from './views/Students';
import { ParentDashboard } from './views/ParentDashboard';
import { VisitorsLog } from './views/VisitorsLog';
import { Settings } from './views/Settings';
import { GuardiansRegistry } from './views/GuardiansRegistry';
import { AuditLogs } from './views/AuditLogs';
import { StaffManagement } from './views/StaffManagement';
import { RequestsCenter } from './views/RequestsCenter';
import { LanguageProvider } from './contexts/LanguageContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { useAuth } from './contexts/AuthContext';
import { Login } from './views/Login';
import { SetPassword } from './views/SetPassword';
import { SharedQRDisplay } from './views/SharedQRDisplay';
import { LandingPage } from './views/LandingPage';

export default function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [isSharedQRRoute, setIsSharedQRRoute] = useState(false);
  const [isLandingRoute, setIsLandingRoute] = useState(false);
  const { session, loading, profile, isImpersonating, authRedirectType, clearAuthRedirectType } = useAuth() as any;

  useEffect(() => {
    // Check if we are on the /external route with a qr parameter
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    if (path === '/external' && params.has('qr')) {
      setIsSharedQRRoute(true);
    } else if (path === '/' && !session) {
      setIsLandingRoute(true);
    }
  }, [session]);

  if (isSharedQRRoute) {
    return (
      <>
        <SharedQRDisplay />
      </>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!session) {
    if (isLandingRoute || window.location.pathname === '/') {
      return (
        <>
          <LandingPage />
        </>
      );
    }
    return (
      <>
        <Login />
      </>
    );
  }

  // Session came from an invite or password-reset link: prompt for a
  // password before showing the normal dashboard.
  if (authRedirectType === 'invite' || authRedirectType === 'recovery') {
    return <SetPassword type={authRedirectType} onDone={clearAuthRedirectType} />;
  }

  // STRICT REDIRECT FOR SUPER ADMIN — a menos que haya "entrado" a un
  // colegio puntual (ver AuthContext.enterTenantAsAdmin), en cuyo caso
  // `profile` ya viene disfrazado de admin de ese tenant y sigue de largo
  // hacia las pantallas normales de abajo.
  if (profile?.role === 'super_admin' && !isImpersonating) {
    return (
      <LanguageProvider>
        <SuperAdminDashboard />
      </LanguageProvider>
    );
  }

  // STRICT REDIRECT FOR PARENTS
  if (profile?.role === 'parent') {
    return (
      <LanguageProvider>
        <ParentDashboard />
      </LanguageProvider>
    );
  }

  // Check Staff Permissions
  let isStaff = false;
  let permissions: string[] = [];
  
  if (profile?.role === 'admin') {
    try {
      const parsed = JSON.parse(profile.additional_tutor_name || '{}');
      if (parsed.is_staff === true) {
        isStaff = true;
        permissions = parsed.permissions || [];
      }
    } catch (e) {}
  }

  if (isStaff) {
    // If current view is not permitted, redirect to the first permitted view or a fallback
    if (!permissions.includes(currentView) && currentView !== 'settings') {
      if (permissions.length > 0) {
        setCurrentView(permissions[0]);
      } else {
        return (
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-md">
              <h2 className="text-2xl font-black text-slate-800 mb-2">Acceso Restringido</h2>
              <p className="text-slate-500">No tienes permisos asignados. Contacta al administrador.</p>
              <button 
                onClick={() => supabase.auth.signOut()} 
                className="mt-6 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold w-full"
              >
                Cerrar Sesión
              </button>
            </div>
          </div>
        );
      }
    }
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <OperationsDashboard setCurrentView={setCurrentView} />;
      case 'security':
        return <GuardianVerification />;
      case 'checkin':
        return <SmartCheckIn />;
      case 'wellness':
        return <WellnessCenter />;
      case 'compliance':
        return <ComplianceCenter />;
      case 'forms':
        return <FormBuilder />;
      case 'external':
        return <VerificationDisplay />;
      case 'students':
        return <Students />;
      case 'guardians':
        return <GuardiansRegistry />;
      case 'logs':
        return <AuditLogs />;
      case 'settings':
        return profile?.role === 'admin' ? <Settings /> : <OperationsDashboard setCurrentView={setCurrentView} />;
      case 'visitors':
        return <VisitorsLog />;
      case 'requests':
        return <RequestsCenter />;
      case 'staff':
        return <StaffManagement />;
      default:
        return <OperationsDashboard setCurrentView={setCurrentView} />;
      }
    };

  return (
    <LanguageProvider>
      <LayoutProvider>
        <Layout currentView={currentView} setCurrentView={setCurrentView}>
          {renderView()}
        </Layout>
      </LayoutProvider>
    </LanguageProvider>
  );
}
