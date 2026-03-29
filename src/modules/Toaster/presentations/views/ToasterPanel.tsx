/**
 * Grinder — drum machine panel.
 *
 * Layout:
 *   Top bar: kit selector + transport
 *   Left column: pad grid (top) + knobs 3×3 (bottom) + engine selector
 *   Right: step sequencer (fills all remaining space)
 */
import { type ReactElement, useCallback, useEffect, useSyncExternalStore } from 'react';
import { useState } from 'react';
import { ChevronDown, Cpu, Play, Square, Send } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import {
    toasterStore, selectPad, toggleStep, setStepVelocity, type ToasterState,
} from '../../stores/toasterStore';
import { type PadState } from '../../models/ToasterKit';
import { setToasterPadParam } from '../../useCases/toasterParamBridge';
import { triggerToasterPad } from '../../useCases/triggerPad';
import { startSequencer, stopSequencer } from '../../useCases/sequencerPlayback';
import { TOASTER_PRESETS } from '../../useCases/toasterQueries';
import { loadToasterKitPreset } from '../../useCases/loadToasterKit';
import { PadGrid } from '../components/PadGrid';
import { StepSequencer } from '../components/StepSequencer';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { applyEuclideanToTrack } from '../../useCases/applyEuclidean';
import { exportPatternToTimeline } from '../../useCases/exportPatternToTimeline';
import { transportStore } from '#/modules/Transport/stores/transportStore';

// Engine assignment is handled by kit presets — no per-pad engine dropdown needed

