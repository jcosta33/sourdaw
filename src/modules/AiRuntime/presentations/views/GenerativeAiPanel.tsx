import { type ReactElement, useState } from 'react';
import { useStore } from '#/infra/store/useStore';
import { X, Sparkles, Music, RefreshCw, AudioWaveform, Library, Info, Upload } from 'lucide-react';
import { DawCompactTextarea } from '#/components/daw/DawCompactTextarea';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { DawUtilityNotice } from '#/components/daw/DawUtilityNotice';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { isTauri } from '#/helpers/tauriBridge';
import { workspaceStore, type WorkspaceState } from '#/modules/Workspace';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement';
import { aiStore, type AiTaskResult, toggleAiPanel, handleGenerateMidiPrompt, handleGenerateAudioFallback, handleStemSeparationPreview } from '#/modules/AiGeneration';
import { transportStore } from '#/modules/Transport';
import { AiTaskResultCard } from '../components/AiTaskResultCard';
import { GenreGrid, MoodGrid, InstrumentGrid } from '../components/GenerativeParamGrids';
import { PatternBrowser } from './PatternBrowser';

const DesktopOnlyNotice = ({ feature }: { feature: string }): ReactElement => (
    <DawUtilityNotice icon={<Info className="size-3.5 text-[var(--color-accent-amber)]" />}>
        <div>
            <span className="font-medium text-foreground/80">{feature}</span> requires the Sourdaw desktop app. It uses
            on-device AI models that need GPU access not available in browsers.
        </div>
    </DawUtilityNotice>
);

