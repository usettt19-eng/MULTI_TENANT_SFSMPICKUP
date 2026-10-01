-- pickup_events crece sin límite (nunca se archivan filas viejas) y hoy
-- solo tenía índice por tenant_id. Varias pantallas consultan por
-- parent_id/student_id/status en bucles de sondeo cada 3-10 segundos
-- (ParentDashboard.checkActivePickups, OperationsDashboard, TransitMonitor,
-- VerificationDisplay, GuardianVerification, BusRoutesPanel), y hoy se sumó
-- una consulta nueva por student_id (hasActivePickupEvent, en cada anuncio).
-- Sin índice, cada una de esas consultas escanea TODA la tabla del tenant —
-- bajo carga concurrente en hora de salida, eso produjo los timeouts reales
-- (57014) vistos en los logs de Supabase el 2026-09-30.
--
-- CREATE INDEX CONCURRENTLY no bloquea la tabla mientras se construye
-- (mejor para producción en vivo), pero no puede correr dentro de una
-- transacción — por eso van sueltos, no en un solo BEGIN/COMMIT. Correr
-- cada CREATE INDEX por separado en el SQL Editor de Supabase.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pickup_events_parent_status
  ON public.pickup_events (parent_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pickup_events_student_status
  ON public.pickup_events (student_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pickup_events_tenant_status
  ON public.pickup_events (tenant_id, status);

-- Para el conteo de "completados hoy" (completed_at >= inicio del día),
-- usado en OperationsDashboard y ParentPerimeterPanel.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pickup_events_tenant_completed_at
  ON public.pickup_events (tenant_id, completed_at)
  WHERE status = 'completed';

-- notifications: mismo problema — ParentDashboard.fetchNotifications() la
-- consulta por (user_id, tenant_id) en el MISMO bucle de sondeo cada 3-10s
-- que pickup_events, para CADA padre activo. Solo tenía índice por
-- tenant_id (de la lista general), nada por user_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_tenant
  ON public.notifications (user_id, tenant_id);

-- Verificación: confirma que los índices nuevos ya existen (pickup_events
-- debería tener 5: el de tenant_id que ya estaba, más los 4 nuevos;
-- notifications debería tener el de tenant_id más el nuevo de user_id).
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('pickup_events', 'notifications')
ORDER BY tablename, indexname;
