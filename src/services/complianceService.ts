import { supabase } from '../lib/supabase';

export interface ComplianceData {
  status: {
    percentage: number;
    lastAuditAt: string;
    warningCount: number;
    criticalViolations: number;
  };
  regulations: any[];
  actionItems: any[];
  auditLogs: any[];
  resources: any[];
}

export const fetchComplianceData = async (): Promise<ComplianceData> => {
  // In a real app, these would be separate tables. 
  // For now, we'll fetch from hypothetical tables.
  
  const [
    { data: status },
    { data: regulations },
    { data: actionItems },
    { data: auditLogs },
    { data: resources }
  ] = await Promise.all([
    supabase.from('compliance_status').select('*').single(),
    supabase.from('regulation_status').select('*'),
    supabase.from('compliance_action_items').select('*').eq('status', 'pending'),
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('compliance_resources').select('*')
  ]);

  return {
    status: status || { percentage: 0, lastAuditAt: new Date().toISOString(), warningCount: 0, criticalViolations: 0 },
    regulations: regulations || [],
    actionItems: actionItems || [],
    auditLogs: auditLogs || [],
    resources: resources || []
  };
};
