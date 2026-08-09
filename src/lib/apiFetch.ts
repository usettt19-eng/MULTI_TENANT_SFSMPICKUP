import {supabase} from './supabase';

/**
 * Llama a la API interna (/api/...) adjuntando el JWT de la sesión.
 *
 * El backend usa la clave `service_role`, que salta todas las políticas RLS,
 * así que comprueba por su cuenta quién llama y a qué colegio pertenece. Sin
 * esta cabecera devuelve 401.
 *
 * Usar SIEMPRE esto en lugar de `fetch('/api/...')` a pelo.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const {data} = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(path, {...init, headers});
}

/**
 * Igual que apiFetch pero devolviendo ya el JSON, con el error del backend
 * propagado como excepción.
 *
 * Evita el fallo que veíamos en producción: si la respuesta no es JSON —por
 * ejemplo el index.html que devuelve nginx cuando el endpoint no existe— el
 * mensaje era "Unexpected token '<'" en vez de algo entendible.
 */
export async function apiJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const text = await res.text();

  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      res.status === 404
        ? `El servicio de API no está disponible (${path}).`
        : `Respuesta inesperada del servidor (${res.status}).`,
    );
  }

  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `Error ${res.status} en ${path}`);
  }
  return json;
}
