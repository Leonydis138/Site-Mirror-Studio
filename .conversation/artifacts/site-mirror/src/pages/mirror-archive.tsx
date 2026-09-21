import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, FileArchive, FileCode2, FileText, Image, Network, Search, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { getGetMirrorJobQueryKey, useGetMirrorJob } from '@workspace/api-client-react';

type ArchiveFile = { path: string; kind: 'page' | 'asset'; url: string; status: string; contentType: string | null; bytes: number; reason: string | null; finalUrl: string | null };
type Integrity = { valid: boolean; fileCount: number; savedCount: number; warningCount: number; brokenPages: number; brokenAssets: number; warnings: Array<{ kind: string; url: string; path: string | null; status: string; reason: string | null; httpStatus: number | null }> };

function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(1)} GB`; }
function iconFor(type: string | null) { if (type?.startsWith('image/')) return Image; if (type?.includes('html')) return FileCode2; return FileText; }

export default function MirrorArchivePage() {
  const { id = '' } = useParams<{ id: string }>();
  const jobQuery = useGetMirrorJob(id, { query: { queryKey: getGetMirrorJobQueryKey(id), enabled: Boolean(id) } });
  const [files, setFiles] = useState<ArchiveFile[]>([]);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [selected, setSelected] = useState<ArchiveFile | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const params = new URLSearchParams(); if (search) params.set('search', search); if (kind) params.set('kind', kind);
      const [fileResponse, integrityResponse] = await Promise.all([
        fetch(`/api/mirror-jobs/${encodeURIComponent(id)}/archive/files?${params}`),
        fetch(`/api/mirror-jobs/${encodeURIComponent(id)}/archive/integrity`),
      ]);
      if (!fileResponse.ok || !integrityResponse.ok) throw new Error('Archive inspection is not available.');
      setFiles((await fileResponse.json()).files ?? []); setIntegrity(await integrityResponse.json());
    } catch (e) { setError(e instanceof Error ? e.message : 'Archive inspection failed.'); }
  };
  useEffect(() => { if (jobQuery.data?.archiveAvailable) void load(); }, [id, jobQuery.data?.archiveAvailable, search, kind]);
  useEffect(() => { document.title = 'Archive browser · Site Mirror'; }, []);

  const folders = useMemo(() => Array.from(new Set(files.map(f => f.path.split('/').slice(0, -1).join('/')).filter(Boolean))).sort(), [files]);
  const previewUrl = selected ? `/api/mirror-jobs/${encodeURIComponent(id)}/preview/${selected.path.split('/').map(encodeURIComponent).join('/')}` : '';
  const job = jobQuery.data;

  if (jobQuery.isLoading) return <div className="min-h-[100dvh] bg-[hsl(var(--background))] p-10 text-sm">Loading archive…</div>;
  if (!job) return <div className="min-h-[100dvh] bg-[hsl(var(--background))] p-10 text-sm">Mirror job not found.</div>;
  if (!job.archiveAvailable) return <div className="min-h-[100dvh] bg-[hsl(var(--background))] p-10"><Link href={`/jobs/${id}`} className="font-bold">← Back to job</Link><h1 className="mt-8 text-2xl font-extrabold">Archive is not available</h1></div>;

  return <div className="min-h-[100dvh] bg-[hsl(var(--background))]">
    <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"><div className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-4 md:px-8"><Link href={`/jobs/${id}`} className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Network className="h-4 w-4" /></span><span className="text-sm font-extrabold">site mirror</span></Link><span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary-foreground)/.65)]"><ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--accent))]" />sealed archive</span></div></header>
    <main className="mx-auto max-w-[1280px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><Link href={`/jobs/${id}`} className="inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft className="h-3.5 w-3.5" />Back to job</Link><a href={`/api/mirror-jobs/${encodeURIComponent(id)}/download`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-bold text-[hsl(var(--primary-foreground))]"><FileArchive className="h-3.5 w-3.5" />Download ZIP</a></div>
      <div className="mb-6"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--accent-foreground))]">Archive browser</p><h1 className="mt-2 text-3xl font-extrabold tracking-[-.045em]">Inspect the sealed snapshot</h1><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Browse files and diagnostics without opening the live website.</p></div>
      {integrity && <section className="mb-6 grid gap-3 sm:grid-cols-4">{[['Files', integrity.fileCount], ['Saved', integrity.savedCount], ['Warnings', integrity.warningCount], ['Broken resources', integrity.brokenPages + integrity.brokenAssets]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"><p className="font-mono text-xl">{value}</p><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{label}</p></div>)}</section>}
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-sm)]"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"/><input aria-label="Search archive files" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search path or URL" className="h-10 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-9 pr-3 text-xs outline-none"/></div><div className="mt-3 flex gap-2"><button onClick={() => setKind('')} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${!kind ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))]'}`}>All</button><button onClick={() => setKind('page')} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${kind === 'page' ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))]'}`}>Pages</button><button onClick={() => setKind('asset')} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${kind === 'asset' ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))]'}`}>Assets</button></div><div className="mt-4 max-h-[65dvh] overflow-auto pr-1">{folders.slice(0, 30).map(folder => <p key={folder} className="mb-1 px-2 pt-2 font-mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{folder}</p>)}{files.map(file => { const Icon = iconFor(file.contentType); return <button key={`${file.kind}:${file.path}`} onClick={() => setSelected(file)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[hsl(var(--muted))] ${selected?.path === file.path ? 'bg-[hsl(var(--secondary))]' : ''}`}><Icon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]"/><span className="min-w-0 flex-1 truncate font-mono text-[10px]">{file.path}</span><span className="shrink-0 font-mono text-[9px] text-[hsl(var(--muted-foreground))]">{formatBytes(file.bytes)}</span></button>})}</div></aside>
        <section className="min-h-[600px] overflow-hidden rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[var(--shadow-sm)]">{selected ? <><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-5"><div className="min-w-0"><p className="truncate font-mono text-xs">{selected.path}</p><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{selected.contentType ?? 'unknown'} · {formatBytes(selected.bytes)}</p></div><a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 text-[10px] font-bold"><ExternalLink className="h-3 w-3"/>Open</a></div><div className="h-[min(72dvh,760px)] bg-[hsl(var(--muted)/.35)] p-2"><iframe title={`Preview ${selected.path}`} src={previewUrl} sandbox="allow-scripts" className="h-full w-full rounded-lg border border-[hsl(var(--border))] bg-white"/></div></> : <div className="flex h-full min-h-[600px] items-center justify-center p-10 text-center"><div><FileArchive className="mx-auto h-8 w-8 text-[hsl(var(--muted-foreground))]"/><h2 className="mt-4 text-lg font-extrabold">Select a file</h2><p className="mt-2 max-w-sm text-xs leading-5 text-[hsl(var(--muted-foreground))]">Choose a page or resource from the archive index to inspect it in the isolated preview.</p></div></div>}</section>
      </div>
      {error && <p role="alert" className="mt-5 rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.07)] p-4 text-xs text-[hsl(var(--destructive))]">{error}</p>}
    </main>
  </div>;
}
