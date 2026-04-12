import { type ReactElement, useState, useRef } from 'react';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { logger } from '#/infra/logger/appLogger';
import { DawDialogBody } from '#/components/daw/DawDialogBody';
import { DawDialogFooter } from '#/components/daw/DawDialogFooter';
import { DawDialogSection } from '#/components/daw/DawDialogSection';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import { Flame, X, CheckCircle2 } from 'lucide-react';
import {
    renderOffline,
    exportStems,
    cancelExport,
    isExportActive,
    encodeWav,
    encodeMp3,
    encodeFlac,
} from '../../useCases/exportActions';
import { trackStore } from '#/modules/Arrangement/stores';
import { isTauri } from '#/utils/tauriBridge';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { zipSync } from 'fflate';

type ExportFormat = 'wav' | 'mp3' | 'flac';
type ExportMode = 'mixdown' | 'stems';

type ExportDialogProps = {
    open: boolean;
    onClose: () => void;
};

const EXPORT_SETTINGS_KEY = 'sourdaw:export-settings';

type Mp3BitRate = 96 | 128 | 192 | 320;

const loadExportSettings = (): {
    formats: ExportFormat[];
    sampleRate: number;
    bitDepth: number;
    mp3BitRate: Mp3BitRate;
} => {
    try {
        const stored = localStorage.getItem(EXPORT_SETTINGS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                formats: Array.isArray(parsed.formats) ? parsed.formats : parsed.format ? [parsed.format] : ['wav'],
                sampleRate: parsed.sampleRate ?? 44100,
                bitDepth: parsed.bitDepth ?? 24,
                mp3BitRate: ([96, 128, 192, 320] as Mp3BitRate[]).includes(parsed.mp3BitRate)
                    ? (parsed.mp3BitRate as Mp3BitRate)
                    : 128,
            };
        }
    } catch {
        /* ignore */
    }
    return { formats: ['wav'], sampleRate: 44100, bitDepth: 24, mp3BitRate: 128 };
};

const saveExportSettings = (settings: {
    formats: ExportFormat[];
    sampleRate: number;
    bitDepth: number;
    mp3BitRate: Mp3BitRate;
}): void => {
    try {
        localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        /* ignore */
    }
};

