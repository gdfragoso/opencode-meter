import type { Database } from "bun:sqlite";
import { findBySession } from "@/data/repositories/event";
import type { EventRow } from "@/data/domain/event";

export function getEventsBySession(
  db: Database,
  sessionId: string
): Array<Omit<EventRow, "data"> & { data: Record<string, unknown> }> {
  return findBySession(db, sessionId).map((event) => {
    let data: Record<string, unknown>;
    try { data = JSON.parse(event.data) as Record<string, unknown>; } catch { data = { _raw: event.data }; }
    return { ...event, data };
  });
}
