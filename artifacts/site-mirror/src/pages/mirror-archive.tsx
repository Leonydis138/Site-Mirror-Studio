import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Download, ExternalLink, FileArchive, FileCode2, FileText, Image, Search, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'wouter';
import {
  getGetMirrorArchiveIntegrityQueryKey,
  getGetMirrorArchiveManifestQueryKey,
  getGetMirrorJobQueryKey,
  getListMirrorArchiveFilesQueryKey,
  getServeMirrorPreviewFileQueryKey,
  useGetMirrorArchiveIntegrity,
  useGetMirrorArchiveManifest,
  useGetMirrorJob,
  useListMirrorArchiveFiles,
  useServeMirrorPreviewFile,
  type MirrorArchiveFile,
  type MirrorArchiveFileKind,
  type MirrorArchiveFileStatus,
} from '@workspace/api-client-react';
import { formatBytes } from '@/lib/mirror-format';

function iconFor(type: string | null) {
  if (type?.startsWith('image/')) return Image;
  if (type?.includes('html')) return FileCode2;
  return FileText;
}

function ArchiveMetric({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'warning' | 'good' }) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <p className={`font-mono text-2xl tracking-[-.06em] ${tone === 'warning' ? 'text-[hsl(var(--accent-foreground))]' : tone === 'good' ? 'text-[hsl(158_39%_27%)]' : ''}`}>{value}</p>
      <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{label}</p>
    </div>
  );
}

