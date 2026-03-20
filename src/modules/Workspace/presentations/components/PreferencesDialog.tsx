import { type ReactElement, useSyncExternalStore, useState, useEffect, useRef } from 'react';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';
import { Input } from '#/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import {
    Sun,
    Moon,
    KeyboardMusic,
    AudioLines,
    Keyboard,
    Palette,
    Cpu,
    Sparkles,
    Settings,
    Eye,
    EyeOff,
} from 'lucide-react';
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
import {
    configureCloudApi,
    removeCloudApi,
    isCloudApiAvailable,
    resolveBackend,
} from '../../useCases/workspaceViewActions';
import { shortcutStore, updateShortcutBinding, resetShortcutsToDefault, formatKeyBinding } from '../../models/Shortcuts';
import { cn } from '#/helpers/Styles/cn';

// ── Types ─────────────────────────────────────────────────────────────

type PreferencesDialogProps = {
    open: boolean;
    onClose: () => void;
};

type PreferencesSection =
    | 'general'
    | 'appearance'
    | 'audio'
    | 'midi'
    | 'performance'
    | 'ai'
    | 'shortcuts';

type NavItem = {
    id: PreferencesSection;
    label: string;
    icon: ReactElement;
};

const NAV_ITEMS: NavItem[] = [
    { id: 'general', label: 'General', icon: <Settings className="size-3.5" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette className="size-3.5" /> },
    { id: 'audio', label: 'Audio', icon: <AudioLines className="size-3.5" /> },
    { id: 'midi', label: 'MIDI', icon: <KeyboardMusic className="size-3.5" /> },
    { id: 'performance', label: 'Performance', icon: <Cpu className="size-3.5" /> },
    { id: 'ai', label: 'AI', icon: <Sparkles className="size-3.5" /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="size-3.5" /> },
];

// ── Store wiring ──────────────────────────────────────────────────────

const subscribe = (cb: () => void) => preferencesStore.subscribe(cb);
const getSnapshot = () => preferencesStore.value ?? defaultPreferences;

// ── Main dialog ───────────────────────────────────────────────────────

export const PreferencesDialog = ({ open, onClose }: PreferencesDialogProps): ReactElement => {
    const prefs = useSyncExternalStore(subscribe, getSnapshot);
    const [section, setSection] = useState<PreferencesSection>('general');

    const prefsRef = useRef(prefs);
    prefsRef.current = prefs;

    const update = (partial: Partial<Preferences>) => {
        preferencesStore.set({ ...prefsRef.current, ...partial });
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    onClose();
                }
            }}
        >
            <DialogContent className="w-[720px] max-w-[90vw] max-h-[80vh] p-0 bg-surface-raised overflow-hidden">
                <div className="flex h-[520px]">
                    {/* ── Sidebar navigation ── */}
                    <nav className="flex flex-col w-[180px] shrink-0 border-r border-border bg-surface-base/60 p-3 gap-0.5">
                        <DialogHeader className="mb-3">
                            <DialogTitle className="text-sm font-semibold">Preferences</DialogTitle>
                        </DialogHeader>
                        {NAV_ITEMS.map((item) => (
                            <button
                                type="button"
                                key={item.id}
                                className={cn(
                                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors text-left',
                                    section === item.id
                                        ? 'bg-primary/10 text-primary font-medium'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                                )}
                                onClick={() => setSection(item.id)}
                            >
                                {item.icon}
                                {item.label}
                            </button>
                        ))}

                        <div className="mt-auto flex flex-col gap-1.5">
                            <Separator />
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start text-xs text-muted-foreground"
                                onClick={() => preferencesStore.set(defaultPreferences)}
                            >
                                Reset Defaults
                            </Button>
                            <Button size="sm" className="w-full text-xs" onClick={onClose}>
                                Done
                            </Button>
                        </div>
                    </nav>

                    {/* ── Content area ── */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-5">
                        {section === 'general' && <GeneralSection prefs={prefs} update={update} />}
                        {section === 'appearance' && <AppearanceSection prefs={prefs} update={update} />}
                        {section === 'audio' && <AudioSection prefs={prefs} update={update} />}
                        {section === 'midi' && <MidiSection prefs={prefs} update={update} />}
                        {section === 'performance' && <PerformanceSection prefs={prefs} update={update} />}
                        {section === 'ai' && <AiSection />}
                        {section === 'shortcuts' && <ShortcutsSection />}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

// ── Section types ─────────────────────────────────────────────────────

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

// ── General ───────────────────────────────────────────────────────────

const GeneralSection = ({ prefs, update }: SectionProps): ReactElement => {
    const trackHeights: Preferences['trackHeight'][] = ['compact', 'normal', 'large'];

    return (
        <>
            <SectionTitle icon={<Settings className="size-4" />} title="General" />

            <FieldGroup label="Track Height">
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
            </FieldGroup>

            <GridSubdivisionSection
                value={prefs.gridSubdivision}
                onChange={(v) => update({ gridSubdivision: v })}
            />

            <Separator />

            <div className="space-y-3">
                <ToggleRow label="Snap to Grid" value={prefs.snapToGrid} onChange={(v) => update({ snapToGrid: v })} />
                <ToggleRow label="Auto Save" value={prefs.autoSave} onChange={(v) => update({ autoSave: v })} />
                <ToggleRow
                    label="Show Minimap"
                    value={prefs.showMinimap}
                    onChange={(v) => update({ showMinimap: v })}
                />
            </div>

            <Separator />

            <FieldGroup label="Metronome">
                <div className="space-y-2">
                    <ToggleRow
                        label="Enabled"
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
            </FieldGroup>

            <Separator />

            <FieldGroup label="Recording">
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
            </FieldGroup>

            <VoiceKeyEditor currentKey={prefs.voiceCommandKey} onChange={(key) => update({ voiceCommandKey: key })} />
        </>
    );
};

// ── Appearance ────────────────────────────────────────────────────────

const AppearanceSection = ({ prefs, update }: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<Palette className="size-4" />} title="Appearance" />

        <FieldGroup label="Theme">
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
        </FieldGroup>

        <Separator />

        <ToggleRow
            label="Colorblind Mode"
            value={prefs.colorblindMode}
            onChange={(v) => update({ colorblindMode: v })}
        />
    </>
);

