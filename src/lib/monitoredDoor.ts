import { useEffect, useState } from 'react';

// Puerta que el personal está monitoreando ahora mismo en este navegador,
// compartida entre Monitor Externo (VerificationDisplay), En Tránsito
// (TransitMonitor) y el widget de "carritos" (ParentPerimeterPanel), para
// que las tres pantallas muestren la misma puerta sin tener que elegirla
// por separado en cada una. Se guarda en localStorage (por dispositivo, no
// por usuario — un kiosco suele quedarse fijo en una puerta) y se
// propaga entre componentes montados en la misma pestaña con un evento
// custom, ya que 'storage' del navegador no se dispara en la pestaña que
// hizo el cambio.
const EVENT_NAME = 'sfsp:monitored-door-change';

function storageKey(tenantId: string | undefined): string {
  return `sfsp_monitored_door_id:${tenantId || 'unknown'}`;
}

export function getMonitoredDoorId(tenantId: string | undefined): string {
  if (!tenantId || typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(storageKey(tenantId)) || '';
  } catch {
    return '';
  }
}

export function setMonitoredDoorId(tenantId: string | undefined, doorId: string): void {
  if (!tenantId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(tenantId), doorId);
  } catch {
    // localStorage puede no estar disponible (modo privado, etc.) — no es
    // crítico, cada pantalla simplemente se queda con su propio filtro.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { tenantId, doorId } }));
}

export function useMonitoredDoor(tenantId: string | undefined): [string, (doorId: string) => void] {
  const [doorId, setDoorIdState] = useState(() => getMonitoredDoorId(tenantId));

  useEffect(() => {
    setDoorIdState(getMonitoredDoorId(tenantId));

    const onCustomChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.tenantId !== tenantId) return;
      setDoorIdState(detail.doorId || '');
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(tenantId)) return;
      setDoorIdState(e.newValue || '');
    };

    window.addEventListener(EVENT_NAME, onCustomChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onCustomChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [tenantId]);

  const setDoorId = (id: string) => {
    setDoorIdState(id);
    setMonitoredDoorId(tenantId, id);
  };

  return [doorId, setDoorId];
}
