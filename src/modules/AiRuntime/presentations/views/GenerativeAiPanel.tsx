import { type ReactElement, useState } from 'react';

import { X, Sparkles, Library, Loader2 } from 'lucide-react';

import { DawCompactTextarea } from '#/components/daw/DawCompactTextarea';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { useStore } from '#/infra/store/useStore';
import { PatternBrowser } from '#/modules/AiGeneration/presentations/views';
import { aiStore } from '#/modules/AiGeneration/stores';
import {
    toggleAiPanel,
    handleGenerateMidiPrompt,
    cancelProcessingTask,
    removeTask,
} from '#/modules/AiGeneration/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { AiTaskResultCard } from '../components/AiTaskResultCard';
import { GenreGrid, MoodGrid, InstrumentGrid } from '../components/GenerativeParamGrids';

type GenerativeTaskType = 'midi-generation' | 'stem-separation' | 'denoise';

type GenerativeTaskStatus = 'idle' | 'processing' | 'success' | 'error';

type GenerativeTaskResult = {
    id: string;
    type: GenerativeTaskType;
    status: GenerativeTaskStatus;
    prompt?: string;
    timestamp: number;
    error?: string;
    data?: unknown;
    durationMs?: number;
};

type GenerativeAiState = {
    isPanelOpen: boolean;
    tasks: GenerativeTaskResult[];
};

export const GenerativeAiPanel = (): ReactElement | null => {
    const state = useStore<GenerativeAiState>(aiStore, { isPanelOpen: false, tasks: [] });
    const [midiSubTab, setMidiSubTab] = useState<'ai' | 'patterns'>('patterns');
    const [prompt, setPrompt] = useState('');
    const [midiGenre, setMidiGenre] = useState('');
    const [midiMood, setMidiMood] = useState('');
    const [midiInstrument, setMidiInstrument] = useState('');
    const [midiNotes, setMidiNotes] = useState(32);
    const [creativity, setCreativity] = useState(65);

    if (!state.isPanelOpen) {
        return null;
    }

    // In-flight detection — disable the Generate button while a task of the matching
    // type is already processing. This prevents double-submits and gives clear feedback.
    const midiIsProcessing = state.tasks.some(
        (time) => time.type === 'midi-generation' && time.status === 'processing'
    );
    const handleCancelMidi = (): void => {
        cancelProcessingTask('midi-generation');
        notifyUser('MIDI generation cancelled — result may still appear if the request was already in flight', 'info');
    };

    const handleGenerate = () => {
        const metadata = [
            midiGenre && `Genre: ${midiGenre}`,
            midiInstrument && `Instrument: ${midiInstrument}`,
            midiMood && `Mood: ${midiMood}`,
        ]
            .filter(Boolean)
            .join(', ');

        const finalPrompt = metadata ? `[${metadata}] ${prompt}`.trim() : prompt.trim();
        if (!finalPrompt) {
            return;
        }

        void handleGenerateMidiPrompt(finalPrompt, midiNotes, creativity / 100);
        setPrompt('');
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
            {/* MIDI Sub-tabs */}
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
            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {midiSubTab === 'patterns' ? (
                    <div className="p-3">
                        <PatternBrowser />
                    </div>
                ) : null}

                {midiSubTab === 'ai' ? (
                    <div className="p-3 space-y-4">
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <DawEyebrowLabel size="sm" className="block text-foreground/80">
                                    Describe the Music
                                </DawEyebrowLabel>
                                <DawCompactTextarea
                                    value={prompt}
                                    onChange={(event) => setPrompt(event.target.value)}
                                    placeholder="e.g. jazzy chord progression in D minor"
                                    className="h-12 border-border/60 bg-surface-base p-2 resize-none"
                                />
                            </div>

                            <div className="space-y-4 pt-1 pb-2">
                                <ParamSection label="Genre" value={midiGenre} onClear={() => setMidiGenre('')}>
                                    <GenreGrid value={midiGenre} onChange={setMidiGenre} />
                                </ParamSection>
                                <ParamSection label="Mood" value={midiMood} onClear={() => setMidiMood('')}>
                                    <MoodGrid value={midiMood} onChange={setMidiMood} />
                                </ParamSection>
                                <ParamSection
                                    label="Instrument"
                                    value={midiInstrument}
                                    onClear={() => setMidiInstrument('')}
                                >
                                    <InstrumentGrid value={midiInstrument} onChange={setMidiInstrument} />
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
                                    onValueChange={([value]) => setMidiNotes(value!)}
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
                                    onValueChange={([value]) => setCreativity(value!)}
                                    min={10}
                                    max={100}
                                    step={5}
                                    className="pt-1"
                                />
                            </div>

                            {midiIsProcessing ? (
                                <div className="flex gap-2">
                                    <Button
                                        className="flex-1 h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white opacity-60"
                                        disabled
                                    >
                                        <Loader2 className="size-3.5 mr-2 animate-spin" /> Generating…
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                                        onClick={handleCancelMidi}
                                        title="Force-stop — the background request may still complete"
                                        aria-label="Stop MIDI generation (background request may still complete)"
                                    >
                                        Stop
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    className="w-full h-8 text-xs bg-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)] text-white"
                                    onClick={handleGenerate}
                                    disabled={!prompt.trim() && !midiGenre && !midiInstrument && !midiMood}
                                >
                                    <Sparkles className="size-3.5 mr-2" /> Generate MIDI
                                </Button>
                            )}
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
                            detail="The latest generated clips and renders."
                            bodyClassName="px-2 py-2"
                        >
                            <div className="space-y-1.5">
                                {state.tasks.map((task: GenerativeTaskResult) => (
                                    <AiTaskResultCard key={task.id} task={task} onRemove={removeTask} />
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
