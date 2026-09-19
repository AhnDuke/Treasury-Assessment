import type { ApplicationFormState } from "@/components/ApplicationFields";

const STORAGE_KEY = "ttb-import-session";

export interface StoredImportRow {
  rowNumber: number;
  form: ApplicationFormState;
  suggestedFilenames: string[];
  state: "todo" | "submitted" | "scrapped";
  /**
   * How many photos were attached to this row when the session was saved.
   * The files themselves cannot be stored, so this exists only so the agent
   * can be told what they will need to attach again rather than finding a row
   * silently emptied.
   */
  attachedPhotoCount: number;
}

export interface ImportSession {
  version: 1;
  batchId: string;
  spreadsheetName: string;
  rows: StoredImportRow[];
  activeIndex: number;
  skippedRows: string[];
  startState: "idle" | "starting" | "started" | "failed";
  savedAt: string;
}

/**
 * Keeps an in-progress import alive across a page reload.
 *
 * Working a long sheet is many minutes of typing and attaching photos, and
 * until this existed all of it lived in component state alone: one refresh, one
 * accidental navigation, or one dev-server full reload and the agent was back
 * at "choose a spreadsheet" with nothing to show for it.
 *
 * `sessionStorage`, not `localStorage`, on purpose. An import is a task someone
 * is in the middle of, not a preference: it should outlive a reload of this tab
 * and nothing more. Reopening the app tomorrow should not resurrect a
 * half-finished sheet whose batch was long since processed.
 *
 * What cannot be kept: the attached photos. They are `File` handles the browser
 * will not serialise, and re-reading them from disk without the user picking
 * them again is not something a page is allowed to do. Rows already submitted
 * are unaffected, because their images were uploaded to Blob before the row was
 * created; only photos chosen but not yet submitted are lost, and the count is
 * recorded so that can be said out loud instead of silently discovered.
 */
export function saveImportSession(session: Omit<ImportSession, "version" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: ImportSession = { ...session, version: 1, savedAt: new Date().toISOString() };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable or full (private windows, blocked site data).
    // Losing persistence is a degraded experience, not a broken one, so this
    // stays silent rather than interrupting the import with an error.
  }
}

export function loadImportSession(): ImportSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImportSession;
    // Anything shaped unexpectedly is treated as absent rather than trusted:
    // this is read straight into component state and a bad shape would crash
    // the panel it is meant to restore.
    if (parsed?.version !== 1 || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    if (typeof parsed.batchId !== "string" || !parsed.batchId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearImportSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as saveImportSession.
  }
}
