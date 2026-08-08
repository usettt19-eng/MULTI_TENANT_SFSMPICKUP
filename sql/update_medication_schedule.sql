-- ==========================================
-- ACTUALIZAR TABLA medication_schedule
-- Para agregar soporte de medicamentos críticos
-- ==========================================

-- Agregar columna is_critical
ALTER TABLE medication_schedule
ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT false;

-- Agregar columna critical_reason
ALTER TABLE medication_schedule
ADD COLUMN IF NOT EXISTS critical_reason TEXT;

-- Crear índice para búsquedas rápidas de medicamentos críticos
CREATE INDEX IF NOT EXISTS idx_med_schedule_critical ON medication_schedule(is_critical) WHERE is_critical = true;

-- ==========================================
-- TABLA PARA ALERTAS CRÍTICAS DE MEDICAMENTOS
-- ==========================================

CREATE TABLE IF NOT EXISTS medication_critical_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_schedule_id UUID REFERENCES medication_schedule(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL DEFAULT 'critical_medication',
  title TEXT NOT NULL,
  description TEXT,
  action_plan TEXT,
  severity TEXT DEFAULT 'critical' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  is_active BOOLEAN DEFAULT true,
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para alertas activas
CREATE INDEX IF NOT EXISTS idx_med_alerts_active ON medication_critical_alerts(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_med_alerts_student ON medication_critical_alerts(student_id);

-- ==========================================
-- FUNCIÓN: Crear alerta cuando medicamento se vuelve crítico
-- ==========================================

CREATE OR REPLACE FUNCTION create_critical_alert_for_med_schedule()
RETURNS TRIGGER AS $$
BEGIN
  -- Cuando un medicamento se marca como crítico (de false/null a true)
  IF NEW.is_critical = true AND (OLD IS NULL OR OLD.is_critical IS NULL OR OLD.is_critical = false) THEN
    -- Insertar alerta en medication_critical_alerts
    INSERT INTO medication_critical_alerts (
      medication_schedule_id,
      student_id,
      alert_type,
      title,
      description,
      action_plan,
      severity
    )
    VALUES (
      NEW.id,
      NEW.student_id,
      'critical_medication',
      'MEDICAMENTO CRÍTICO: ' || NEW.medication_name,
      'El estudiante requiere ' || NEW.medication_name || ' (' || NEW.dosage || ') - ' || COALESCE(NEW.critical_reason, 'Requiere atención especial'),
      COALESCE(NEW.notes, 'Verificar administración según frecuencia: ' || NEW.frequency),
      'critical'
    );

    -- También crear alerta en health_alerts para visibilidad adicional
    INSERT INTO health_alerts (
      student_id,
      alert_type,
      title,
      description,
      severity,
      action_plan
    )
    VALUES (
      NEW.student_id,
      'medication',
      'MEDICAMENTO CRÍTICO: ' || NEW.medication_name,
      'Dosis: ' || NEW.dosage || ' | Frecuencia: ' || NEW.frequency,
      'critical',
      COALESCE(NEW.notes, 'Administrar según prescripción')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para crear alertas
DROP TRIGGER IF EXISTS trigger_create_critical_alert_schedule ON medication_schedule;
CREATE TRIGGER trigger_create_critical_alert_schedule
  AFTER INSERT OR UPDATE ON medication_schedule
  FOR EACH ROW
  EXECUTE FUNCTION create_critical_alert_for_med_schedule();

-- ==========================================
-- FUNCIÓN: Desactivar alertas cuando medicamento deja de ser crítico
-- ==========================================

CREATE OR REPLACE FUNCTION deactivate_critical_alert_on_med_schedule_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Cuando un medicamento deja de ser crítico (de true a false)
  IF NEW.is_critical = false AND OLD.is_critical = true THEN
    -- Desactivar alertas en medication_critical_alerts
    UPDATE medication_critical_alerts
    SET is_active = false,
        resolved_at = NOW()
    WHERE medication_schedule_id = NEW.id AND is_active = true;

    -- Desactivar alertas en health_alerts
    UPDATE health_alerts
    SET resolved = true,
        resolved_at = NOW()
    WHERE student_id = NEW.student_id
      AND resolved = false
      AND title LIKE 'MEDICAMENTO CRÍTICO:%'
      AND title LIKE '%' || NEW.medication_name || '%';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para desactivar alertas
DROP TRIGGER IF EXISTS trigger_deactivate_critical_alert_schedule ON medication_schedule;
CREATE TRIGGER trigger_deactivate_critical_alert_schedule
  AFTER UPDATE ON medication_schedule
  FOR EACH ROW
  EXECUTE FUNCTION deactivate_critical_alert_on_med_schedule_update();

-- ==========================================
-- VISTA: Medicamentos críticos activos
-- ==========================================

CREATE OR REPLACE VIEW active_critical_medications AS
SELECT
  ms.id,
  ms.medication_name,
  ms.dosage,
  ms.frequency,
  ms.critical_reason,
  ms.notes,
  ms.scheduled_time,
  ms.status,
  ms.is_critical,
  s.id as student_id,
  s.first_name,
  s.last_name,
  s.grade,
  s.photo_url,
  ms.created_at
FROM medication_schedule ms
JOIN students s ON s.id = ms.student_id
WHERE ms.is_critical = true
ORDER BY ms.created_at DESC;

-- ==========================================
-- VISTA: Dashboard de alertas críticas combinadas
-- ==========================================

CREATE OR REPLACE VIEW wellness_critical_alerts_dashboard AS
SELECT
  'medication' as source_type,
  mca.id,
  mca.student_id,
  mca.title,
  mca.description,
  mca.action_plan,
  mca.severity,
  mca.is_active,
  mca.created_at,
  s.first_name,
  s.last_name,
  s.grade,
  s.photo_url
FROM medication_critical_alerts mca
JOIN students s ON s.id = mca.student_id
WHERE mca.is_active = true

UNION ALL

SELECT
  'health' as source_type,
  ha.id,
  ha.student_id,
  ha.title,
  ha.description,
  ha.action_plan,
  ha.severity,
  NOT ha.resolved as is_active,
  ha.created_at,
  s.first_name,
  s.last_name,
  s.grade,
  s.photo_url
FROM health_alerts ha
JOIN students s ON s.id = ha.student_id
WHERE ha.resolved = false
ORDER BY created_at DESC;
