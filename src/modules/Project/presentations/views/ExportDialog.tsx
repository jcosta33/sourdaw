import { type ReactElement, useState } from 'react';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import { Download } from 'lucide-react';
import {
    renderOffline,
    exportStems,
    downloadWav,
    downloadMp3,
    downloadFlac,
} from '../../useCases/exportActions';
import { trackStore } from '#/modules/Track/stores/trackStore';

const logger = Container.getInstance().get(Logger);

type ExportFormat = 'wav' | 'mp3' | 'flac';
type ExportMode = 'mixdown' | 'stems';

type ExportDialogProps = {
    open: boolean;
    onClose: () => void;
};

const EXPORT_SETTINGS_KEY = 'webdaw:export-settings';

const loadExportSettings = (): { format: ExportFormat; sampleRate: number; bitDepth: number } => {
    try {
        const stored = localStorage.getItem(EXPORT_SETTINGS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                format: parsed.format ?? 'wav',
                sampleRate: parsed.sampleRate ?? 44100,
                bitDepth: parsed.bitDepth ?? 24,
            };
        }
    } catch {
        /* ignore */
    }
    return { format: 'wav', sampleRate: 44100, bitDepth: 24 };
};

const saveExportSettings = (settings: { format: ExportFormat; sampleRate: number; bitDepth: number }): void => {
    try {
        localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        /* ignore */
    }
};

export const ExportDialog = ({ open, onClose }: ExportDialogProps): ReactElement => {
    const defaults = loadExportSettings();
    const [format, setFormat] = useState<ExportFormat>(defaults.format);
    const [mode, setMode] = useState<ExportMode>('mixdown');
    const [sampleRate, setSampleRate] = useState(defaults.sampleRate);
    const [bitDepth, setBitDepth] = useState(defaults.bitDepth);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);

    const updateFormat = (f: ExportFormat) => {
        setFormat(f);
        saveExportSettings({ format: f, sampleRate, bitDepth });
    };
    const updateSampleRate = (sr: number) => {
        setSampleRate(sr);
        saveExportSettings({ format, sampleRate: sr, bitDepth });
    };
    const updateBitDepth = (bd: number) => {
        setBitDepth(bd);
        saveExportSettings({ format, sampleRate, bitDepth: bd });
    };

    const handleExport = async () => {
        setExporting(true);
        setProgress(10);

        try {
            const tracks = trackStore.value?.tracks ?? [];
            const maxBeat = Math.max(16, ...tracks.flatMap((t) => t.clips.map((c) => c.endBeat)));
            const bd = bitDepth as 16 | 24 | 32;
            const ts = Date.now();

            if (mode === 'stems') {
                setProgress(20);
                const stems = await exportStems(maxBeat, sampleRate);
                let done = 0;
                for (const [trackId, buffer] of stems) {
                    const track = tracks.find((t) => t.id === trackId);
                    const name = track?.name ?? trackId;
                    if (format === 'mp3') {
                        await downloadMp3(buffer, `${name}-${ts}.mp3`);
                    } else if (format === 'flac') {
                        downloadFlac(buffer, `${name}-${ts}.flac`);
                    } else {
                        downloadWav(buffer, `${name}-${ts}.wav`, bd);
                    }
                    done++;
                    setProgress(20 + (done / stems.size) * 80);
                }
            } else {
                setProgress(30);
                const buffer = await renderOffline(maxBeat, sampleRate);
                setProgress(80);
                if (format === 'mp3') {
                    await downloadMp3(buffer, `webdaw-export-${ts}.mp3`);
                } else if (format === 'flac') {
                    downloadFlac(buffer, `webdaw-export-${ts}.flac`);
                } else {
                    downloadWav(buffer, `webdaw-export-${ts}.wav`, bd);
                }
            }
            setProgress(100);
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: 'Audio exported successfully', level: 'info' },
                })
            );
        } catch (error) {
            logger.error(new Error('Export failed', { cause: error }));
        } finally {
            setExporting(false);
        }
    };

    const formats: { value: ExportFormat; label: string; desc: string }[] = [
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
                            {formats.map((f) => (
                                <button
                                    type="button"
                                    key={f.value}
                                    className={`rounded-md border px-3 py-2 text-left transition-colors ${format === f.value ? 'border-ring bg-accent' : 'border-border hover:bg-accent/50'}`}
                                    onClick={() => updateFormat(f.value)}
                                    aria-pressed={format === f.value}
                                    role="radio"
                                    aria-checked={format === f.value}
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
                                <span>Rendering...</span>
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
                        <Button size="sm" onClick={handleExport} disabled={exporting}>
                            <Download className="size-3.5 mr-1" />
                            {exporting ? 'Exporting...' : `Export ${mode === 'stems' ? 'Stems' : 'Mixdown'}`}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
