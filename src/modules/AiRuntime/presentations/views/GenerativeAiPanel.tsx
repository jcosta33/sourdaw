import { type ReactElement, useState, useSyncExternalStore } from 'react';
import { X, Sparkles, Music, Mic2, RefreshCw, AudioWaveform, Play, Plus, Loader2, Music4, Library } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { DisabledFeatureWrapper } from '#/components/ui/disabled-feature-wrapper';
import { isTauri } from '#/modules/AudioEngine/useCases/nativeAiBridge';
import {
    subscribeGenerativeAi,
    getGenerativeAiSnapshot,
    toggleGenerativeAiPanel,
    handleGenerateMidiPrompt,
    handleGenerateAudioFallback,
    handleStemSeparationPreview,
    removeTask,
    type AiTaskResult,
    type GenerativeAiState,
} from '#/modules/AiGeneration/useCases/generativeAiActions';
import { GenreGrid, MoodGrid, InstrumentGrid } from '../components/GenerativeParamGrids';
import { PatternBrowser } from './PatternBrowser';

export const GenerativeAiPanel = (): ReactElement | null => {
    const state = useSyncExternalStore<GenerativeAiState>(subscribeGenerativeAi, getGenerativeAiSnapshot);
    const [activeTab, setActiveTab] = useState<'audio' | 'midi' | 'stems'>('midi');
    const [midiSubTab, setMidiSubTab] = useState<'ai' | 'patterns'>('patterns');
    const [prompt, setPrompt] = useState('');
    const [genre, setGenre] = useState('');
    const [instrument, setInstrument] = useState('');
    const [mood, setMood] = useState('');
    const [audioDuration, setAudioDuration] = useState(4);
    const [midiNotes, setMidiNotes] = useState(32);
    const [creativity, setCreativity] = useState(65);
    const [audioStrength, setAudioStrength] = useState(70);

    if (!state.isPanelOpen) {
        return null;
    }

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
            handleGenerateAudioFallback(finalPrompt, audioDuration.toString(), audioStrength / 100);
        } else if (activeTab === 'midi') {
            handleGenerateMidiPrompt(finalPrompt, midiNotes, creativity / 100);
        }
        setPrompt('');
    };

    const handleStemSep = () => {
        // Just demonstrating with a fake clipId for now
        handleStemSeparationPreview('clip-123');
    };

    return (
        <div className="w-[320px] border-l border-border/40 bg-surface-base flex flex-col h-full shrink-0 animate-in slide-in-from-right-8 duration-200">
            {/* Header */}
            <div className="flex h-[38px] items-center justify-between border-b border-border/40 px-3 shrink-0 bg-surface-raised/50">
                <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-[var(--color-accent-lavender)]" />
                    <h2 className="text-xs font-semibold text-foreground tracking-tight">Generation</h2>
                </div>
                <Button variant="ghost" size="icon-xs" onClick={toggleGenerativeAiPanel} className="h-6 w-6">
                    <X className="size-3.5" />
                </Button>
            </div>

            {/* Primary Tabs */}
            <div className="flex p-2 gap-1 border-b border-border/20 shrink-0">
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
                        <Sparkles className="size-3" /> AI Generate
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
                            Drop an audio clip here or select one from the arrangement to separate it into 4 distinct
                            stems (Vocals, Drums, Bass, Other) using HTDemucs.
                        </p>
                        <div className="border-2 border-dashed border-border/50 rounded-lg p-6 flex flex-col items-center justify-center gap-2 bg-surface-base/50 text-muted-foreground hover:border-[var(--color-accent-lavender)]/50 hover:text-[var(--color-accent-lavender)] transition-colors cursor-pointer">
                            <Mic2 className="size-6" />
                            <span className="text-[11px] font-medium">Drop Audio File</span>
                        </div>
                        <DisabledFeatureWrapper
                            disabled={!isTauri()}
                            reason="Stem Separation requires the Tauri Desktop version of Sourdaw to run HTDemucs natively."
                            className="w-full flex"
                        >
                            <Button
                                className="w-full h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white flex justify-between"
                                onClick={handleStemSep}
                            >
                                <div className="flex items-center">
                                    <RefreshCw className="size-3.5 mr-2" /> Extract Stems
                                </div>
                                <span className="text-[9px] opacity-70 border border-white/40 rounded px-1">
                                    {isTauri() ? 'Desktop' : 'Web'}
                                </span>
                            </Button>
                        </DisabledFeatureWrapper>
                    </div>
                ) : null}

                {activeTab === 'audio' || (activeTab === 'midi' && midiSubTab === 'ai') ? (
                    <div className="p-3 space-y-4">
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-medium text-foreground/80">Prompt details</label>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder={
                                        activeTab === 'audio'
                                            ? 'e.g. vintage vinyl crackle, 85bpm'
                                            : 'e.g. jazzy chord progression in D minor'
                                    }
                                    className="w-full h-12 bg-surface-base border border-border/60 rounded-md p-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-purple-500/50 resize-none"
                                />
                            </div>

                            <div className="space-y-4 pt-1 pb-2">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-semibold text-foreground/90 uppercase tracking-wider flex items-center justify-between">
                                        Genre
                                        {genre ? (
                                            <Button
                                                variant="link"
                                                size="xs"
                                                className="h-4 p-0 text-[9px] text-muted-foreground hover:text-foreground"
                                                onClick={() => setGenre('')}
                                            >
                                                Clear
                                            </Button>
                                        ) : null}
                                    </label>
                                    <GenreGrid value={genre} onChange={setGenre} />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-semibold text-foreground/90 uppercase tracking-wider flex items-center justify-between">
                                        Mood
                                        {mood ? (
                                            <Button
                                                variant="link"
                                                size="xs"
                                                className="h-4 p-0 text-[9px] text-muted-foreground hover:text-foreground"
                                                onClick={() => setMood('')}
                                            >
                                                Clear
                                            </Button>
                                        ) : null}
                                    </label>
                                    <MoodGrid value={mood} onChange={setMood} />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-semibold text-foreground/90 uppercase tracking-wider flex items-center justify-between">
                                        Instrument Focus
                                        {instrument ? (
                                            <Button
                                                variant="link"
                                                size="xs"
                                                className="h-4 p-0 text-[9px] text-muted-foreground hover:text-foreground"
                                                onClick={() => setInstrument('')}
                                            >
                                                Clear
                                            </Button>
                                        ) : null}
                                    </label>
                                    <InstrumentGrid value={instrument} onChange={setInstrument} />
                                </div>
                            </div>

                            {activeTab === 'audio' ? (
                                <>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[10px] font-medium text-foreground/80">
                                                Duration
                                            </label>
                                            <span className="text-[10px] text-muted-foreground">{audioDuration}s</span>
                                        </div>
                                        <Slider
                                            value={[audioDuration]}
                                            onValueChange={([v]) => setAudioDuration(v!)}
                                            min={1}
                                            max={30}
                                            step={1}
                                            className="pt-1"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[10px] font-medium text-foreground/80">
                                                Strength
                                            </label>
                                            <span className="text-[10px] text-muted-foreground">{audioStrength}%</span>
                                        </div>
                                        <Slider
                                            value={[audioStrength]}
                                            onValueChange={([v]) => setAudioStrength(v!)}
                                            min={10}
                                            max={100}
                                            step={5}
                                            className="pt-1"
                                        />
                                        <p className="text-[9px] text-muted-foreground/60">
                                            Lower = subtle, higher = aggressive
                                        </p>
                                    </div>
                                </>
                            ) : null}

                            {activeTab === 'midi' && midiSubTab === 'ai' ? (
                                <>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[10px] font-medium text-foreground/80">
                                                Max Notes
                                            </label>
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
                                            <label className="text-[10px] font-medium text-foreground/80">
                                                Creativity
                                            </label>
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
                                        <p className="text-[9px] text-muted-foreground/60">
                                            Lower = predictable, higher = experimental
                                        </p>
                                    </div>
                                </>
                            ) : null}

                            <Button
                                className="w-full h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white flex justify-between items-center"
                                onClick={handleGenerate}
                                disabled={!prompt.trim() && !genre && !instrument && !mood}
                            >
                                <div className="flex items-center gap-2">
                                    <Sparkles className="size-3.5" />
                                    Generate {activeTab === 'audio' ? 'Audio' : 'MIDI'}
                                </div>
                                <span className="text-[9px] opacity-70 border border-white/40 rounded px-1">
                                    {activeTab === 'midi' ? 'WebLLM' : isTauri() ? 'Desktop' : 'Web'}
                                </span>
                            </Button>
                        </div>
                    </div>
                ) : null}

                {/* Results Library */}
                {state.tasks.length > 0 ? (
                    <div className="p-2 border-t border-border/20">
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

const TaskResultCard = ({ task }: { task: AiTaskResult }): ReactElement => {
    return (
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
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        className="h-5 w-5 hover:bg-destructive/20 hover:text-destructive"
                        onClick={() => removeTask(task.id)}
                    >
                        <X className="size-3" />
                    </Button>
                </div>
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
                    <div className="text-[10px] text-destructive">Error: {task.error}</div>
                ) : null}
                {task.status === 'success' ? (
                    <div className="flex items-center justify-between mt-1 pt-1 border-t border-border/30">
                        <span className="text-[9px] text-muted-foreground/70">
                            {task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : 'Done'}
                        </span>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="secondary"
                                size="icon-xs"
                                className="h-5 w-5 bg-surface-base"
                                title="Preview"
                            >
                                <Play className="size-3 text-foreground" />
                            </Button>
                            <Button
                                variant="secondary"
                                size="icon-xs"
                                className="h-5 w-5 bg-surface-base"
                                title="Drag to arrangement"
                            >
                                <Plus className="size-3 text-foreground" />
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
};