// ── Audio ─────────────────────────────────────────────────────────────

const AudioSection = (_props: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<AudioLines className="size-4" />} title="Audio" />

        <FieldGroup label="Audio Devices">
            <AudioDevicePicker />
        </FieldGroup>

        <Separator />

        <PluginScanSettings />
    </>
);

// ── MIDI ──────────────────────────────────────────────────────────────

const MidiSection = ({ prefs, update }: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<KeyboardMusic className="size-4" />} title="MIDI" />

        <FieldGroup label="MIDI Input">
            <MidiDevicePicker />
        </FieldGroup>

        <Separator />

        <FieldGroup label="Default Velocity">
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
        </FieldGroup>

        <FieldGroup label="Input Channel">
            <select
                value={prefs.midiInputChannel === 'all' ? 'all' : String(prefs.midiInputChannel)}
                onChange={(e) =>
                    update({ midiInputChannel: e.target.value === 'all' ? 'all' : Number(e.target.value) })
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
        </FieldGroup>
    </>
);

// ── Performance ───────────────────────────────────────────────────────

const PerformanceSection = ({ prefs, update }: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<Cpu className="size-4" />} title="Performance" />

        <FieldGroup label="Buffer Size">
            <div className="flex items-center gap-2">
                <select
                    value={prefs.bufferSize}
                    onChange={(e) => update({ bufferSize: Number(e.target.value) as BufferSizeOption })}
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
                    ~{((prefs.bufferSize / prefs.sampleRate) * 1000).toFixed(1)}ms latency
                </span>
            </div>
        </FieldGroup>

        <FieldGroup label="Sample Rate">
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
        </FieldGroup>
    </>
);

// ── AI Settings ───────────────────────────────────────────────────────

const AiSection = (): ReactElement => {
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const backend = resolveBackend();

    return (
        <>
            <SectionTitle icon={<Sparkles className="size-4" />} title="AI" />

            <FieldGroup label="Active Backend">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium',
                            backend === 'native' && 'bg-emerald-500/15 text-emerald-400',
                            backend === 'webllm' && 'bg-blue-500/15 text-blue-400',
                            backend === 'cloud' && 'bg-purple-500/15 text-purple-400',
                            backend === 'none' && 'bg-muted text-muted-foreground'
                        )}
                    >
                        <span className={cn(
                            'size-1.5 rounded-full',
                            backend === 'native' && 'bg-emerald-400',
                            backend === 'webllm' && 'bg-blue-400',
                            backend === 'cloud' && 'bg-purple-400',
                            backend === 'none' && 'bg-muted-foreground'
                        )} />
                        {backend === 'native' ? 'Native (llama-server)'
                            : backend === 'cloud' ? 'Cloud (Claude)'
                            : backend === 'webllm' ? 'Browser (WebLLM)'
                            : 'None'}
                    </span>
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Cloud AI (Anthropic API)">
                <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
                    Enter your Anthropic API key to enable cloud AI features.
                    Uses Claude Sonnet for the highest quality tool calling.
                    Keys are stored in memory only — not persisted.
                </p>
                <div className="flex gap-1.5">
                    <div className="relative flex-1">
                        <Input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk-ant-api03-..."
                            className="h-8 text-xs font-mono pr-8"
                            aria-label="Anthropic API key"
                        />
                        <button
                            type="button"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowKey((prev) => !prev)}
                            aria-label={showKey ? 'Hide API key' : 'Show API key'}
                        >
                            {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                        </button>
                    </div>
                    <Button
                        size="sm"
                        className="h-8 text-xs"
                        disabled={!apiKey.trim()}
                        onClick={() => {
                            configureCloudApi(apiKey.trim());
                            setApiKey('');
                        }}
                    >
                        Save
                    </Button>
                </div>

                <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-muted-foreground">
                        Status:{' '}
                        <span className={isCloudApiAvailable() ? 'text-emerald-400' : 'text-amber-400'}>
                            {isCloudApiAvailable() ? 'Connected' : 'Not configured'}
                        </span>
                    </span>
                    {isCloudApiAvailable() && (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-destructive text-[10px]"
                            onClick={removeCloudApi}
                        >
                            Remove Key
                        </Button>
                    )}
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Audio Analysis">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Audio analysis features (pitch detection, spectral analysis, polyphonic audio-to-MIDI)
                    run entirely in the browser. No API key required.
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1.5 text-[10px]">
                    <span className="text-muted-foreground">Polyphonic MIDI</span>
                    <span className="text-right text-foreground">@spotify/basic-pitch</span>
                    <span className="text-muted-foreground">Pitch Detection</span>
                    <span className="text-right text-foreground">pitchy (McLeod)</span>
                    <span className="text-muted-foreground">Feature Extraction</span>
                    <span className="text-right text-foreground">meyda</span>
                </div>
            </FieldGroup>
        </>
    );
};