export default function MirrorArchivePage() {
  const { id = '' } = useParams<{ id: string }>();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'' | MirrorArchiveFileKind>('');
  const [status, setStatus] = useState<'' | MirrorArchiveFileStatus>('');
  const [selected, setSelected] = useState<MirrorArchiveFile | null>(null);

  const jobQuery = useGetMirrorJob(id, { query: { queryKey: getGetMirrorJobQueryKey(id), enabled: Boolean(id) } });
  const job = jobQuery.data;
  const params = useMemo(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  }), [kind, search, status]);
  const filesQuery = useListMirrorArchiveFiles(id, params, {
    query: { queryKey: getListMirrorArchiveFilesQueryKey(id, params), enabled: Boolean(id && job?.archiveAvailable) },
  });
  const integrityQuery = useGetMirrorArchiveIntegrity(id, {
    query: { queryKey: getGetMirrorArchiveIntegrityQueryKey(id), enabled: Boolean(id && job?.archiveAvailable) },
  });
  const manifestQuery = useGetMirrorArchiveManifest(id, {
    query: { queryKey: getGetMirrorArchiveManifestQueryKey(id), enabled: Boolean(id && job?.archiveAvailable) },
  });
  const selectedPath = selected?.path ?? '';
  const selectedFileQuery = useServeMirrorPreviewFile(id, selectedPath, {
    query: { queryKey: getServeMirrorPreviewFileQueryKey(id, selectedPath), enabled: Boolean(id && selectedPath && !selected?.contentType?.includes('html')) },
  });
  const files = filesQuery.data?.files ?? [];
  const integrity = integrityQuery.data;
  const manifest = manifestQuery.data;

  useEffect(() => {
    document.title = 'Archive browser · Site Mirror';
  }, []);

  useEffect(() => {
    if (selected && !files.some((file) => file.path === selected.path)) setSelected(null);
  }, [files, selected]);

  const selectedPreviewUrl = selected
    ? `/api/mirror-jobs/${encodeURIComponent(id)}/preview/${selected.path.split('/').map(encodeURIComponent).join('/')}`
    : '';
  const [selectedBlobUrl, setSelectedBlobUrl] = useState('');
  useEffect(() => {
    if (!(selectedFileQuery.data instanceof Blob)) {
      setSelectedBlobUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFileQuery.data);
    setSelectedBlobUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFileQuery.data]);

  if (jobQuery.isLoading) {
    return <div className="min-h-[100dvh] animate-pulse bg-[hsl(var(--background))] p-8"><div className="mx-auto h-56 max-w-[1200px] rounded-[1.5rem] bg-[hsl(var(--muted))]" /></div>;
  }
  if (jobQuery.error || !job) {
    return <EmptyArchive title="Mirror job not found" body="The archive control room could not find this mirror. It may have expired or the service may be unavailable." href="/" />;
  }
  if (!job.archiveAvailable) {
    return <EmptyArchive title="Archive is not available" body="The files become browseable after the mirror has been sealed. Return to the monitor to see its current state." href={`/jobs/${id}`} />;
  }

  return (
    <div className="min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-4 md:px-8">
          <Link href={`/jobs/${id}`} data-testid="link-archive-job" className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><FileArchive className="h-4 w-4" /></span><span className="text-sm font-extrabold">site mirror</span></Link>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary-foreground)/.65)]"><ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--accent))]" />sealed archive</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-5 py-7 md:px-8 md:py-9">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link href={`/jobs/${id}`} data-testid="link-back-from-archive" className="inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"><ArrowLeft className="h-3.5 w-3.5" />Back to job</Link>
          <a data-testid="link-download-archive" href={`/api/mirror-jobs/${encodeURIComponent(id)}/download`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-bold text-[hsl(var(--primary-foreground))]"><Download className="h-3.5 w-3.5" />Download ZIP</a>
        </div>
        <div className="mb-7">
          <p className="font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--accent-foreground))]">Archive browser / {manifest?.schemaVersion ? `schema ${manifest.schemaVersion}` : 'sealed snapshot'}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-[-.045em] md:text-4xl">Inspect the sealed snapshot</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">Search the captured file index and inspect resources without opening the live website.</p>
        </div>

        {integrity && <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ArchiveMetric label="Files indexed" value={integrity.fileCount} />
          <ArchiveMetric label="Saved" value={integrity.savedCount} tone="good" />
          <ArchiveMetric label="Warnings" value={integrity.warningCount} tone={integrity.warningCount ? 'warning' : 'default'} />
          <ArchiveMetric label="Broken resources" value={integrity.brokenPages + integrity.brokenAssets} tone={integrity.brokenPages + integrity.brokenAssets ? 'warning' : 'good'} />
        </section>}

        {integrity && <div data-testid="status-integrity" className={`mb-6 flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold ${integrity.valid ? 'border-[hsl(157_35%_66%/.5)] bg-[hsl(157_35%_66%/.12)] text-[hsl(158_39%_27%)]' : 'border-[hsl(var(--accent-border)/.5)] bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent-foreground))]'}`}>
          {integrity.valid ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
          {integrity.valid ? 'Integrity check passed. The archive is internally consistent.' : `${integrity.warningCount} integrity note${integrity.warningCount === 1 ? '' : 's'} require review before relying on every resource.`}
        </div>}

        <div className="grid gap-6 lg:grid-cols-[370px_minmax(0,1fr)]">
          <aside className="rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-sm)]">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" /><input data-testid="input-archive-search" aria-label="Search archive files" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search path or URL" className="h-10 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-9 pr-3 text-xs outline-none focus:border-[hsl(var(--accent-border))]" /></div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(['', 'page', 'asset'] as const).map((value) => <button key={value || 'all'} data-testid={`button-filter-${value || 'all'}`} type="button" onClick={() => setKind(value)} className={`rounded-lg px-2 py-2 text-[10px] font-bold ${kind === value ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{value ? `${value[0].toUpperCase()}${value.slice(1)}s` : 'All'}</button>)}
            </div>
            <select data-testid="select-archive-status" aria-label="Filter archive status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="mt-2 h-9 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 text-[10px] outline-none"><option value="">All file states</option><option value="saved">Saved</option><option value="skipped">Skipped</option><option value="failed">Failed</option></select>
            <div className="mt-4 flex items-center justify-between border-t border-[hsl(var(--border))] pt-3"><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">{filesQuery.isFetching ? 'Refreshing index' : `${filesQuery.data?.total ?? files.length} files`}</p><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /></div>
            <div className="mt-2 max-h-[62dvh] overflow-auto pr-1">
              {filesQuery.isLoading && <div className="animate-pulse space-y-2 p-2">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-9 rounded-lg bg-[hsl(var(--muted))]" />)}</div>}
              {!filesQuery.isLoading && files.length === 0 && <div className="p-5 text-center"><FileArchive className="mx-auto h-6 w-6 text-[hsl(var(--muted-foreground))]" /><p className="mt-3 text-xs font-semibold">No files match</p><p className="mt-1 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">Try a shorter path or clear the filters.</p></div>}
              {files.map((file) => { const Icon = iconFor(file.contentType); return <button key={`${file.kind}:${file.path}`} data-testid={`button-archive-file-${file.path.replace(/[^a-z0-9]/gi, '-')}`} type="button" onClick={() => setSelected(file)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[hsl(var(--muted))] ${selected?.path === file.path ? 'bg-[hsl(var(--secondary))]' : ''}`}><Icon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" /><span className="min-w-0 flex-1 truncate font-mono text-[10px]">{file.path}</span><span className={`shrink-0 font-mono text-[9px] ${file.status === 'failed' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{formatBytes(file.bytes)}</span></button>; })}
            </div>
          </aside>
          <section className="min-h-[600px] overflow-hidden rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[var(--shadow-sm)]">
            {selected ? <><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-5"><div className="min-w-0"><p data-testid="text-selected-archive-path" className="truncate font-mono text-xs">{selected.path}</p><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{selected.contentType ?? 'unknown'} · {formatBytes(selected.bytes)} · {selected.status}</p></div><a data-testid="link-open-selected-file" href={selectedPreviewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 text-[10px] font-bold"><ExternalLink className="h-3 w-3" />Open</a></div><div className="h-[min(72dvh,760px)] bg-[hsl(var(--muted)/.35)] p-2"><iframe title={`Preview ${selected.path}`} src={selected.contentType?.includes('html') ? selectedPreviewUrl : selectedBlobUrl || selectedPreviewUrl} sandbox="allow-scripts allow-downloads" className="h-full w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]" /></div></> : <div className="flex min-h-[600px] items-center justify-center p-10 text-center"><div><FileArchive className="mx-auto h-8 w-8 text-[hsl(var(--muted-foreground))]" /><h2 className="mt-4 text-lg font-extrabold">Select a file</h2><p className="mt-2 max-w-sm text-xs leading-5 text-[hsl(var(--muted-foreground))]">Choose a page or resource from the archive index to inspect it in an isolated preview.</p></div></div>}
          </section>
        </div>
        {filesQuery.error && <p role="alert" data-testid="status-archive-error" className="mt-5 rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.07)] p-4 text-xs text-[hsl(var(--destructive))]">Archive files could not be loaded. Refresh the page and try again.</p>}
      </main>
    </div>
  );
}

function EmptyArchive({ title, body, href }: { title: string; body: string; href: string }) {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-5"><section className="w-full max-w-md rounded-[1.4rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center shadow-[var(--shadow-md)]"><FileArchive className="mx-auto h-8 w-8 text-[hsl(var(--muted-foreground))]" /><h1 className="mt-5 text-xl font-extrabold tracking-[-.03em]">{title}</h1><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{body}</p><Link href={href} data-testid="link-empty-archive-back" className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-bold text-[hsl(var(--primary-foreground))]"><ArrowLeft className="h-3.5 w-3.5" />Back to job</Link></section></div>;
}