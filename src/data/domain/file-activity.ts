export type FileAction = "read" | "created" | "modified" | "deleted";

// The shape the collector produces and the repositories persist. It lives in
// data/domain, not in collector/, so the storage layer does not have to point
// upwards at the process that happens to fill it in.
export interface FileActivityEntry {
  path: string;
  action: FileAction;
  tool: string;
  ts: number;
  additions?: number;
  deletions?: number;
}
