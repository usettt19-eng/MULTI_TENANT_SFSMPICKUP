-- ==========================================
-- WELLNESS CENTER - MEDICATIONS & ALERTS
-- ==========================================

-- 0. Actualizar tabla medication_schedule existente para agregar campos críticos
ALTER TABLE medication_schedule
ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT false;

ALTER TABLE medication_schedule
ADD COLUMN IF NOT EXISTS critical_reason TEXT;

-- Índice para medicamentos críticos en medication_schedule
CREATE INDEX IF NOT EXISTS idx_med_schedule_critical ON medication_schedule(is_critical) WHERE is_critical = true;

-- 1. Tabla para medicamentos (nueva versión mejorada)
CREATE TABLE IF NOT EXISTS medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  medication_name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  is_critical BOOLEAN DEFAULT false,
  critical_reason TEXT,
  notes TEXT,
  prescribed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas rápidas de medicamentos críticos
CREATE INDEX IF NOT EXISTS idx_medications_critical ON medications(is_critical) WHERE is_critical = true;
CREATE INDEX IF NOT EXISTS idx_medications_student ON medications(student_id);

-- 2. Tabla para alertas críticas de medicamentos
CREATE TABLE IF NOT EXISTS medication_critical_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
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

-- 3. Actualizar health_alerts existentes para soportar relación con medicamentos
ALTER TABLE health_alerts
ADD COLUMN IF NOT EXISTS medication_id UUID REFERENCES medications(id) ON DELETE SET NULL;

-- 4. Función para crear alerta crítica automáticamente cuando se marca un medicamento como crítico
CREATE OR REPLACE FUNCTION create_critical_alert_for_medication()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_critical = true AND (OLD.is_critical IS NULL OR OLD.is_critical = false) THEN
    INSERT INTO medication_critical_alerts (
      medication_id,
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
      'Dosage: ' || NEW.dosage || ' | Frecuencia: ' || NEW.frequency,
      'critical',
      COALESCE(NEW.notes, 'Administrar según prescripción')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Trigger para activar la función
DROP TRIGGER IF EXISTS trigger_create_critical_alert ON medications;
CREATE TRIGGER trigger_create_critical_alert
  AFTER INSERT OR UPDATE ON medications
  FOR EACH ROW
  EXECUTE FUNCTION create_critical_alert_for_medication();

-- 6. Función para limpiar alertas cuando un medicamento deja de ser crítico
CREATE OR REPLACE FUNCTION deactivate_critical_alert_on_medication_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_critical = false AND (OLD.is_critical IS NULL OR OLD.is_critical = true) THEN
    -- Desactivar alertas en medication_critical_alerts
    UPDATE medication_critical_alerts
    SET is_active = false,
        resolved_at = NOW()
    WHERE medication_id = NEW.id AND is_active = true;

    -- Desactivar alertas en health_alerts
    UPDATE health_alerts
    SET resolved = true,
        resolved_at = NOW()
    WHERE medication_id = NEW.id AND resolved = false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Trigger para desactivar alertas
DROP TRIGGER IF EXISTS trigger_deactivate_critical_alert ON medications;
CREATE TRIGGER trigger_deactivate_critical_alert
  AFTER UPDATE ON medications
  FOR EACH ROW
  EXECUTE FUNCTION deactivate_critical_alert_on_medication_update();

-- 8. Vista para obtener medicamentos críticos activos
CREATE OR REPLACE VIEW active_critical_medications AS
SELECT
  m.id,
  m.medication_name,
  m.dosage,
  m.frequency,
  m.critical_reason,
  m.notes,
  s.id as student_id,
  s.first_name,
  s.last_name,
  s.grade,
  s.photo_url,
  m.created_at
FROM medications m
JOIN students s ON s.id = m.student_id
WHERE m.is_critical = true
ORDER BY m.created_at DESC;

-- 9. Vista para dashboard de alertas críticas combinadas
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
