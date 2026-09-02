-- Interruptor por colegio para el límite de las 11:00 am que impide
-- anunciar la llegada antes de esa hora (ver ANNOUNCE_ARRIVAL_MIN_HOUR en
-- src/views/ParentDashboard.tsx). Pensado para desactivarlo temporalmente
-- durante una implementación/prueba, y volver a activarlo después — se
-- controla desde un interruptor en el Dashboard (solo admin).
--
-- Default true: en cualquier colegio que no toque este campo, el
-- comportamiento sigue siendo exactamente el de siempre (límite activo).
alter table school_settings
  add column if not exists announce_arrival_restriction_enabled boolean not null default true;
