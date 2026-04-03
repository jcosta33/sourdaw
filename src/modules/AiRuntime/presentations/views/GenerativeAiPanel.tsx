import { type ReactElement, useState, useSyncExternalStore } from 'react';
import { X, Sparkles, Music, RefreshCw, AudioWaveform, Play, Plus, Loader2, Music4, Library, Info, Upload } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { isTauri } from '#/helpers/tauriBridge';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import {
    subscribeAiStore,
    getAiSnapshot,
    type AiTaskResult,
    type AiState,
} from '#/modules/AiGeneration/stores/aiStore';
import { toggleAiPanel } from '#/modules/AiGeneration/useCases/actions/toggleAiPanel';
import { removeTask } from '#/modules/AiGeneration/useCases/actions/removeTask';
import { handleGenerateMidiPrompt } from '#/modules/AiGeneration/useCases/actions/handleGenerateMidiPrompt';
import { handleGenerateAudioFallback } from '#/modules/AiGeneration/useCases/actions/handleGenerateAudioFallback';
import { handleStemSeparationPreview } from '#/modules/AiGeneration/useCases/actions/handleStemSeparationPreview';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { GenreGrid, MoodGrid, InstrumentGrid } from '../components/GenerativeParamGrids';
import { PatternBrowser } from './PatternBrowser';

const DesktopOnlyNotice = ({ feature }: { feature: string }): ReactElement => (
    <div className="flex items-start gap-2 p-3 rounded-md bg-surface-raised/80 border border-border/40 text-[10px] text-muted-foreground leading-relaxed">
        <Info className="size-3.5 shrink-0 mt-0.5 text-[var(--color-accent-amber)]" />
        <div>
            <span className="font-medium text-foreground/80">{feature}</span> requires the Sourdaw desktop app.
            It uses on-device AI models that need GPU access not available in browsers.
        </div>
    </div>
);

