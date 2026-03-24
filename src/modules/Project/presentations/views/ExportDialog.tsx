import { type ReactElement, useState } from 'react';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import { Download } from 'lucide-react';
import { renderOffline, exportStems, downloadWav, downloadMp3, downloadFlac } from '../../useCases/exportActions';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

const logger = Container.getInstance().get(Logger);

type ExportFormat = 'wav' | 'mp3' | 'flac';
type ExportMode = 'mixdown' | 'stems';

type ExportDialogProps = {
    open: boolean;
    onClose: () => void;
};

const EXPORT_SETTINGS_KEY = 'webdaw:export-settings';

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

    const handleExport = async () => {
        setExporting(true);
        setProgress(0);
        setStatusText('Preparing...');

        try {
            const tracks = trackStore.value?.tracks ?? [];
            const maxBeat = Math.max(16, ...tracks.flatMap((t) => t.clips.map((c) => c.endBeat)));
            const bd = bitDepth as 16 | 24 | 32;
            const ts = Date.now();
            const formatList = Array.from(formats);

            if (mode === 'stems') {
                setStatusText('Rendering stems...');
                setProgress(5);
                const stems = await exportStems(maxBeat, sampleRate);
                let done = 0;
                const total = stems.size * formatList.length;
                for (const [trackId, buffer] of stems) {
                    const track = tracks.find((t) => t.id === trackId);
                    const name = track?.name ?? trackId;
                    for (const f of formatList) {
                        const encodeProgress = (frac: number) => {
                            setProgress(10 + ((done + frac) / total) * 90);
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
                        setProgress(10 + (done / total) * 90);
                    }
                }
            } else {
                // Mixdown: rendering = 0-60%, encoding = 60-100%
                setStatusText('Rendering offline mixdown...');
                setProgress(5);
                const buffer = await renderOffline(maxBeat, sampleRate);
                setProgress(60);

                let formatsDone = 0;
                for (const f of formatList) {
                    const encodeProgress = (frac: number) => {
                        const perFormat = 40 / formatList.length;
                        setProgress(60 + formatsDone * perFormat + frac * perFormat);
                    };
                    if (f === 'mp3') {
                        setStatusText('Encoding MP3...');
                        await downloadMp3(buffer, `webdaw-export-${ts}.mp3`, 128, encodeProgress);
                    } else if (f === 'flac') {
                        setStatusText('Encoding FLAC...');
                        await downloadFlac(buffer, `webdaw-export-${ts}.flac`, encodeProgress);
                    } else {
                        setStatusText('Encoding WAV...');
                        await downloadWav(buffer, `webdaw-export-${ts}.wav`, bd, encodeProgress);
                    }
                    formatsDone++;
                }
            }
            setProgress(100);
            setStatusText('Complete!');
            notifyUser('Audio exported successfully');
        } catch (error) {
            logger.error(new Error('Export failed', { cause: error }));
            setStatusText('Export failed');
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
                if (!isOpen) {
                    onClose();
                }
            }}
        >
            <DialogContent className="w-[480px] bg-surface-raised" showCloseButton={!exporting}>
                <DialogHeader>
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
                                >
                                    {m}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <Separator />

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
                                >
                                    <div className="text-xs font-medium text-foreground">{f.label}</div>
                                    <div className="text-[10px] text-muted-foreground">{f.desc}</div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <Separator />

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
                                    >
                                        {bd}-bit
                                    </Button>
                                ))}
                            </div>
                        </section>
                    </div>

                    <Separator />

                    {exporting && (
                        <div className="space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{statusText}</span>
                                <span>{progress.toFixed(0)}%</span>
                            </div>
                            <div
                                className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden"
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
                    )}

                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={onClose} disabled={exporting}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleExport} disabled={exporting || formats.size === 0}>
                            <Download className="size-3.5 mr-1" />
                            {exporting ? 'Exporting...' : `Export ${mode === 'stems' ? 'Stems' : 'Mixdown'}`}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
