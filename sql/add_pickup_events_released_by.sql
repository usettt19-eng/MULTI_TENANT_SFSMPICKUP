-- Ninguna de las 3 pantallas donde se puede liberar un alumno (Mi Salón,
-- En Tránsito, Monitor Externo) registra el ID del staff que lo hizo —
-- solo un `actor_name` de texto libre en audit_logs (el primer nombre
-- nada más, y Monitor Externo ni siquiera guarda un nombre real, pone
-- genéricamente "Personal de Puerta"). Sin esto, el widget de "cuántos
-- autorizó cada staff" del Dashboard no puede distinguir entre dos
-- miembros del staff con el mismo primer nombre (hay casos reales, ej.
-- "Maria Ducreux" en TCS Albrook).
--
-- ADD COLUMN sin DEFAULT es solo metadata en Postgres, no reescribe la
-- tabla — seguro en producción en vivo. El índice sí usa CONCURRENTLY
-- (no bloquea, no puede ir en la misma transacción que el ALTER).

ALTER TABLE public.pickup_events
  ADD COLUMN IF NOT EXISTS released_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pickup_events_released_by
  ON public.pickup_events (tenant_id, released_by)
  WHERE released_by IS NOT NULL;

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pickup_events' AND column_name = 'released_by';
