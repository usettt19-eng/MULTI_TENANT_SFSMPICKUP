-- 1. Asegurarnos de que todas las columnas necesarias existan en medication_schedule
ALTER TABLE medication_schedule
ADD COLUMN IF NOT EXISTS medication_name TEXT,
ADD COLUMN IF NOT EXISTS dosage TEXT,
ADD COLUMN IF NOT EXISTS frequency TEXT,
ADD COLUMN IF NOT EXISTS scheduled_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS critical_reason TEXT;

-- 2. Recrear la vista active_critical_medications para asegurarnos de que usa las columnas correctas
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

-- 3. Recrear la función del trigger para asegurarnos de que usa las columnas correctas
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
      'MEDICAMENTO CRÍTICO: ' || COALESCE(NEW.medication_name, 'Desconocido'),
      'El estudiante requiere ' || COALESCE(NEW.medication_name, 'Desconocido') || ' (' || COALESCE(NEW.dosage, 'Dosis no especificada') || ') - ' || COALESCE(NEW.critical_reason, 'Requiere atención especial'),
      COALESCE(NEW.notes, 'Verificar administración según frecuencia: ' || COALESCE(NEW.frequency, 'No especificada')),
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
      'MEDICAMENTO CRÍTICO: ' || COALESCE(NEW.medication_name, 'Desconocido'),
      'Dosis: ' || COALESCE(NEW.dosage, 'No especificada') || ' | Frecuencia: ' || COALESCE(NEW.frequency, 'No especificada'),
      'critical',
      COALESCE(NEW.notes, 'Administrar según prescripción')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