// ── Shortcuts ─────────────────────────────────────────────────────────

const ACTION_LABELS: Record<import('../../models/Shortcuts').ShortcutAction, string> = {
    PLAY_PAUSE: 'Play / Pause',
    STOP_RETURN: 'Stop (Return to 0)',
    RECORD_TOGGLE: 'Record',
    LOOP_TOGGLE: 'Loop Selection',
    UNDO: 'Undo',
    REDO: 'Redo',
    COPY: 'Copy Selected',
    PASTE: 'Paste',
    DELETE: 'Delete Selection',
    SPLIT_CLIP: 'Split Clip at Playhead',
    DUPLICATE: 'Duplicate',
    SAVE_PROJECT: 'Save Project',
    TOGGLE_MIXER: 'Open/Close Mixer',
    TOGGLE_INSPECTOR: 'Open/Close Inspector',
    TOGGLE_AI_ASSISTANT: 'Open/Close AI Chat',
};

const ShortcutsSection = (): ReactElement => {
    const shortcutState = useSyncExternalStore(
        (cb) => shortcutStore.subscribe(() => cb()),
        () => shortcutStore.value,
        () => shortcutStore.value
    );

    const [editingAction, setEditingAction] = useState<import('../../models/Shortcuts').ShortcutAction | null>(null);

    useEffect(() => {
        if (!editingAction) return;

        const handleGlobalKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Ignore standalone modifiers
            if (['Meta', 'Shift', 'Alt', 'Control', 'CapsLock'].includes(e.key)) {
                return;
            }

            updateShortcutBinding(editingAction, {
                key: e.key,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
            });
            setEditingAction(null);
        };

        window.addEventListener('keydown', handleGlobalKey, true);
        return () => window.removeEventListener('keydown', handleGlobalKey, true);
    }, [editingAction]);

    if (!shortcutState) return <></>;

    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <SectionTitle icon={<Keyboard className="size-4" />} title="Keyboard Shortcuts" />
                <Button variant="ghost" size="xs" onClick={resetShortcutsToDefault} className="text-[10px] text-muted-foreground">
                    Reset to Defaults
                </Button>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-y-2 gap-x-4">
                {Object.entries(ACTION_LABELS).map(([actionKey, label]) => {
                    const action = actionKey as import('../../models/Shortcuts').ShortcutAction;
                    const binding = shortcutState.bindings[action];
                    const isEditing = editingAction === action;

                    return (
                        <div key={action} className="flex items-center justify-between group">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <button
                                type="button"
                                className={cn(
                                    'min-w-[80px] text-right rounded px-2 py-1 text-xs font-mono border transition-colors',
                                    isEditing 
                                        ? 'border-primary bg-primary/10 text-primary animate-pulse' 
                                        : 'border-transparent hover:border-border bg-surface-overlay text-foreground'
                                )}
                                onClick={() => setEditingAction(action)}
                            >
                                {isEditing ? 'Press keys...' : formatKeyBinding(binding)}
                            </button>
                        </div>
                    );
                })}
            </div>
            {editingAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-auto">
                    <div className="bg-surface-raised border border-border rounded-lg p-6 shadow-2xl flex flex-col items-center gap-2">
                        <Keyboard className="size-8 text-primary mb-2" />
                        <h3 className="font-semibold text-lg">Binding: {ACTION_LABELS[editingAction]}</h3>
                        <p className="text-sm text-muted-foreground">Press the desired key combination.</p>
                        <Button variant="ghost" size="sm" className="mt-4" onClick={() => setEditingAction(null)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
};

// ── Shared components ─────────────────────────────────────────────────

const SectionTitle = ({ icon, title }: { icon: ReactElement; title: string }): ReactElement => (
    <div className="flex items-center gap-2 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
);

const FieldGroup = ({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}): ReactElement => (
    <section className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block">
            {label}
        </label>
        {children}
    </section>
);

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
        <FieldGroup label="Voice Command Key">
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
        </FieldGroup>
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
        <FieldGroup label="Grid Snap">
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
        </FieldGroup>
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
