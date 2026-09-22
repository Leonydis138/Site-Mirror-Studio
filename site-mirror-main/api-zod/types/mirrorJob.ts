export interface MirrorJob {
  // ... existing fields
  timeoutMs: number;
  maxTotalBytes: number;
  currentUrl: string | null;
  message: string | null;
  completedAt: string | null;
}
