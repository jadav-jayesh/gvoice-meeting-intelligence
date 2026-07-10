export function secondsBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / 1000);
}

export function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return [hours, minutes, secs].map((value) => value.toString().padStart(2, "0")).join(":");
}
