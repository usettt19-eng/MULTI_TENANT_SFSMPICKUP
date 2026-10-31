-- Autorización automática del QR de reemplazo (no de la recogida en sí —
-- recepción sigue validando en persona cuando la persona lo presenta):
-- después de N minutos sin que recepción/admin responda una solicitud de
-- reemplazo pendiente, el sistema la aprueba sola y genera el QR, avisando
-- a recepción. Mismo patrón que auto_release_enabled/auto_release_after_time
-- (autorización automática por horario), apagado por defecto.
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS auto_approve_replacements_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve_replacements_after_minutes integer NOT NULL DEFAULT 15;
