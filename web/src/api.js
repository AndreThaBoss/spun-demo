const KEY = 'spun.demoUserId';
export const getUserId = () => localStorage.getItem(KEY);
export const setUserId = (id) => (id ? localStorage.setItem(KEY, String(id)) : localStorage.removeItem(KEY));

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const uid = getUserId();
  if (uid) headers['x-user-id'] = uid;
  if (body && !form) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
