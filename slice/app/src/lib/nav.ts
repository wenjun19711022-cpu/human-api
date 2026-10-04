import { S, commit } from "../engine/store";

export function go(route: string) {
  S.route = route;
  try {
    if (location.hash.slice(1) !== route) location.hash = route;
  } catch {
    /* sandboxed frame: in-memory routing still works */
  }
  try {
    window.scrollTo({ top: 0 });
  } catch {
    /* ignore */
  }
  commit();
}

export function routeFromHash(): string | null {
  try {
    const h = location.hash.slice(1);
    return /^[A-Za-z0-9._~-]+$/.test(h) ? h : null;
  } catch {
    return null;
  }
}
