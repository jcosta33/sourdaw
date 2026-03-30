import { type ReactElement, useState, useRef } from 'react';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import { Download, X } from 'lucide-react';
import { renderOffline, exportStems, cancelExport, downloadWav, downloadMp3, downloadFlac } from '../../useCases/exportActions';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

const logger = Container.getInstance().get(Logger);

type ExportFormat = 'wav' | 'mp3' | 'flac';
type ExportMode = 'mixdown' | 'stems';

type ExportDialogProps = {
    open: boolean;
    onClose: () => void;
};

const EXPORT_SETTINGS_KEY = 'sourdaw:export-settings';

const loadExportSettings = (): { formats: ExportFormat[]; sampleRate: number; bitDepth: number } => {
    try {
        const stored = localStorage.getItem(EXPORT_SETTINGS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                formats: Array.isArray(parsed.formats) ? parsed.formats : parsed.format ? [parsed.format] : ['wav'],
                sampleRate: parsed.sampleRate ?? 44100,
                bitDepth: parsed.bitDepth ?? 24,
            };
        }
    } catch {
        /* ignore */
    }
    return { formats: ['wav'], sampleRate: 44100, bitDepth: 24 };
};

const saveExportSettings = (settings: { formats: ExportFormat[]; sampleRate: number; bitDepth: number }): void => {
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
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
    const [errorText, setErrorText] = useState('');
    const cancelledRef = useRef(false);

    const toggleFormat = (f: ExportFormat) => {
        setFormats((prev) => {
            const next = new Set(prev);
            if (next.has(f) && next.size > 1) {
                next.delete(f);
            } else {
                next.add(f);
            }
            saveExportSettings({ formats: Array.from(next), sampleRate, bitDepth });
            return next;
        });
    };

    const updateSampleRate = (sr: number) => {
        setSampleRate(sr);
        saveExportSettings({ formats: Array.from(formats), sampleRate: sr, bitDepth });
    };
    const updateBitDepth = (bd: number) => {
        setBitDepth(bd);
        saveExportSettings({ formats: Array.from(formats), sampleRate, bitDepth: bd });
    };

    const handleCancel = () => {
        cancelledRef.current = true;
        cancelExport();
        setStatusText('Cancelling...');
    };

    const handleExport = async () => {
        setExporting(true);
        setProgress(0);
        setStatusText('Preparing...');
        setErrorText('');
        cancelledRef.current = false;

        try {
            const tracks = trackStore.value?.tracks ?? [];
            const maxBeat = Math.max(16, ...tracks.flatMap((t) => t.clips.map((c) => c.endBeat)));
            const bd = bitDepth as 16 | 24 | 32;
            const ts = Date.now();
            const formatList = Array.from(formats);

            if (mode === 'stems') {
                setStatusText('Rendering stems...');
                const stems = await exportStems({
                    durationBeats: maxBeat,
                    sampleRate,
                    onProgress: (frac) => {
                        setProgress(frac * 50);
                        setStatusText(`Rendering stems... ${Math.round(frac * 100)}%`);
                    },
                });
                if (cancelledRef.current) { return; }

                let done = 0;
                const total = stems.size * formatList.length;
                for (const [trackId, buffer] of stems) {
                    if (cancelledRef.current) { return; }
                    const track = tracks.find((t) => t.id === trackId);
                    const name = track?.name ?? trackId;
                    for (const f of formatList) {
                        if (cancelledRef.current) { return; }
                        const encodeProgress = (frac: number) => {
                            setProgress(50 + ((done + frac) / total) * 50);
                        };
                        setStatusText(`Encoding ${name} (${f.toUpperCase()})...`);
                        if (f === 'mp3') {
                            await downloadMp3(buffer, `${name}-${ts}.mp3`, 128, encodeProgress);
                        } else if (f === 'flac') {
                            await downloadFlac(buffer, `${name}-${ts}.flac`, encodeProgress);
                        } else {
                            await downloadWav(buffer, `${name}-${ts}.wav`, bd, encodeProgress);
                        }
                        done++;
                    }
                }
            } else {
                setStatusText('Rendering offline mixdown...');
                const buffer = await renderOffline({
                    durationBeats: maxBeat,
                    sampleRate,
                    onProgress: (frac) => {
                        setProgress(frac * 60);
                        setStatusText(`Rendering... ${Math.round(frac * 100)}%`);
                    },
                });
                if (cancelledRef.current) { return; }
                setProgress(60);

                let formatsDone = 0;
                for (const f of formatList) {
                    if (cancelledRef.current) { return; }
                    const encodeProgress = (frac: number) => {
                        const perFormat = 40 / formatList.length;
                        setProgress(60 + formatsDone * perFormat + frac * perFormat);
                    };
                    if (f === 'mp3') {
                        setStatusText('Encoding MP3...');
                        await downloadMp3(buffer, `sourdaw-export-${ts}.mp3`, 128, encodeProgress);
                    } else if (f === 'flac') {
                        setStatusText('Encoding FLAC...');
                        await downloadFlac(buffer, `sourdaw-export-${ts}.flac`, encodeProgress);
                    } else {
                        setStatusText('Encoding WAV...');
                        await downloadWav(buffer, `sourdaw-export-${ts}.wav`, bd, encodeProgress);
                    }
                    formatsDone++;
                }
            }

            if (!cancelledRef.current) {
                setProgress(100);
                setStatusText('Complete!');
                notifyUser('Audio exported successfully');
            }
        } catch (error) {
            if (cancelledRef.current) {
                setStatusText('Export cancelled');
            } else {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                logger.error(new Error('Export failed', { cause: error }));
                setErrorText(msg);
                setStatusText('Export failed');
            }
        } finally {
            setExporting(false);
        }
    };

    const FORMAT_OPTIONS: { value: ExportFormat; label: string; desc: string }[] = [
        { value: 'wav', label: 'WAV', desc: 'Uncompressed, lossless' },
        { value: 'mp3', label: 'MP3', desc: 'Compressed, lossy' },
        { value: 'flac', label: 'FLAC', desc: 'Compressed, lossless' },
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
            <DialogContent className="w-[480px] bg-surface-raised" showCloseButton={!exporting}>
                <DialogHeader
                    style={{
                        background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        margin: '-1.5rem -1.5rem 0 -1.5rem',
                        padding: '0.75rem 1.5rem',
                        borderRadius: '8px 8px 0 0',
                    }}
                >
                    <DialogTitle className="text-sm font-semibold">Export Audio</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                            Mode
                        </label>
                        <div className="flex gap-2">
                            {(['mixdown', 'stems'] as ExportMode[]).map((m) => (
                                <Button
                                    key={m}
                                    variant={mode === m ? 'secondary' : 'outline'}
                                    size="sm"
                                    onClick={() => setMode(m)}
                                    className="capitalize"
                                    disabled={exporting}
                                >
                                    {m}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <Separator style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)' }} />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                            Format
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {FORMAT_OPTIONS.map((f) => (
                                <button
                                    type="button"
                                    key={f.value}
                                    className={`rounded-md border px-3 py-2 text-left transition-colors ${formats.has(f.value) ? 'border-ring bg-accent' : 'border-border hover:bg-accent/50'}`}
                                    onClick={() => toggleFormat(f.value)}
                                    aria-pressed={formats.has(f.value)}
                                    role="checkbox"
                                    aria-checked={formats.has(f.value)}
                                    disabled={exporting}
                                >
                                    <div className="text-xs font-medium text-foreground">{f.label}</div>
                                    <div className="text-[10px] text-muted-foreground">{f.desc}</div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <Separator style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)' }} />

                    <div className="grid grid-cols-2 gap-4">
                        <section>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                                Sample Rate
                            </label>
                            <div className="flex flex-wrap gap-1">
                                {sampleRates.map((sr) => (
                                    <Button
                                        key={sr}
                                        variant={sampleRate === sr ? 'secondary' : 'ghost'}
                                        size="xs"
                                        onClick={() => updateSampleRate(sr)}
                                        disabled={exporting}
                                    >
                                        {(sr / 1000).toFixed(1)}k
                                    </Button>
                                ))}
                            </div>
                        </section>

                        <section>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                                Bit Depth
                            </label>
                            <div className="flex flex-wrap gap-1">
                                {bitDepths.map((bd) => (
                                    <Button
                                        key={bd}
                                        variant={bitDepth === bd ? 'secondary' : 'ghost'}
                                        size="xs"
                                        onClick={() => updateBitDepth(bd)}
                                        disabled={exporting}
                                    >
                                        {bd}-bit
                                    </Button>
                                ))}
                            </div>
                        </section>
                    </div>

                    <Separator style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)' }} />

                    {exporting ? (
                        <div className="space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{statusText}</span>
                                <span>{progress.toFixed(0)}%</span>
                            </div>
                            <div
                                className="h-1.5 w-full rounded-full overflow-hidden"
                                style={{ background: 'rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)' }}
                                role="progressbar"
                                aria-valuenow={Math.round(progress)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label="Export progress"
                            >
                                <div
                                    className="h-full rounded-full bg-primary transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    ) : null}

                    {errorText ? (
                        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                            {errorText}
                        </div>
                    ) : null}

                    <div className="flex justify-end gap-2">
                        {exporting ? (
                            <Button variant="destructive" size="sm" onClick={handleCancel}>
                                <X className="size-3.5 mr-1" />
                                Cancel Export
                            </Button>
                        ) : (
                            <>
                                <Button variant="ghost" size="sm" onClick={onClose}>
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={handleExport} disabled={formats.size === 0}>
                                    <Download className="size-3.5 mr-1" />
                                    Export {mode === 'stems' ? 'Stems' : 'Mixdown'}
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
