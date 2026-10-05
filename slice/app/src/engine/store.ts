import React from "react";
import type { Asset, BookLevel, L, State } from "./types";
import { createWorld } from "./seed";
import { makeBook } from "./market";
import { rng } from "../lib/rand";
import { setLang } from "../lib/i18n";

const KEY = "slice-demo-v5";

function load(): State | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as State;
    return s.v === 5 ? s : null;
  } catch {
    return null;
  }
}

/** The whole demo world. Mutated in place by actions; `commit()` re-renders and persists. */
export let S: State = load() ?? createWorld();
setLang(S.lang);

let version = 0;
const subs = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
  persistTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* storage unavailable (private window, preview): the demo still runs in memory */
  }
}

export function commit() {
  version++;
  subs.forEach((f) => f());
  if (!persistTimer) persistTimer = setTimeout(persist, 800);
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** Re-render on every commit and read the live world. */
export function useWorld(): State {
  React.useSyncExternalStore(subscribe, () => version);
  return S;
}

export function now(): number {
  return Date.now() + S.offset;
}

export function nextId(prefix: string): string {
  S.seq += 1;
  return `${prefix}${S.seq.toString(36)}${Math.floor(rng() * 1296).toString(36)}`;
}

export function resetWorld() {
  S = createWorld();
  books.clear();
  setLang(S.lang);
  commit();
}

export function getAsset(id: string): Asset | undefined {
  return S.assets.find((a) => a.id === id);
}

// ------------------------------------------------------------------ runtime order books (not persisted)

const books = new Map<string, { bids: BookLevel[]; asks: BookLevel[] }>();

export function levelNotional(a: Asset): number {
  return Math.max(250, a.price * a.totalShares * 0.004);
}

/** Bot market-maker liquidity for an asset; regenerated around the latest price. */
export function botBook(a: Asset) {
  let b = books.get(a.id);
  if (!b) {
    b = makeBook(a.price, 8, levelNotional(a), rng);
    books.set(a.id, b);
  }
  return b;
}

export function refreshBook(a: Asset) {
  books.set(a.id, makeBook(a.price, 8, levelNotional(a), rng));
}

// ------------------------------------------------------------------ UI events (toasts, confetti)

export type UiEvent =
  | { type: "toast"; text: string; tone?: "good" | "info" | "warn" | "bad" }
  | { type: "confetti" }
  | { type: "coins"; amount: number }
  | { type: "badge"; id: string }
  | { type: "level"; level: number };

const uiSubs = new Set<(e: UiEvent) => void>();
export const ui = {
  emit(e: UiEvent) {
    uiSubs.forEach((f) => f(e));
  },
  on(f: (e: UiEvent) => void) {
    uiSubs.add(f);
    return () => {
      uiSubs.delete(f);
    };
  },
};

export function toastL(text: L, tone: "good" | "info" | "warn" | "bad" = "info") {
  ui.emit({ type: "toast", text: S.lang === "zh" ? text.zh : text.en, tone });
}
