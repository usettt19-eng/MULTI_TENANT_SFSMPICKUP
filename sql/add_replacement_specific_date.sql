-- Tercer modo para "Solicitar Reemplazo" del padre: válido solo un día
-- exacto (en vez de "de un solo uso" sin fecha, o recurrente por días de
-- la semana). Ver pickupHelpers.ts (isReplacementAuthorizedNow) y
-- ParentDashboard.tsx/RequestsCenter.tsx.
ALTER TABLE public.replacement_requests
  ADD COLUMN IF NOT EXISTS specific_date date;
