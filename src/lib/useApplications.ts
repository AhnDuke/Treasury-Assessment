"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApplicationRecord } from "./types";

/** Identifies what a row is currently showing, so a poll can tell whether
 *  anything an agent would notice has actually changed. */
function queueSignature(list: ApplicationRecord[]): string {
  return list
    .map((a) => `${a.id}:${a.status}:${a.triageStatus ?? ""}:${a.decision ?? ""}:${a.processingMs ?? ""}`)
    .join("|");
}

export interface ApplicationsState {
  applications: ApplicationRecord[] | null;
  loadError: string | null;
  /** How many applications a background poll has seen change since this list loaded. */
  updatedCount: number;
  /** Shows the staged update. */
  applyUpdates: () => void;
  /** Refetches and shows the result straight away. */
  reload: () => Promise<void>;
  /** Replaces one application locally, for a change the agent just made. */
  replace: (updated: ApplicationRecord) => void;
}

/**
 * Owns the queue's data, so the list and the one-at-a-time review work from
 * the same copy instead of each fetching their own and disagreeing.
 *
 * Background polls stage their result rather than applying it: rows
 * rearranging under a reviewer mid-read is worse than being slightly stale.
 * Anything the agent does themselves applies at once, because they are
 * expecting that change, and it also clears the staged copy. Without that,
 * recording a decision made the local list differ from the last poll and the
 * "something changed, refresh?" prompt appeared after every single sign-off.
 */
export function useApplications(): ApplicationsState {
  const [applications, setApplications] = useState<ApplicationRecord[] | null>(null);
  const [incoming, setIncoming] = useState<ApplicationRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (apply: boolean) => {
    try {
      const response = await fetch("/api/applications");
      if (!response.ok) throw new Error(`The server returned an error (${response.status}).`);
      const data = await response.json();
      const list: ApplicationRecord[] = data.applications ?? [];
      if (apply) {
        setApplications(list);
        setIncoming(null);
      } else {
        setIncoming(list);
      }
      setLoadError(null);
    } catch {
      setLoadError("Could not load the review queue. Check the server configuration and try again.");
    }
  }, []);

  useEffect(() => {
    // A data-fetching library (SWR/React Query) is the "by the book" answer to
    // this lint rule, but is more than this prototype's timeline justifies for
    // one fetch-on-mount-and-poll source.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(true);
  }, [load]);

  const hasInFlight = applications?.some((a) => a.status === "pending" || a.status === "processing") ?? false;

  useEffect(() => {
    // Checked often while a batch is running, and still occasionally when the
    // queue looks idle: this app has no auth and one shared queue, so work can
    // finish because of a cron sweep or another reviewer, not only because of
    // something this tab started.
    const interval = setInterval(() => void load(false), hasInFlight ? 5000 : 20000);
    return () => clearInterval(interval);
  }, [hasInFlight, load]);

  const updatedCount = (() => {
    if (!incoming || !applications) return 0;
    if (queueSignature(incoming) === queueSignature(applications)) return 0;
    const before = new Map(applications.map((a) => [a.id, `${a.status}:${a.triageStatus ?? ""}:${a.decision ?? ""}`]));
    let changed = 0;
    for (const a of incoming) {
      const previous = before.get(a.id);
      if (previous === undefined || previous !== `${a.status}:${a.triageStatus ?? ""}:${a.decision ?? ""}`) changed += 1;
    }
    const incomingIds = new Set(incoming.map((a) => a.id));
    changed += applications.filter((a) => !incomingIds.has(a.id)).length;
    return changed;
  })();

  return {
    applications,
    loadError,
    updatedCount,
    applyUpdates: () => {
      if (!incoming) return;
      setApplications(incoming);
      setIncoming(null);
    },
    reload: () => load(true),
    replace: (updated) => {
      setApplications((prev) => (prev ?? []).map((a) => (a.id === updated.id ? updated : a)));
      // Dropped, or the next render compares the agent's own change against a
      // poll taken before it and offers to "refresh" to the older state.
      setIncoming(null);
    },
  };
}