export const GenerativeAiPanel = (): ReactElement | null => {
    const state = useSyncExternalStore<AiState>(subscribeAiStore, getAiSnapshot);
    const [activeTab, setActiveTab] = useState<'audio' | 'midi' | 'stems'>('midi');
    const [midiSubTab, setMidiSubTab] = useState<'ai' | 'patterns'>('patterns');
    const [prompt, setPrompt] = useState('');
    const [genre, setGenre] = useState('');
    const [instrument, setInstrument] = useState('');
    const [mood, setMood] = useState('');
    const [audioDuration, setAudioDuration] = useState(4);
    const [midiNotes, setMidiNotes] = useState(32);
    const [creativity, setCreativity] = useState(65);

    if (!state.isPanelOpen) {
        return null;
    }

    const isDesktop = isTauri();

    const handleGenerate = () => {
        const metadata = [
            genre && `Genre: ${genre}`,
            instrument && `Instrument: ${instrument}`,
            mood && `Mood: ${mood}`,
        ]
            .filter(Boolean)
            .join(', ');

        const finalPrompt = metadata ? `[${metadata}] ${prompt}`.trim() : prompt.trim();
        if (!finalPrompt) {
            return;
        }

        if (activeTab === 'audio') {
            const bpm = transportStore.value?.tempo ?? 120;
            handleGenerateAudioFallback(`${String(Math.round(bpm))} BPM, ${finalPrompt}`, audioDuration.toString());
        } else if (activeTab === 'midi') {
            handleGenerateMidiPrompt(finalPrompt, midiNotes, creativity / 100);
        }
        setPrompt('');
    };

    // Get selected audio clip for stem separation
    const selectedClipId = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(cb),
        () => workspaceStore.value?.selectedClipId ?? null
    );
    const selectedClip = useSyncExternalStore(
        (cb) => trackStore.subscribe(cb),
        () => {
            if (!selectedClipId) { return null; }
            const tracks = trackStore.value?.tracks ?? [];
            for (const t of tracks) {
                const c = t.clips.find((clip) => clip.id === selectedClipId);
                if (c && c.type === 'audio') { return c; }
            }
            return null;
        }
    );

    const handleStemSep = () => {
        if (selectedClip) {
            handleStemSeparationPreview(selectedClip.id);
        }
    };

    return (
        <div className="w-[320px] border-l border-border/40 bg-surface-base flex flex-col h-full shrink-0 animate-in slide-in-from-right-8 duration-200">
            {/* Header */}
            <div
                className="flex h-[38px] items-center justify-between border-b px-3 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                    border: '1px solid rgba(0,0,0,0.4)',
                    borderBottom: '1px solid rgba(40,40,40,0.3)',
                }}
            >
                <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-[var(--color-accent-lavender)]" />
                    <h2 className="text-xs font-semibold text-foreground tracking-tight">Generate</h2>
                </div>
                <Button variant="ghost" size="icon-xs" onClick={toggleAiPanel} className="h-6 w-6">
                    <X className="size-3.5" />
                </Button>
            </div>

            {/* Tabs */}
            <div
                className="flex p-2 gap-1 shrink-0"
                style={{ borderBottom: '1px solid transparent', backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)', backgroundSize: '100% 1px', backgroundRepeat: 'no-repeat', backgroundPosition: 'bottom' }}
            >
                <Button
                    variant={activeTab === 'midi' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setActiveTab('midi')}
                >
                    <Music className="size-3" /> MIDI
                </Button>
                <Button
                    variant={activeTab === 'audio' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setActiveTab('audio')}
                >
                    <AudioWaveform className="size-3" /> Audio
                </Button>
                <Button
                    variant={activeTab === 'stems' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setActiveTab('stems')}
                >
                    <RefreshCw className="size-3" /> Stems
                </Button>
            </div>

            {/* MIDI Sub-tabs */}
            {activeTab === 'midi' ? (
                <div className="flex px-3 pt-2 pb-1 gap-2 shrink-0">
                    <Button
                        variant={midiSubTab === 'patterns' ? 'secondary' : 'ghost'}
                        size="xs"
                        className={
                            midiSubTab === 'patterns'
                                ? 'text-[var(--color-accent-lavender)] drop-shadow-[0_0_4px_var(--color-accent-lavender)]'
                                : ''
                        }
                        onClick={() => setMidiSubTab('patterns')}
                    >
                        <Library className="size-3" /> Patterns
                    </Button>
                    <Button
                        variant={midiSubTab === 'ai' ? 'secondary' : 'ghost'}
                        size="xs"
                        className={
                            midiSubTab === 'ai'
                                ? 'text-[var(--color-accent-lavender)] drop-shadow-[0_0_4px_var(--color-accent-lavender)]'
                                : ''
                        }
                        onClick={() => setMidiSubTab('ai')}
                    >
                        <Sparkles className="size-3" /> AI
                    </Button>
                </div>
            ) : null}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {activeTab === 'midi' && midiSubTab === 'patterns' ? (
                    <div className="p-3">
                        <PatternBrowser />
                    </div>
                ) : null}

                {activeTab === 'stems' ? (
                    <div className="p-3 space-y-3">
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                            Select an audio clip on the timeline, then click Extract.
                            The clip will be split into individual stems (Vocals, Drums, Bass, Other).
                        </p>

                        {selectedClip ? (
                            <div className="flex items-center gap-2 p-2 rounded-md bg-surface-raised border border-border/40">
                                <AudioWaveform className="size-4 text-[var(--color-accent-lavender)]" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-medium text-foreground truncate">{selectedClip.name}</div>
                                    <div className="text-[9px] text-muted-foreground">Audio clip selected</div>
                                </div>
                            </div>
                        ) : (
                            <div
                                className="flex items-center gap-2 p-3 rounded-md border border-dashed border-border/50 text-muted-foreground"
                                style={{
                                    background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                                }}
                            >
                                <Upload className="size-4" />
                                <span className="text-[11px]">Select an audio clip on the timeline</span>
                            </div>
                        )}

                        <Button
                            className="w-full h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white disabled:opacity-50"
                            onClick={handleStemSep}
                            disabled={!selectedClip}
                        >
                            <RefreshCw className="size-3.5 mr-2" /> Extract Stems
                        </Button>
                        <p className="text-[9px] text-muted-foreground/60">
                            First run downloads the model (~235 MB). Runs locally on your device.
                        </p>
                    </div>
                ) : null}

                {activeTab === 'audio' ? (
                    <div className="p-3 space-y-4">
                        {!isDesktop ? (
                            <DesktopOnlyNotice feature="Audio generation" />
                        ) : (
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-medium text-foreground/80">Describe the sound</label>
                                    <textarea
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        placeholder="e.g. warm vinyl crackle loop, 85 BPM"
                                        className="w-full h-12 bg-surface-base border border-border/60 rounded-md p-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-purple-500/50 resize-none"
                                    />
                                </div>

                                <div className="space-y-4 pt-1 pb-2">
                                    <ParamSection label="Genre" value={genre} onClear={() => setGenre('')}>
                                        <GenreGrid value={genre} onChange={setGenre} />
                                    </ParamSection>
                                    <ParamSection label="Mood" value={mood} onClear={() => setMood('')}>
                                        <MoodGrid value={mood} onChange={setMood} />
                                    </ParamSection>
                                    <ParamSection label="Instrument" value={instrument} onClear={() => setInstrument('')}>
                                        <InstrumentGrid value={instrument} onChange={setInstrument} />
                                    </ParamSection>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-medium text-foreground/80">Duration</label>
                                        <span className="text-[10px] text-muted-foreground">{audioDuration}s</span>
                                    </div>
                                    <Slider
                                        value={[audioDuration]}
                                        onValueChange={([v]) => setAudioDuration(v!)}
                                        min={1}
                                        max={11}
                                        step={1}
                                        className="pt-1"
                                    />
                                    <p className="text-[9px] text-muted-foreground/60">Max 11s per generation (Stable Audio Open)</p>
                                </div>

                                <Button
                                    className="w-full h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white"
                                    onClick={handleGenerate}
                                    disabled={!prompt.trim() && !genre && !instrument && !mood}
                                >
                                    <Sparkles className="size-3.5 mr-2" /> Generate Audio
                                </Button>
                                <p className="text-[9px] text-muted-foreground/60">
                                    First run downloads the model (~1.7 GB). Runs locally on your device.
                                </p>
                            </div>
                        )}
                    </div>
                ) : null}

                {activeTab === 'midi' && midiSubTab === 'ai' ? (
                    <div className="p-3 space-y-4">
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-medium text-foreground/80">Describe the music</label>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="e.g. jazzy chord progression in D minor"
                                    className="w-full h-12 bg-surface-base border border-border/60 rounded-md p-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-purple-500/50 resize-none"
                                />
                            </div>

                            <div className="space-y-4 pt-1 pb-2">
                                <ParamSection label="Genre" value={genre} onClear={() => setGenre('')}>
                                    <GenreGrid value={genre} onChange={setGenre} />
                                </ParamSection>
                                <ParamSection label="Mood" value={mood} onClear={() => setMood('')}>
                                    <MoodGrid value={mood} onChange={setMood} />
                                </ParamSection>
                                <ParamSection label="Instrument" value={instrument} onClear={() => setInstrument('')}>
                                    <InstrumentGrid value={instrument} onChange={setInstrument} />
                                </ParamSection>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-medium text-foreground/80">Max Notes</label>
                                    <span className="text-[10px] text-muted-foreground">{midiNotes}</span>
                                </div>
                                <Slider
                                    value={[midiNotes]}
                                    onValueChange={([v]) => setMidiNotes(v!)}
                                    min={4}
                                    max={128}
                                    step={4}
                                    className="pt-1"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-medium text-foreground/80">Creativity</label>
                                    <span className="text-[10px] text-muted-foreground">{creativity}%</span>
                                </div>
                                <Slider
                                    value={[creativity]}
                                    onValueChange={([v]) => setCreativity(v!)}
                                    min={10}
                                    max={100}
                                    step={5}
                                    className="pt-1"
                                />
                            </div>

                            <Button
                                className="w-full h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white"
                                onClick={handleGenerate}
                                disabled={!prompt.trim() && !genre && !instrument && !mood}
                            >
                                <Sparkles className="size-3.5 mr-2" /> Generate MIDI
                            </Button>
                        </div>
                    </div>
                ) : null}

                {/* Results */}
                {state.tasks.length > 0 ? (
                    <div className="p-2" style={{ borderTop: '1px solid transparent', backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)', backgroundSize: '100% 1px', backgroundRepeat: 'no-repeat', backgroundPosition: 'top' }}>
                        <h3 className="text-[10px] font-semibold text-muted-foreground mb-2 px-1 uppercase tracking-wider">
                            Recent
                        </h3>
                        <div className="space-y-1.5">
                            {state.tasks.map((task: AiTaskResult) => (
                                <TaskResultCard key={task.id} task={task} />
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

// ── Helpers ──────────────────────────────────────────────────────────────

const ParamSection = ({
    label,
    value,
    onClear,
    children,
}: {
    label: string;
    value: string;
    onClear: () => void;
    children: ReactElement;
}): ReactElement => (
    <div className="space-y-2">
        <label className="text-[10px] font-semibold text-foreground/90 uppercase tracking-wider flex items-center justify-between">
            {label}
            {value ? (
                <Button
                    variant="link"
                    size="xs"
                    className="h-4 p-0 text-[9px] text-muted-foreground hover:text-foreground"
                    onClick={onClear}
                >
                    Clear
                </Button>
            ) : null}
        </label>
        {children}
    </div>
);

const TaskResultCard = ({ task }: { task: AiTaskResult }): ReactElement => (
    <div className="group relative bg-surface-raised border border-border/40 rounded-md p-2 text-xs flex flex-col gap-1.5 hover:border-[var(--color-accent-lavender)]/40 transition-colors">
        <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
                {task.type === 'midi-generation' ? (
                    <Music4 className="size-3 text-[var(--color-accent-mint)]" />
                ) : task.type === 'stem-separation' ? (
                    <RefreshCw className="size-3 text-[var(--color-accent-peach)]" />
                ) : (
                    <AudioWaveform className="size-3 text-[var(--color-accent-lavender)]" />
                )}
                <span className="font-medium capitalize text-foreground/90 leading-none">
                    {task.type.replace('-', ' ')}
                </span>
            </div>
            <Button
                variant="ghost"
                size="icon-xs"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 hover:text-destructive"
                onClick={() => removeTask(task.id)}
            >
                <X className="size-3" />
            </Button>
        </div>

        {task.prompt ? (
            <div className="text-[10px] text-muted-foreground italic line-clamp-2">"{task.prompt}"</div>
        ) : null}

        <div className="mt-1">
            {task.status === 'processing' ? (
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-accent-lavender)]">
                    <Loader2 className="size-3 animate-spin" /> Processing...
                </div>
            ) : null}
            {task.status === 'error' ? (
                <div className="text-[10px] text-destructive">{task.error}</div>
            ) : null}
            {task.status === 'success' ? (
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/30">
                    <span className="text-[9px] text-muted-foreground/70">
                        {task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : 'Done'}
                    </span>
                    <div className="flex items-center gap-1">
                        <Button variant="secondary" size="icon-xs" className="h-5 w-5 bg-surface-base" title="Preview">
                            <Play className="size-3 text-foreground" />
                        </Button>
                        <Button variant="secondary" size="icon-xs" className="h-5 w-5 bg-surface-base" title="Add to arrangement">
                            <Plus className="size-3 text-foreground" />
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    </div>
);