export const ToasterPanel = (): ReactElement => {
    const state = useSyncExternalStore<ToasterState | null>(
        (cb) => toasterStore.subscribe(cb), () => toasterStore.value,
    );
    const selectedTrackId = useSyncExternalStore(
        (cb) => trackStore.subscribe(cb),
        () => trackStore.value?.selectedTrackId ?? null,
    );

    const [eucHits, setEucHits] = useState(4);
    const [eucSteps, setEucSteps] = useState(16);

    // Sync arrangement track selection → pad selection
    useEffect(() => {
        if (!selectedTrackId || !state) { return; }
        const tracks = getAllTracks();
        const selected = tracks.find((t) => t.id === selectedTrackId);
        if (!selected?.parentId) { return; }
        const parent = tracks.find((t) => t.id === selected.parentId);
        if (!parent?.devices.some((d) => d.type === 'grinder')) { return; }
        const children = tracks.filter((t) => t.parentId === parent.id);
        const padIndex = children.findIndex((t) => t.id === selectedTrackId);
        if (padIndex >= 0 && padIndex !== state.selectedPadIndex) {
            selectPad(padIndex);
        }
    }, [selectedTrackId, state?.selectedPadIndex]);

    const kit = state?.kit ?? toasterStore.value!.kit;
    const selectedPadIndex = state?.selectedPadIndex ?? 0;
    const activeVoices = state?.activeVoices ?? 0;
    const isPlaying = state?.isPlaying ?? false;
    const currentStep = state?.currentStep ?? 0;
    const pad: PadState = kit.pads[selectedPadIndex] ?? kit.pads[0]!;
    const activePattern = kit.patterns.find((p) => p.id === kit.activePatternId);

    const setP = useCallback((key: string, value: number) => {
        setToasterPadParam(selectedPadIndex, key as keyof PadState, value);
    }, [selectedPadIndex]);

    // Engine type changes are handled by kit presets, not individual pad UI

    const trigPad = useCallback((i: number) => triggerToasterPad(i, 100), []);

    // Small knob helper
    const K = useCallback(({ v, k, label, min, max, step, def }: { v: number; k: string; label: string; min: number; max: number; step: number; def: number }) => (
        <div className="flex flex-col items-center gap-0">
            <RotaryKnob value={v} onChange={(val) => setP(k, val)} min={min} max={max} step={step} defaultValue={def} size="sm" />
            <span className="text-[6px] text-muted-foreground leading-none">{label}</span>
        </div>
    ), [setP]);

    return (
        <div className="flex flex-col h-full">
            {/* ─── Top bar: kit selector, transport, Euclidean, export ─── */}
            <div className="flex items-center gap-3 px-1 py-1 shrink-0 border-b border-border/30 bg-surface-app/30">
                {/* Kit selector */}
                <div className="relative shrink-0">
                    <select
                        value={TOASTER_PRESETS.find((p) => p.name === kit.name)?.id ?? ''}
                        onChange={(e) => {
                            const preset = TOASTER_PRESETS.find((p) => p.id === e.target.value);
                            if (preset) { loadToasterKitPreset(preset.kit); }
                        }}
                        className="appearance-none bg-surface-inset border border-border/40 rounded pl-2 pr-5 py-0.5 text-[10px] text-foreground font-medium cursor-pointer w-[120px] truncate"
                    >
                        <option value="" disabled>{kit.name}</option>
                        {TOASTER_PRESETS.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
                </div>

                {/* Transport */}
                <Button variant={isPlaying ? 'secondary' : 'ghost'} size="icon-xs" className="h-5 w-5 shrink-0"
                    onClick={() => { if (isPlaying) { stopSequencer(); } else { startSequencer(transportStore.value?.tempo ?? 120); } }}>
                    {isPlaying ? <Square className="size-2.5" /> : <Play className="size-2.5" />}
                </Button>

                <div className="w-px h-4 bg-border/20 shrink-0" />

                {/* Euclidean generator */}
                <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[8px] text-muted-foreground font-medium">Euclid</span>
                    <input type="number" value={eucHits} onChange={(e) => setEucHits(Math.max(0, Math.min(32, Number(e.target.value))))}
                        className="w-7 h-5 rounded border border-border/40 bg-surface-inset px-1 text-[8px] text-center text-foreground outline-none" />
                    <span className="text-[8px] text-muted-foreground">/</span>
                    <input type="number" value={eucSteps} onChange={(e) => setEucSteps(Math.max(1, Math.min(64, Number(e.target.value))))}
                        className="w-7 h-5 rounded border border-border/40 bg-surface-inset px-1 text-[8px] text-center text-foreground outline-none" />
                    <button type="button"
                        className="px-1.5 py-0.5 rounded text-[7px] font-medium bg-[var(--color-accent-peach)]/70 text-white hover:bg-[var(--color-accent-peach)] transition-colors"
                        onClick={() => applyEuclideanToTrack(selectedPadIndex, eucHits, eucSteps, 0)}
                    >Apply</button>
                </div>

                <div className="w-px h-4 bg-border/20 shrink-0" />

                {/* Export to timeline */}
                <button type="button"
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors shrink-0"
                    onClick={() => exportPatternToTimeline()}
                    title="Export step pattern as MIDI clips to the timeline"
                >
                    <Send className="size-3" />
                    <span>To Timeline</span>
                </button>

                {/* Spacer + voice count */}
                <div className="flex-1" />
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground shrink-0">
                    <Cpu className="size-3" /><span>{activeVoices}v</span>
                </div>
            </div>

            {/* ─── Main: left column (pads + knobs) | right (step sequencer) ─── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* LEFT COLUMN: pad grid on top, then selected pad controls below */}
                <div className="w-[160px] shrink-0 border-r border-border/20 flex flex-col overflow-y-auto">
                    {/* Pad grid */}
                    <div className="p-1 shrink-0">
                        <PadGrid
                            pads={kit.pads}
                            selectedIndex={selectedPadIndex}
                            onSelectPad={selectPad}
                            onTriggerPad={trigPad}
                        />
                    </div>

                    {/* Selected pad controls — below the grid */}
                    <div className="px-1 py-1.5 border-t border-border/20 space-y-1.5">
                        {/* Pad name + engine type label */}
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pad.color }} />
                            <span className="text-[9px] font-bold text-foreground truncate">{pad.name}</span>
                            <span className="text-[7px] text-muted-foreground/50 ml-auto">{pad.engineType.replace(/^(kick|snare|hihat)-/, '').replace('-', ' ')}</span>
                        </div>

                        {/* Row 1: Decay, Tone, Drive */}
                        <div className="flex justify-between">
                            <K v={pad.decay} k="decay" label="Decay" min={0} max={1} step={0.01} def={0.5} />
                            <K v={pad.tone} k="tone" label="Tone" min={0} max={1} step={0.01} def={0.5} />
                            <K v={pad.drive} k="drive" label="Drive" min={0} max={10} step={0.1} def={0} />
                        </div>

                        {/* Row 2: Vol, Pan, Cut */}
                        <div className="flex justify-between">
                            <K v={pad.volume} k="volume" label="Vol" min={0} max={1} step={0.01} def={0.8} />
                            <K v={pad.pan} k="pan" label="Pan" min={-1} max={1} step={0.01} def={0} />
                            <K v={pad.filterCutoff} k="filterCutoff" label="Cut" min={20} max={20000} step={10} def={20000} />
                        </div>

                        {/* Row 3: Rev, Dly, (space) */}
                        <div className="flex justify-between">
                            <K v={pad.sendReverb} k="sendReverb" label="Rev" min={0} max={1} step={0.01} def={0.1} />
                            <K v={pad.sendDelay} k="sendDelay" label="Dly" min={0} max={1} step={0.01} def={0} />
                            <div className="w-8" /> {/* spacer for alignment */}
                        </div>
                    </div>
                </div>

                {/* RIGHT: Step sequencer — fills all remaining space */}
                <div className="flex-1 overflow-auto p-1">
                    {activePattern ? (
                        <StepSequencer
                            pattern={activePattern}
                            pads={kit.pads}
                            currentStep={currentStep}
                            isPlaying={isPlaying}
                            onToggleStep={toggleStep}
                            onSetVelocity={setStepVelocity}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
};