export const ExportDialog = ({ open, onClose }: ExportDialogProps): ReactElement => {
    const defaults = loadExportSettings();
    const [formats, setFormats] = useState<Set<ExportFormat>>(() => new Set(defaults.formats));
    const [mode, setMode] = useState<ExportMode>('mixdown');
    const [sampleRate, setSampleRate] = useState(defaults.sampleRate);
    const [bitDepth, setBitDepth] = useState(defaults.bitDepth);
    const [mp3BitRate, setMp3BitRate] = useState<Mp3BitRate>(defaults.mp3BitRate);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
    const [errorText, setErrorText] = useState('');
    const cancelledRef = useRef(false);

    const toggleFormat = (f: ExportFormat) => {
        setFormats((prev) => {
            const next = new Set(prev);
            // Don't allow empty selections
            if (next.has(f) && next.size > 1) {
                next.delete(f);
            } else {
                next.add(f);
            }
            saveExportSettings({ formats: Array.from(next), sampleRate, bitDepth, mp3BitRate });
            return next;
        });
    };

    const updateSampleRate = (sr: number) => {
        setSampleRate(sr);
        saveExportSettings({ formats: Array.from(formats), sampleRate: sr, bitDepth, mp3BitRate });
    };

    const updateBitDepth = (bd: number) => {
        setBitDepth(bd);
        saveExportSettings({ formats: Array.from(formats), sampleRate, bitDepth: bd, mp3BitRate });
    };

    const updateMp3BitRate = (br: Mp3BitRate) => {
        setMp3BitRate(br);
        saveExportSettings({ formats: Array.from(formats), sampleRate, bitDepth, mp3BitRate: br });
    };

    const handleCancel = () => {
        cancelledRef.current = true;
        cancelExport();
        setStatusText('Cooling down...');
    };

    // Helper: Trigger browser fallback download if Native API fails or is missing
    const triggerFallbackBlobDownload = (data: Uint8Array | ArrayBuffer, ext: string, blobName: string) => {
        const mimeMap: Record<string, string> = {
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
            '.flac': 'audio/flac',
            '.zip': 'application/zip',
        };
        const blob = new Blob([data as unknown as BlobPart], { type: mimeMap[ext] || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${blobName}${ext}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1500); // 1.5s to ensure click dispatches
    };

    const handleExport = async () => {
        setErrorText('');
        cancelledRef.current = false;
        const ts = Date.now();
        const baseName = `Sourdaw_Bake_${ts}`;

        let tauriDirPath: string | null = null;
        let tauriFilePath: string | null = null;

        // This Handle uses the new FileSystem Access API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let webFileHandle: any = null;

        // ── 1. SECURE THE DESTINATION EARLY ──
        try {
            if (isTauri()) {
                const { save, open } = await import('@tauri-apps/plugin-dialog');
                if (mode === 'stems') {
                    tauriDirPath = (await open({
                        directory: true,
                        multiple: false,
                        title: 'Select Output Folder for Slices (Stems)',
                    })) as string | null;
                    if (!tauriDirPath) {return;} // User cancelled
                } else {
                    const primaryExt = Array.from(formats)[0] || 'wav';
                    tauriFilePath = await save({
                        defaultPath: `${baseName}.${primaryExt}`,
                        filters: [{ name: 'Audio File', extensions: Array.from(formats) }],
                    });
                    if (!tauriFilePath) {return;} // User cancelled
                }
            } else {
                // Web Environment
                if ('showSaveFilePicker' in window) {
                    const isZip = mode === 'stems' || formats.size > 1; // Zipping required for >1 file
                    const primaryExt = Array.from(formats)[0] || 'wav';
                    const fileExt = isZip ? '.zip' : `.${primaryExt}`;
                    const mime = isZip
                        ? 'application/zip'
                        : primaryExt === 'wav'
                          ? 'audio/wav'
                          : primaryExt === 'flac'
                            ? 'audio/flac'
                            : 'audio/mpeg';

                    webFileHandle = await (
                        window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<unknown> }
                    ).showSaveFilePicker({
                        suggestedName: `${baseName}${fileExt}`,
                        types: [{ accept: { [mime]: [fileExt] } }],
                    });
                }
            }
        } catch (e) {
            // If user clicked cancel, abort quietly
            if (e instanceof Error && e.name === 'AbortError') {return;}
            // Otherwise, allow it to drop to fallback `<a download>` memory mode
        }

        // ── 2. PREPARATIONS COMPLETE. START INTENSIVE BAKING ──
        setExporting(true);
        setProgress(0);
        setStatusText('Heating the offline oven...');

        try {
            // Restore audio buffers from IndexedDB before rendering.
            // The primary CRDT load path (loadProject → projectCrdtToStores) does not
            // call restoreFromIdb, so on a cold page reload the in-memory cache is empty.
            // This call is idempotent — it skips IDs already in cache — so it is safe
            // to call on every export regardless of how the project was loaded.
            const ctx = getAudioContext();
            if (ctx) {
                // Pass only the buffer IDs referenced by this project's clips so
                // that unrelated takes from other sessions are not mass-loaded.
                const exportTracks = trackStore.value?.tracks ?? [];
                const neededIds = exportTracks
                    .flatMap((t) => t.clips.map((c) => c.audioBufferId))
                    .filter((id): id is string => Boolean(id));
                await audioBufferCache.restoreFromIdb(ctx, neededIds.length > 0 ? neededIds : undefined);
            } else {
                // Engine not yet initialised (pre-first-gesture) — proceed without
                // restore; buffers may already be warm from a previous operation.
                logger.warn(
                    'AudioContext not available during export — skipping IDB restore. Buffers may be incomplete.'
                );
            }

            const tracks = trackStore.value?.tracks ?? [];
            const maxBeat = Math.max(16, ...tracks.flatMap((t) => t.clips.map((c) => c.endBeat)));
            const bd = bitDepth as 16 | 24 | 32;
            const formatList = Array.from(formats);

            // We use fflate purely to zip multiple web stems / formats
            const zipDirectory: Record<string, Uint8Array> = {};

            const serializeAudio = async (
                buffer: AudioBuffer,
                name: string,
                fractionOffset: number,
                fractionRange: number
            ) => {
                let currentPass = 0;
                for (const f of formatList) {
                    if (cancelledRef.current) {return;}

                    const passProgress = (frac: number) => {
                        const subFraction = (currentPass + frac) / formatList.length;
                        setProgress(fractionOffset + subFraction * fractionRange);
                    };

                    setStatusText(`Kneading ${name} (${f.toUpperCase()})...`);
                    let fileData: Uint8Array | ArrayBuffer;

                    if (f === 'mp3') {
                        fileData = await encodeMp3(buffer, mp3BitRate, passProgress);
                    } else if (f === 'flac') {
                        fileData = await encodeFlac(buffer, passProgress);
                    } else {
                        fileData = await encodeWav(buffer, bd, passProgress);
                    }

                    const uint8Data = fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : fileData;
                    const finalFileName = `${name}.${f}`;

                    if (isTauri()) {
                        const { writeFile } = await import('@tauri-apps/plugin-fs');
                        // Use join from api if available, or just a simple slash for stems dict
                        const { join } = await import('@tauri-apps/api/path');
                        if (mode === 'stems' && tauriDirPath) {
                            const fullPath = await join(tauriDirPath, finalFileName);
                            await writeFile(fullPath, uint8Data);
                        } else if (tauriFilePath) {
                            // Single fallback mapping for mixdown
                            const adjustedPath = tauriFilePath.replace(/\.[a-z0-9]+$/i, `.${f}`);
                            await writeFile(adjustedPath, uint8Data);
                        }
                    } else {
                        // Web: Pack into the zip directory for later synchronous fflate compression
                        zipDirectory[finalFileName] = uint8Data;
                    }

                    currentPass++;
                }
            };

            // ── ACTUAL PROCESS ORCHESTRATION ──
            if (mode === 'stems') {
                setStatusText('Proofing Slices (rendering stems)...');
                // Accumulate warnings and emit a single summary toast to avoid notification spam
                const stemWarnings = new Set<string>();
                const stems = await exportStems({
                    durationBeats: maxBeat,
                    sampleRate,
                    onProgress: (frac) => {
                        const barPct = frac * 50;
                        setProgress(barPct);
                        if (Math.round(barPct) % 5 === 0) {setStatusText('Proofing slices...');}
                    },
                    onWarning: (msg) => {
                        logger.warn(msg);
                        stemWarnings.add(msg);
                    },
                });
                if (stemWarnings.size > 0) {
                    notifyUser(
                        stemWarnings.size === 1
                            ? `Export warning: ${[...stemWarnings][0]}`
                            : `Export completed with ${stemWarnings.size} warnings — check the console for details.`,
                        'warning'
                    );
                }
                if (cancelledRef.current) {return;}

                let doneStems = 0;
                const totalStems = stems.size;

                for (const [trackId, buffer] of stems) {
                    if (cancelledRef.current) {return;}
                    const track = tracks.find((t) => t.id === trackId);
                    const safeTName = (track?.name || trackId).replaceAll(/[^a-zA-Z0-9_\- ]/g, '_');

                    // We map the remaining 50% of the progress bar to encoding the slices
                    const stemOffset = 50 + (doneStems / totalStems) * 50;
                    const stemRange = 50 / totalStems;

                    await serializeAudio(buffer, safeTName, stemOffset, stemRange);
                    doneStems++;
                }
            } else {
                setStatusText('Proofing Whole Loaf (offline mixdown)...');
                // Accumulate warnings and emit a single summary toast to avoid notification spam
                const mixWarnings = new Set<string>();
                const buffer = await renderOffline({
                    durationBeats: maxBeat,
                    sampleRate,
                    onProgress: (frac) => {
                        const barPct = frac * 60;
                        setProgress(barPct);
                        if (Math.round(barPct) % 5 === 0) {setStatusText('Proofing whole loaf...');}
                    },
                    onWarning: (msg) => {
                        logger.warn(msg);
                        mixWarnings.add(msg);
                    },
                });
                if (mixWarnings.size > 0) {
                    notifyUser(
                        mixWarnings.size === 1
                            ? `Export warning: ${[...mixWarnings][0]}`
                            : `Export completed with ${mixWarnings.size} warnings — check the console for details.`,
                        'warning'
                    );
                }
                if (cancelledRef.current) {return;}

                // We map the remaining 40% of the progress bar to encoding the mixdown
                await serializeAudio(buffer, baseName, 60, 40);
            }

            if (cancelledRef.current) {return;}

            // ── 3. FINALIZE WEB SAVES ──
            if (!isTauri() && Object.keys(zipDirectory).length > 0) {
                setStatusText('Serving hot audio...');
                const isSingleFile = Object.keys(zipDirectory).length === 1 && mode !== 'stems';

                let finalBytes: Uint8Array;
                let finalExt: string;
                let finalName: string;

                if (isSingleFile) {
                    const singleKey = Object.keys(zipDirectory)[0]!;
                    finalBytes = zipDirectory[singleKey]!;
                    finalExt = `.${singleKey.split('.').pop()!}`;
                    finalName = baseName;
                } else {
                    // Zip the results synchronously
                    finalBytes = zipSync(zipDirectory, { level: 0 }); // level 0 for speed, audio doesn't compress well anyway
                    finalExt = '.zip';
                    finalName = mode === 'stems' ? `Sourdaw_Slices_${ts}` : `Sourdaw_Bakery_${ts}`;
                }

                if (webFileHandle) {
                    // File System Access Method
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                    const writable = await webFileHandle.createWritable();
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                    await writable.write(finalBytes);
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                    await writable.close();
                } else {
                    // Fallback
                    triggerFallbackBlobDownload(finalBytes, finalExt, finalName);
                }
            }

            setProgress(100);
            setStatusText('Ding! Baking Complete! 🍞');
            notifyUser('Ding! The audio finished baking', 'success');

            // Auto-close after 2.5s
            setTimeout(() => {
                if (open) {onClose();}
            }, 2500);
        } catch (error) {
            if (cancelledRef.current) {
                setStatusText('Oven turned off.');
            } else {
                const msg = error instanceof Error ? error.message : 'Unknown oven malfunction';
                logger.error(new Error('Export failed', { cause: error }));
                setErrorText(msg);
                setStatusText('The bread burned...');
                // Reset the bar so a stale half-filled value doesn't render beside the error box
                setProgress(0);
            }
        } finally {
            // Always unlock the UI. On cancel, delay briefly so the status text is readable.
            if (cancelledRef.current) {
                setTimeout(() => setExporting(false), 1500);
            } else {
                // Success or error — both unblock the button immediately.
                // progress===100 drives the "Close Bakery" button state; exporting===false re-enables export.
                setExporting(false);
            }
        }
    };

    const FORMAT_OPTIONS: { value: ExportFormat; label: string; desc: string }[] = [
        { value: 'wav', label: 'WAV', desc: 'Crisp, lossless' },
        { value: 'mp3', label: 'MP3', desc: 'Lossy crust' },
        { value: 'flac', label: 'FLAC', desc: 'Gluten-free lossless' },
    ];

    const sampleRates = [44100, 48000, 88200, 96000];
    const bitDepths = [16, 24, 32];

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen && !exporting) {
                    onClose();
                }
            }}
        >
            <DialogContent
                className="w-[480px] gap-0 overflow-hidden rounded-xl border border-orange-900/40 bg-stone-950 p-0 shadow-[0_0_40px_rgba(234,88,12,0.1)]"
                showCloseButton={!exporting}
            >
                <DialogHeader
                    className="relative overflow-hidden px-6 pb-4 pt-6 rounded-t-xl"
                    style={{
                        background: 'linear-gradient(180deg, rgba(120,53,15,0.4) 0%, rgba(10,10,10,1) 100%)',
                        boxShadow: 'inset 0 1px 0 rgba(251,146,60,0.1), inset 0 -1px rgba(251,146,60,0.05)',
                        margin: '-1.5rem -1.5rem 0 -1.5rem',
                    }}
                >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-amber-500/10 via-transparent to-transparent" />
                    <DialogTitle className="relative flex items-center gap-2 text-base font-semibold text-orange-50/90">
                        <Flame className="size-4 text-orange-500" />
                        The Bakery
                    </DialogTitle>
                    <p className="mt-0.5 text-xs tracking-wide text-orange-500/60">
                        Export your masterpiece straight from the Sourdaw oven.
                    </p>
                </DialogHeader>

                <DawDialogBody className="gap-4 bg-transparent px-6 py-5">
                    <DawDialogSection tone="warm" title="Render Order">
                        <div className="flex gap-2">
                            <Button
                                variant={mode === 'mixdown' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setMode('mixdown')}
                                className={
                                    mode === 'mixdown'
                                        ? 'w-full border-orange-500/30 bg-orange-700/20 text-orange-300 hover:bg-orange-700/30'
                                        : 'w-full border-orange-900/40 text-muted-foreground hover:border-orange-500/20 hover:bg-orange-950/20 hover:text-orange-200'
                                }
                                disabled={exporting}
                                style={mode === 'mixdown' ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' } : {}}
                            >
                                Whole Loaf <span className="ml-1 text-[10px] opacity-60">(Mixdown)</span>
                            </Button>
                            <Button
                                variant={mode === 'stems' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setMode('stems')}
                                className={
                                    mode === 'stems'
                                        ? 'w-full border-amber-500/30 bg-amber-700/20 text-amber-300 hover:bg-amber-700/30'
                                        : 'w-full border-orange-900/40 text-muted-foreground hover:border-amber-500/20 hover:bg-amber-950/20 hover:text-amber-200'
                                }
                                disabled={exporting}
                                style={mode === 'stems' ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' } : {}}
                            >
                                Slices <span className="ml-1 text-[10px] opacity-60">(Stems)</span>
                            </Button>
                        </div>
                    </DawDialogSection>

                    <DawDialogSection tone="warm" title="Ingredients">
                        <div className="grid grid-cols-3 gap-2">
                            {FORMAT_OPTIONS.map((f) => {
                                const active = formats.has(f.value);
                                return (
                                    <button
                                        type="button"
                                        key={f.value}
                                        className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                                            active
                                                ? 'border-orange-500/40 bg-orange-950/40 shadow-[inset_0_1px_0_rgba(251,146,60,0.1)]'
                                                : 'border-stone-800 bg-stone-900/50 hover:border-stone-700 hover:bg-stone-800/80'
                                        }`}
                                        onClick={() => toggleFormat(f.value)}
                                        aria-pressed={active}
                                        role="checkbox"
                                        aria-checked={active}
                                        disabled={exporting}
                                    >
                                        <div
                                            className={`text-sm font-semibold ${active ? 'text-orange-200' : 'text-stone-400'}`}
                                        >
                                            {f.label}
                                        </div>
                                        <div
                                            className={`mt-0.5 text-[10px] ${active ? 'text-orange-400/80' : 'text-stone-600'}`}
                                        >
                                            {f.desc}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </DawDialogSection>

                    <DawDialogSection
                        tone="warm"
                        title="Fidelity"
                        detail="Choose sample rate, bit depth, and compression quality."
                        bodyClassName={`grid gap-4 ${formats.has('mp3') ? 'grid-cols-3' : 'grid-cols-2'}`}
                    >
                        <div className="rounded-lg border border-stone-800/50 bg-stone-950/55 p-3">
                            <DawEyebrowLabel size="sm" className="mb-2 block font-bold tracking-widest text-stone-600">
                                Sample Rate
                            </DawEyebrowLabel>
                            <div className="flex flex-wrap gap-1">
                                {sampleRates.map((sr) => (
                                    <Button
                                        key={sr}
                                        variant="ghost"
                                        size="sm"
                                        className={`h-6 rounded-md px-2 text-[10px] ${
                                            sampleRate === sr
                                                ? 'bg-stone-800 text-stone-200'
                                                : 'text-stone-500 hover:bg-stone-800/50 hover:text-stone-300'
                                        }`}
                                        onClick={() => updateSampleRate(sr)}
                                        disabled={exporting}
                                    >
                                        {(sr / 1000).toFixed(1)}k
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-lg border border-stone-800/50 bg-stone-950/55 p-3">
                            <DawEyebrowLabel size="sm" className="mb-2 block font-bold tracking-widest text-stone-600">
                                Bit Depth
                            </DawEyebrowLabel>
                            <div className="flex flex-wrap gap-1">
                                {bitDepths.map((bd) => (
                                    <Button
                                        key={bd}
                                        variant="ghost"
                                        size="sm"
                                        className={`h-6 rounded-md px-2 text-[10px] ${
                                            bitDepth === bd
                                                ? 'bg-stone-800 text-stone-200'
                                                : 'text-stone-500 hover:bg-stone-800/50 hover:text-stone-300'
                                        }`}
                                        onClick={() => updateBitDepth(bd)}
                                        disabled={exporting}
                                    >
                                        {bd}-bit
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {formats.has('mp3') ? (
                            <div className="rounded-lg border border-stone-800/50 bg-stone-950/55 p-3">
                                <DawEyebrowLabel
                                    size="sm"
                                    className="mb-2 block font-bold tracking-widest text-stone-600"
                                >
                                    MP3 Quality
                                </DawEyebrowLabel>
                                <div className="flex flex-wrap gap-1">
                                    {([96, 128, 192, 320] as Mp3BitRate[]).map((br) => (
                                        <Button
                                            key={br}
                                            variant="ghost"
                                            size="sm"
                                            className={`h-6 rounded-md px-2 text-[10px] ${
                                                mp3BitRate === br
                                                    ? 'bg-stone-800 text-stone-200'
                                                    : 'text-stone-500 hover:bg-stone-800/50 hover:text-stone-300'
                                            }`}
                                            onClick={() => updateMp3BitRate(br)}
                                            disabled={exporting}
                                        >
                                            {br}k
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </DawDialogSection>

                    <DawDialogSection
                        tone="warm"
                        title="Oven Status"
                        detail={isTauri() ? 'Desktop oven ready' : 'Web oven ready'}
                    >
                        <div className="h-10">
                            {exporting || progress === 100 ? (
                                <div className="space-y-1.5 animate-in fade-in duration-300">
                                    <div className="flex items-end justify-between text-xs">
                                        <span
                                            className={`font-medium ${progress === 100 ? 'text-green-400' : 'text-orange-400'}`}
                                        >
                                            {statusText}
                                        </span>
                                        <span className="font-mono text-[10px] text-orange-500/50">
                                            {progress.toFixed(0)}%
                                        </span>
                                    </div>
                                    <div
                                        className="h-2 w-full overflow-hidden rounded-full border border-stone-800 bg-stone-900 shadow-inner"
                                        role="progressbar"
                                        aria-valuenow={Math.round(progress)}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                    >
                                        <div
                                            className={`h-full rounded-full transition-all duration-300 ease-out ${
                                                progress === 100
                                                    ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                                                    : 'bg-gradient-to-r from-amber-600 to-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.6)]'
                                            }`}
                                            style={{ width: `${progress}%` }}
                                        >
                                            {progress < 100 ? (
                                                <div className="absolute inset-0 w-[30%] animate-[shimmer_1.5s_infinite] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.4)_50%,transparent_100%)]" />
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            ) : errorText ? (
                                <div className="flex h-full items-center rounded-lg border border-red-900/30 bg-red-950/20 px-3 text-xs text-red-400 animate-in fade-in">
                                    {errorText}
                                </div>
                            ) : (
                                <div className="flex h-full flex-col justify-center text-center text-[10px] uppercase tracking-widest text-stone-500">
                                    {isTauri() ? 'Desktop Oven Ready' : 'Web Oven Ready'}
                                </div>
                            )}
                        </div>
                    </DawDialogSection>
                </DawDialogBody>

                <DawDialogFooter tone="warm" align="end" className="px-6">
                    {exporting ? (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleCancel}
                            className="border border-red-900/50 bg-red-950 text-red-400 hover:bg-red-900 hover:text-red-200"
                        >
                            <X className="mr-1 size-3.5" />
                            Turn off Oven
                        </Button>
                    ) : progress === 100 ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onClose}
                            className="border-green-900/50 text-green-400 hover:bg-green-950/30 hover:text-green-300"
                        >
                            <CheckCircle2 className="mr-1 size-3.5" />
                            Close Bakery
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClose}
                                className="text-stone-400 hover:text-stone-200"
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleExport}
                                disabled={formats.size === 0 || isExportActive()}
                                className="border-t border-orange-400/30 bg-orange-600 font-medium text-white shadow-[0_0_15px_rgba(234,88,12,0.3)] transition-all hover:bg-orange-500 hover:shadow-[0_0_20px_rgba(249,115,22,0.5)]"
                            >
                                <Flame className="mr-1.5 size-3.5 opacity-80" />
                                Start Baking
                            </Button>
                        </>
                    )}
                </DawDialogFooter>
            </DialogContent>
        </Dialog>
    );
};
