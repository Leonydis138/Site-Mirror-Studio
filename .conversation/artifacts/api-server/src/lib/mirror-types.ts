export type MirrorStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "cancelled";

export type MirrorOutcomeStatus = "saved" | "skipped" | "failed";

export type MirrorOutcome = {
  kind: "page" | "asset";
  url: string;
  status: MirrorOutcomeStatus;
  httpStatus: number | null;
  contentType: string | null;
  finalUrl: string | null;
  archivePath: string | null;
  reason: string | null;
  attempts: number;
  bytes: number;
  updatedAt: string;
};

export type MirrorProgressPhase =
  | "queued"
  | "discovering"
  | "saving"
  | "downloading_assets"
  | "rewriting"
  | "packaging";

export type MirrorJobRecord = {
  id: string;
  url: string;
  status: MirrorStatus;
  pagesFound: number;
  pagesDownloaded: number;
  pagesSkipped: number;
  pagesFailed: number;
  assetsDownloaded: number;
  assetsSkipped: number;
  assetsFailed: number;
  bytesDownloaded: number;
  maxPages: number;
  requestDelayMs: number;
  respectRobotsTxt: boolean;
  maxDepth: number;
  includeAssets: boolean;
  pathPrefix: string;
  excludePaths: string[];
  timeoutMs: number;
  maxTotalBytes: number;
  maxAssetBytes: number;
  currentUrl: string | null;
  progressPhase: MirrorProgressPhase;
  message: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: string | null;
  outputDir: string;
  archiveKey: string | null;
  archiveBytes: number | null;
  archiveFile: string | null;
  archiveStorageFailed: boolean;
  cancelRequested: boolean;
  // Browser is kept as any to avoid tight coupling in types, 
  // but will be used as puppeteer.Browser in implementation
  browser: any | null; 
  downloadedAssets: Set<string>;
  savedPages: Set<string>;
  outcomes: Map<string, MirrorOutcome>;
  discoveredUrls: Set<string>;
  redirects: Map<string, string>;
  timedOut: boolean;
  sizeLimitReached: boolean;
};

export type MirrorArchiveManifest = {
  schemaVersion: number;
  jobId: string;
  sourceUrl: string;
  configuration: Record<string, unknown>;
  summary: Record<string, unknown>;
  redirects: Record<string, string>;
  outcomes: MirrorOutcome[];
};
