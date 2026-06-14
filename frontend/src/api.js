// На проде frontend ходит через Nginx:
// https://okvionsales.ru/api
//
// В локальной разработке можешь запустить так:
// VITE_API_URL=http://localhost:3000 npm run dev
const API = import.meta.env.VITE_API_URL || "/api";

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem("sales_app_session") || "null");
  } catch {
    return null;
  }
}

function isFixedPointRole(role) {
  return role === "worker" || role === "branch_admin" || role === "workspace";
}

export function setSession(session) {
  localStorage.setItem("sales_app_session", JSON.stringify(session));

  if (session?.workspace) {
    localStorage.setItem("sales_app_workspace", JSON.stringify(session.workspace));
  } else if (session?.dataAccountId) {
    localStorage.setItem(
      "sales_app_workspace",
      JSON.stringify({
        id: session.defaultWorkspaceId || session.workspaceId,
        accountId: session.ownerAccountId || session.accountId,
        dataAccountId: session.dataAccountId,
        name: session.workspaceName || "Основная точка",
        isMain: !isFixedPointRole(session.role),
      })
    );
  }

  localStorage.removeItem("sales_app_profile");
  window.dispatchEvent(new Event("sales-workspace-change"));
  window.dispatchEvent(new Event("sales-profile-change"));
}

export function clearSession() {
  localStorage.removeItem("sales_app_session");
  localStorage.removeItem("sales_app_workspace");
  localStorage.removeItem("sales_app_profile");
}

export function getCurrentWorkspace() {
  try {
    return JSON.parse(localStorage.getItem("sales_app_workspace") || "null");
  } catch {
    return null;
  }
}

export function setCurrentWorkspace(workspace) {
  localStorage.setItem("sales_app_workspace", JSON.stringify(workspace));
  localStorage.removeItem("sales_app_profile");
  window.dispatchEvent(new Event("sales-workspace-change"));
  window.dispatchEvent(new Event("sales-profile-change"));
}

export function clearWorkspace() {
  localStorage.removeItem("sales_app_workspace");
  localStorage.removeItem("sales_app_profile");
  window.dispatchEvent(new Event("sales-workspace-change"));
  window.dispatchEvent(new Event("sales-profile-change"));
}

export function getCurrentProfile() {
  try {
    return JSON.parse(localStorage.getItem("sales_app_profile") || "null");
  } catch {
    return null;
  }
}

export function setCurrentProfile(profile) {
  if (!profile) {
    localStorage.removeItem("sales_app_profile");
  } else {
    localStorage.setItem("sales_app_profile", JSON.stringify(profile));
  }

  window.dispatchEvent(new Event("sales-profile-change"));
}

function workspaceAccountId() {
  const workspace = getCurrentWorkspace();
  const session = getSession();

  return (
    workspace?.dataAccountId ||
    session?.dataAccountId ||
    workspace?.id ||
    session?.accountId ||
    null
  );
}

function ownerAccountId() {
  const session = getSession();
  return session?.ownerAccountId || session?.accountId || null;
}

function withParams(url) {
  if (url.startsWith("/auth/")) return url;

  let id;
  let key = "accountId";

  if (url.startsWith("/workspaces") || url.startsWith("/workspace-users")) {
    id = ownerAccountId();
    key = "ownerAccountId";
  } else {
    id = workspaceAccountId();
  }

  if (!id) return url;

  const divider = url.includes("?") ? "&" : "?";
  return `${url}${divider}${key}=${encodeURIComponent(id)}`;
}

function authHeaders() {
  const session = getSession();
  const workspace = getCurrentWorkspace();
  const headers = {};

  const token = session?.token;
  if (token) headers.Authorization = `Bearer ${token}`;

  const ownerId = session?.ownerAccountId || session?.accountId;
  const dataId = workspace?.dataAccountId || session?.dataAccountId;

  if (ownerId) headers["X-Owner-Account-ID"] = String(ownerId);
  if (dataId) headers["X-Data-Account-ID"] = String(dataId);

  return headers;
}

function withBody(url, body) {
  if (url.startsWith("/auth/")) return body || {};

  if (url.startsWith("/workspaces") || url.startsWith("/workspace-users")) {
    return {
      ...(body || {}),
      ownerAccountId: ownerAccountId(),
      accountId: ownerAccountId(),
    };
  }

  const id = workspaceAccountId();
  const cleanBody = body || {};

  return id
    ? {
        ...cleanBody,
        accountId: cleanBody.accountId || id,
      }
    : cleanBody;
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(API + withParams(url), {
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      ...options,
      signal: controller.signal,
    });

    const text = await res.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }

    if (res.status === 401) {
      const isAuthRoute = url.startsWith("/auth/");

      if (!isAuthRoute) {
        clearSession();
        window.location.reload();
        return;
      }

      throw new Error(data?.error || "Неверный логин или пароль");
    }

    if (!res.ok) {
      throw new Error(data?.error || `Ошибка сервера: ${res.status}`);
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Сервер не ответил за 12 секунд. Проверь backend, Docker и Nginx.",
        { cause: error }
      );
    }

    if (error instanceof TypeError) {
      throw new Error(
        "Нет соединения с backend. Проверь, что сервер работает и Nginx проксирует /api.",
        { cause: error }
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function get(url) {
  return request(url);
}

export async function post(url, body) {
  return request(url, {
    method: "POST",
    body: JSON.stringify(withBody(url, body)),
  });
}

export async function put(url, body) {
  return request(url, {
    method: "PUT",
    body: JSON.stringify(withBody(url, body)),
  });
}

export async function del(url, body) {
  return request(
    url,
    body === undefined
      ? { method: "DELETE" }
      : { method: "DELETE", body: JSON.stringify(withBody(url, body)) }
  );
}

export const apiGet = get;
export const apiPost = post;
export const apiPut = put;
export const apiDelete = del;