export const GenerativeAiPanel = (): ReactElement | null => {
    const state = useStore(aiStore, { isPanelOpen: false, tasks: [] });
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
    const workspaceState = useStore(workspaceStore, null as unknown as WorkspaceState);
    const selectedClipId = workspaceState?.selectedClipId ?? null;
    const trackState = useStore(trackStore, null as unknown as TrackStoreState);
    const tracks = trackState?.tracks ?? [];
    const selectedClip =
        tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId && c.type === 'audio') ?? null;

    const handleStemSep = () => {
        if (selectedClip) {
            handleStemSeparationPreview(selectedClip.id);
        }
    };

    return (
        <div className="w-[320px] border-l border-border/40 bg-surface-base flex flex-col h-full shrink-0 animate-in slide-in-from-right-8 duration-200">
            {/* Header */}
            <DawHeaderBand
                className="h-[38px] px-3"
                startSlot={<Sparkles className="size-4 text-[var(--color-accent-lavender)]" />}
                title="Generate"
                titleClassName="text-xs font-semibold normal-case tracking-tight text-foreground"
                actions={
                    <Button variant="ghost" size="icon-xs" onClick={toggleAiPanel} className="h-6 w-6">
                        <X className="size-3.5" />
                    </Button>
                }
            />

            {/* Tabs */}
            <div className="daw-analysis-card-header flex shrink-0 gap-1 p-2">
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
                            Select an audio clip on the timeline, then click Extract. The clip will be split into
                            individual stems (Vocals, Drums, Bass, Other).
                        </p>

                        {selectedClip ? (
                            <DawUtilitySection
                                title="Selected Clip"
                                detail="The current timeline selection will be split into stems."
                                bodyClassName="py-2"
                            >
                                <div className="flex items-center gap-2">
                                    <AudioWaveform className="size-4 text-[var(--color-accent-lavender)]" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[11px] font-medium text-foreground">
                                            {selectedClip.name}
                                        </div>
                                        <DawEyebrowLabel className="block">Audio Clip Selected</DawEyebrowLabel>
                                    </div>
                                </div>
                            </DawUtilitySection>
                        ) : (
                            <DawUtilityNotice tone="dashed" icon={<Upload className="size-4" />}>
                                <DawInlineHint className="bg-transparent px-0 py-0 text-[11px] text-muted-foreground/70">
                                    Select an audio clip on the timeline
                                </DawInlineHint>
                            </DawUtilityNotice>
                        )}

                        <Button
                            className="w-full h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white disabled:opacity-50"
                            onClick={handleStemSep}
                            disabled={!selectedClip}
                        >
                            <RefreshCw className="size-3.5 mr-2" /> Extract Stems
                        </Button>
                        <DawInlineHint className="justify-start px-0 py-0 text-muted-foreground/60">
                            First run downloads the model (~235 MB). Runs locally on your device.
                        </DawInlineHint>
                    </div>
                ) : null}

                {activeTab === 'audio' ? (
                    <div className="p-3 space-y-4">
                        {!isDesktop ? (
                            <DesktopOnlyNotice feature="Audio generation" />
                        ) : (
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <DawEyebrowLabel size="sm" className="block text-foreground/80">
                                        Describe the Sound
                                    </DawEyebrowLabel>
                                    <DawCompactTextarea
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        placeholder="e.g. warm vinyl crackle loop, 85 BPM"
                                        className="h-12 border-border/60 bg-surface-base p-2 resize-none"
                                    />
                                </div>

                                <div className="space-y-4 pt-1 pb-2">
                                    <ParamSection label="Genre" value={genre} onClear={() => setGenre('')}>
                                        <GenreGrid value={genre} onChange={setGenre} />
                                    </ParamSection>
                                    <ParamSection label="Mood" value={mood} onClear={() => setMood('')}>
                                        <MoodGrid value={mood} onChange={setMood} />
                                    </ParamSection>
                                    <ParamSection
                                        label="Instrument"
                                        value={instrument}
                                        onClear={() => setInstrument('')}
                                    >
                                        <InstrumentGrid value={instrument} onChange={setInstrument} />
                                    </ParamSection>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <DawEyebrowLabel size="sm" className="text-foreground/80">
                                            Duration
                                        </DawEyebrowLabel>
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
                                    <DawInlineHint className="justify-start px-0 py-0 text-muted-foreground/60">
                                        Max 11s per generation (Stable Audio Open)
                                    </DawInlineHint>
                                </div>

                                <Button
                                    className="w-full h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white"
                                    onClick={handleGenerate}
                                    disabled={!prompt.trim() && !genre && !instrument && !mood}
                                >
                                    <Sparkles className="size-3.5 mr-2" /> Generate Audio
                                </Button>
                                <DawInlineHint className="justify-start px-0 py-0 text-muted-foreground/60">
                                    First run downloads the model (~1.7 GB). Runs locally on your device.
                                </DawInlineHint>
                            </div>
                        )}
                    </div>
                ) : null}

                {activeTab === 'midi' && midiSubTab === 'ai' ? (
                    <div className="p-3 space-y-4">
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <DawEyebrowLabel size="sm" className="block text-foreground/80">
                                    Describe the Music
                                </DawEyebrowLabel>
                                <DawCompactTextarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="e.g. jazzy chord progression in D minor"
                                    className="h-12 border-border/60 bg-surface-base p-2 resize-none"
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
                                    <DawEyebrowLabel size="sm" className="text-foreground/80">
                                        Max Notes
                                    </DawEyebrowLabel>
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
                                    <DawEyebrowLabel size="sm" className="text-foreground/80">
                                        Creativity
                                    </DawEyebrowLabel>
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
                    <div
                        className="p-2"
                        style={{
                            borderTop: '1px solid transparent',
                            backgroundImage:
                                'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)',
                            backgroundSize: '100% 1px',
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'top',
                        }}
                    >
                        <DawUtilitySection
                            title="Recent"
                            detail="The latest generated clips, renders, and stem jobs."
                            bodyClassName="px-2 py-2"
                        >
                            <div className="space-y-1.5">
                                {state.tasks.map((task: AiTaskResult) => (
                                    <AiTaskResultCard key={task.id} task={task} />
                                ))}
                            </div>
                        </DawUtilitySection>
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
        <div className="flex items-center justify-between">
            <DawEyebrowLabel size="sm" className="text-foreground/90">
                {label}
            </DawEyebrowLabel>
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
        </div>
        {children}
    </div>
);
