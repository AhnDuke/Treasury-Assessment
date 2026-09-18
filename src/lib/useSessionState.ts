"use client";

import { useCallback, useSyncExternalStore } from "react";

// One cache entry + listener set per storage key, so repeated reads return a
// stable reference (useSyncExternalStore requires that) and every consumer
// of the same key re-renders when it changes.
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function getListeners(key: string): Set<() => void> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function readValue<T>(key: string, initialValue: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = initialValue;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored !== null) value = JSON.parse(stored) as T;
  } catch {
    // sessionStorage unavailable (private browsing, blocked storage) - fall back to initialValue.
  }
  cache.set(key, value);
  return value;
}

/**
 * Like useState, but backed by sessionStorage - survives a refresh, never
 * leaves the tab, never touches a server. Built on useSyncExternalStore so
 * the server snapshot (always `initialValue` - there's no sessionStorage
 * during SSR/build) and the client snapshot can differ without a hydration
 * mismatch.
 */
export function useSessionState<T>(key: string, initialValue: T) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const set = getListeners(key);
      set.add(onStoreChange);
      return () => set.delete(onStoreChange);
    },
    [key]
  );
  const getSnapshot = useCallback(() => readValue(key, initialValue), [key, initialValue]);
  const getServerSnapshot = useCallback(() => initialValue, [initialValue]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(readValue(key, initialValue)) : next;
      cache.set(key, resolved);
      try {
        window.sessionStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Quota exceeded or storage blocked - the in-memory cache still updates for this tab.
      }
      for (const listener of getListeners(key)) listener();
    },
    [key, initialValue]
  );

  return [value, setValue] as const;
}
