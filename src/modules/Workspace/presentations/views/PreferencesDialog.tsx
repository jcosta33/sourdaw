import { type ReactElement, useSyncExternalStore, useState, useRef } from 'react';
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
    BUFFER_SIZE_OPTIONS,
    SAMPLE_RATE_OPTIONS,
    type BufferSizeOption,
    type SampleRateOption,
} from '../../models/Preferences';
import {
    configureCloudApi,
    removeCloudApi,
    isCloudAvailable,
} from '#/modules/AiRuntime/useCases/cloudApiManagement';
import { resolveBackend } from '#/modules/AiRuntime/useCases/llmOrchestration';
import { cn } from '#/helpers/Styles/cn';
import {
    SectionTitle,
    FieldGroup,
    ToggleRow,
    VoiceKeyEditor,
    GridSubdivisionSection,
} from './preferencesShared';
import { ShortcutsSection } from './ShortcutsSection';

// ── Types ─────────────────────────────────────────────────────────────

type PreferencesDialogProps = {
    open: boolean;
    onClose: () => void;
};

type PreferencesSection = 'general' | 'appearance' | 'audio' | 'midi' | 'performance' | 'ai' | 'shortcuts';

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

// ── Section props ─────────────────────────────────────────────────────

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

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
                        {section === 'general' ? <GeneralSection prefs={prefs} update={update} /> : null}
                        {section === 'appearance' ? <AppearanceSection prefs={prefs} update={update} /> : null}
                        {section === 'audio' ? <AudioSection prefs={prefs} update={update} /> : null}
                        {section === 'midi' ? <MidiSection prefs={prefs} update={update} /> : null}
                        {section === 'performance' ? <PerformanceSection prefs={prefs} update={update} /> : null}
                        {section === 'ai' ? <AiSection /> : null}
                        {section === 'shortcuts' ? <ShortcutsSection /> : null}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
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

            <GridSubdivisionSection value={prefs.gridSubdivision} onChange={(v) => update({ gridSubdivision: v })} />

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
                    {prefs.metronomeEnabled ? (
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
                    ) : null}
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
                            backend === 'native' && 'bg-[var(--color-state-success)]/15 text-[var(--color-state-success)]',
                            backend === 'webllm' && 'bg-[var(--color-accent-cyan)]/15 text-[var(--color-accent-cyan)]',
                            backend === 'cloud' && 'bg-[var(--color-accent-lavender)]/15 text-[var(--color-accent-lavender)]',
                            backend === 'none' && 'bg-muted text-muted-foreground'
                        )}
                    >
                        <span
                            className={cn(
                                'size-1.5 rounded-full',
                                backend === 'native' && 'bg-[var(--color-state-success)]',
                                backend === 'webllm' && 'bg-[var(--color-accent-cyan)]',
                                backend === 'cloud' && 'bg-[var(--color-accent-lavender)]',
                                backend === 'none' && 'bg-muted-foreground'
                            )}
                        />
                        {backend === 'native'
                            ? 'Native (llama-server)'
                            : backend === 'cloud'
                              ? 'Cloud (Claude)'
                              : backend === 'webllm'
                                ? 'Browser (WebLLM)'
                                : 'None'}
                    </span>
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Cloud AI (Anthropic API)">
                <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
                    Enter your Anthropic API key to enable cloud AI features. Uses Claude Sonnet for the highest quality
                    tool calling. Keys are stored in memory only — not persisted.
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
                        <span className={isCloudAvailable() ? 'text-[var(--color-state-success)]' : 'text-[var(--color-state-warning)]'}>
                            {isCloudAvailable() ? 'Connected' : 'Not configured'}
                        </span>
                    </span>
                    {isCloudAvailable() ? (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-destructive text-[10px]"
                            onClick={removeCloudApi}
                        >
                            Remove Key
                        </Button>
                    ) : null}
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Audio Analysis">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Audio analysis features (pitch detection, spectral analysis, polyphonic audio-to-MIDI) run entirely
                    in the browser. No API key required.
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
