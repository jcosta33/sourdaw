import { type ReactElement, useSyncExternalStore, useState, useEffect, useRef } from 'react';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import { Sun, Moon, KeyboardMusic, AudioLines, Keyboard } from 'lucide-react';
import { MidiDevicePicker } from '#/modules/AudioEngine/presentations/views/MidiDevicePicker';
import { AudioDevicePicker } from '#/modules/AudioEngine/presentations/views/AudioDevicePicker';
import { PluginScanSettings } from '#/modules/AudioEngine/presentations/views/PluginScanSettings';
import { preferencesStore } from '../../stores/preferencesStore';
import {
    defaultPreferences,
    type Preferences,
    GRID_SNAP_OPTIONS,
    type GridSnapOption,
    BUFFER_SIZE_OPTIONS,
    SAMPLE_RATE_OPTIONS,
    type BufferSizeOption,
    type SampleRateOption,
} from '../../models/Preferences';

type PreferencesDialogProps = {
    open: boolean;
    onClose: () => void;
};

const subscribe = (cb: () => void) => preferencesStore.subscribe(cb);
const getSnapshot = () => preferencesStore.value ?? defaultPreferences;

export const PreferencesDialog = ({ open, onClose }: PreferencesDialogProps): ReactElement => {
    const prefs = useSyncExternalStore(subscribe, getSnapshot);

    const prefsRef = useRef(prefs);
    prefsRef.current = prefs;

    const update = (partial: Partial<Preferences>) => {
        preferencesStore.set({ ...prefsRef.current, ...partial });
    };

    const trackHeights: Preferences['trackHeight'][] = ['compact', 'normal', 'large'];

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    onClose();
                }
            }}
        >
            <DialogContent className="w-[420px] max-h-[85vh] overflow-y-auto bg-surface-raised">
                <DialogHeader>
                    <DialogTitle className="text-sm font-semibold">Preferences</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                            Track Height
                        </label>
                        <div className="flex gap-2">
                            {trackHeights.map((h) => (
                                <Button
                                    key={h}
                                    variant={prefs.trackHeight === h ? 'secondary' : 'outline'}
                                    size="sm"
                                    onClick={() => update({ trackHeight: h })}
                                    className="capitalize"
                                >
                                    {h}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <Separator />

                    <GridSubdivisionSection
                        value={prefs.gridSubdivision}
                        onChange={(v) => update({ gridSubdivision: v })}
                    />

                    <Separator />

                    <section className="space-y-3">
                        <ToggleRow
                            label="Snap to Grid"
                            value={prefs.snapToGrid}
                            onChange={(v) => update({ snapToGrid: v })}
                        />
                        <ToggleRow label="Auto Save" value={prefs.autoSave} onChange={(v) => update({ autoSave: v })} />
                        <ToggleRow
                            label="Colorblind Mode"
                            value={prefs.colorblindMode}
                            onChange={(v) => update({ colorblindMode: v })}
                        />
                        <ToggleRow
                            label="Show Minimap"
                            value={prefs.showMinimap}
                            onChange={(v) => update({ showMinimap: v })}
                        />
                    </section>

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                            Theme
                        </label>
                        <div className="flex gap-2">
                            {(['dark', 'light'] as const).map((t) => (
                                <Button
                                    key={t}
                                    variant={prefs.theme === t ? 'secondary' : 'outline'}
                                    size="sm"
                                    onClick={() => {
                                        update({ theme: t });
                                        document.documentElement.classList.toggle('dark', t === 'dark');
                                        document.documentElement.classList.toggle('light', t === 'light');
                                    }}
                                    className="capitalize gap-1"
                                >
                                    {t === 'dark' ? <Moon className="size-3" /> : <Sun className="size-3" />}
                                    {t}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                            Metronome
                        </label>
                        <div className="space-y-2">
                            <ToggleRow
                                label="Metronome"
                                value={prefs.metronomeEnabled}
                                onChange={(v) => update({ metronomeEnabled: v })}
                            />
                            {prefs.metronomeEnabled && (
                                <div className="space-y-1">
                                    <label className="text-[10px] text-muted-foreground block">Volume</label>
                                    <Slider
                                        value={[prefs.metronomeVolume * 100]}
                                        onValueChange={([v]) => {
                                            if (v !== undefined) {
                                                update({ metronomeVolume: v / 100 });
                                            }
                                        }}
                                        max={100}
                                        step={1}
                                        className="w-full"
                                        aria-label="Metronome volume"
                                    />
                                </div>
                            )}
                        </div>
                    </section>

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                            Recording
                        </label>
                        <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground block">Count-In (bars)</label>
                            <div className="flex gap-1">
                                {([0, 1, 2, 4] as const).map((bars) => (
                                    <Button
                                        key={bars}
                                        variant={prefs.recordCountIn === bars ? 'secondary' : 'ghost'}
                                        size="xs"
                                        onClick={() => update({ recordCountIn: bars })}
                                    >
                                        {bars === 0 ? 'Off' : `${bars}`}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </section>

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                            MIDI Defaults
                        </label>
                        <div className="space-y-2">
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground block">Default Velocity</label>
                                <div className="flex items-center gap-2">
                                    <Slider
                                        value={[prefs.defaultVelocity]}
                                        onValueChange={([v]) => {
                                            if (v !== undefined) {
                                                update({ defaultVelocity: v });
                                            }
                                        }}
                                        min={1}
                                        max={127}
                                        step={1}
                                        className="flex-1"
                                        aria-label="Default MIDI velocity"
                                    />
                                    <span className="text-[10px] font-mono text-muted-foreground w-6 text-right">
                                        {prefs.defaultVelocity}
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground block">Input Channel</label>
                                <select
                                    value={prefs.midiInputChannel === 'all' ? 'all' : String(prefs.midiInputChannel)}
                                    onChange={(e) =>
                                        update({
                                            midiInputChannel: e.target.value === 'all' ? 'all' : Number(e.target.value),
                                        })
                                    }
                                    className="w-full h-8 rounded-md border border-border bg-surface-overlay px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    aria-label="MIDI input channel"
                                >
                                    <option value="all">All Channels</option>
                                    {Array.from({ length: 16 }, (_, i) => (
                                        <option key={i + 1} value={i + 1}>
                                            Channel {i + 1}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </section>

                    <Separator />

                    <VoiceKeyEditor
                        currentKey={prefs.voiceCommandKey}
                        onChange={(key) => update({ voiceCommandKey: key })}
                    />

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                            Performance
                        </label>
                        <div className="space-y-2">
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground block">Buffer Size</label>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={prefs.bufferSize}
                                        onChange={(e) =>
                                            update({ bufferSize: Number(e.target.value) as BufferSizeOption })
                                        }
                                        className="flex-1 h-8 rounded-md border border-border bg-surface-overlay px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                        aria-label="Buffer size"
                                    >
                                        {BUFFER_SIZE_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                    <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                                        ~{((prefs.bufferSize / prefs.sampleRate) * 1000).toFixed(1)}ms
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground block">Sample Rate</label>
                                <select
                                    value={prefs.sampleRate}
                                    onChange={(e) => update({ sampleRate: Number(e.target.value) as SampleRateOption })}
                                    className="w-full h-8 rounded-md border border-border bg-surface-overlay px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    aria-label="Sample rate"
                                >
                                    {SAMPLE_RATE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </section>

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                            <AudioLines className="size-3" aria-hidden="true" />
                            Audio Devices
                        </label>
                        <AudioDevicePicker />
                    </section>

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                            <KeyboardMusic className="size-3" aria-hidden="true" />
                            MIDI Input
                        </label>
                        <MidiDevicePicker />
                    </section>

                    <Separator />

                    <PluginScanSettings />

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Keyboard className="size-3" aria-hidden="true" />
                            Keyboard Shortcuts
                        </label>
                        <div className="grid grid-cols-2 gap-y-1 text-[10px]">
                            <span className="text-muted-foreground">Play / Stop</span>
                            <span className="text-right font-mono text-foreground">Space</span>
                            <span className="text-muted-foreground">Record</span>
                            <span className="text-right font-mono text-foreground">R</span>
                            <span className="text-muted-foreground">Undo / Redo</span>
                            <span className="text-right font-mono text-foreground">⌘Z / ⇧⌘Z</span>
                            <span className="text-muted-foreground">Save</span>
                            <span className="text-right font-mono text-foreground">⌘S</span>
                            <span className="text-muted-foreground">Export</span>
                            <span className="text-right font-mono text-foreground">⇧⌘E</span>
                            <span className="text-muted-foreground">Command Palette</span>
                            <span className="text-right font-mono text-foreground">⌘K</span>
                            <span className="text-muted-foreground">Preferences</span>
                            <span className="text-right font-mono text-foreground">⌘,</span>
                            <span className="text-muted-foreground">Nudge Note ←/→</span>
                            <span className="text-right font-mono text-foreground">Arrow Keys</span>
                            <span className="text-muted-foreground">Transpose ±1 / ±Oct</span>
                            <span className="text-right font-mono text-foreground">↑↓ / ⇧↑↓</span>
                            <span className="text-muted-foreground">Delete</span>
                            <span className="text-right font-mono text-foreground">⌫</span>
                        </div>
                    </section>

                    <Separator />

                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => preferencesStore.set(defaultPreferences)}>
                            Reset to Defaults
                        </Button>
                        <Button size="sm" onClick={onClose}>
                            Done
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const VoiceKeyEditor = ({
    currentKey,
    onChange,
}: {
    currentKey: string;
    onChange: (key: string) => void;
}): ReactElement => {
    const [listening, setListening] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!listening) {
            return;
        }
        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key.length === 1) {
                onChange(e.key.toLowerCase());
            }
            setListening(false);
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [listening, onChange]);

    return (
        <section>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                Voice Command Key
            </label>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    ref={ref}
                    className={`rounded px-3 py-1.5 text-xs font-mono border transition-colors ${listening ? 'border-primary bg-primary/10 text-primary animate-pulse' : 'border-border bg-surface-overlay text-foreground'}`}
                    onClick={() => setListening(true)}
                >
                    {listening ? 'Press a key...' : currentKey.toUpperCase()}
                </button>
                <span className="text-[10px] text-muted-foreground">
                    {listening ? 'Listening for keypress' : 'Click to change — hold to activate voice input'}
                </span>
            </div>
        </section>
    );
};

const GRID_GROUPS: { label: string; options: GridSnapOption[] }[] = [
    { label: 'Standard', options: ['bar', 'beat', '1/2', '1/4', '1/8', '1/16', '1/32'] },
    { label: 'Triplet', options: ['1/4T', '1/8T', '1/16T'] },
    { label: 'Dotted', options: ['1/4D', '1/8D'] },
    { label: '', options: ['off'] },
];

const GridSubdivisionSection = ({
    value,
    onChange,
}: {
    value: GridSnapOption;
    onChange: (v: GridSnapOption) => void;
}): ReactElement => {
    return (
        <section>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                Grid Snap
            </label>
            <div className="space-y-1.5">
                {GRID_GROUPS.map((group) => (
                    <div key={group.label || 'misc'} className="flex flex-wrap gap-1 items-center">
                        {group.label && (
                            <span className="text-[9px] text-muted-foreground/60 w-12 shrink-0">{group.label}</span>
                        )}
                        {group.options.map((opt) => {
                            const entry = GRID_SNAP_OPTIONS.find((o) => o.value === opt);
                            return (
                                <Button
                                    key={opt}
                                    variant={value === opt ? 'secondary' : 'ghost'}
                                    size="xs"
                                    onClick={() => onChange(opt)}
                                >
                                    {entry?.label ?? opt}
                                </Button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </section>
    );
};

const ToggleRow = ({
    label,
    value,
    onChange,
}: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
}): ReactElement => {
    return (
        <div className="flex items-center justify-between">
            <span className="text-xs text-foreground">{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={value}
                className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-muted/50'}`}
                onClick={() => onChange(!value)}
            >
                <span
                    className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`}
                />
            </button>
        </div>
    );
};
