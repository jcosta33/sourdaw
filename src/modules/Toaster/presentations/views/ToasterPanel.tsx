import { type ReactElement, useEffect, useState, useSyncExternalStore } from 'react';
import { Cpu, Play, Send, Square } from 'lucide-react';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { type PadState } from '../../models/ToasterKit';
import { selectPad, setStepVelocity, toasterStore, toggleStep, updatePad, type ToasterState } from '../../stores/toasterStore';
import { applyEuclideanToTrack } from '../../useCases/applyEuclidean';
import { exportPatternToTimeline } from '../../useCases/exportPatternToTimeline';
import { loadToasterKitPreset } from '../../useCases/loadToasterKit';
import { startSequencer, stopSequencer } from '../../useCases/sequencerPlayback';
import { setToasterKitParam, setToasterPadParam } from '../../useCases/toasterParamBridge';
import { TOASTER_PRESETS } from '../../useCases/toasterQueries';
import { triggerToasterPad } from '../../useCases/triggerPad';
import { PadGrid } from '../components/PadGrid';
import { PadMixer } from '../components/PadMixer';
import { StepSequencer } from '../components/StepSequencer';

const SectionCard = ({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactElement | ReactElement[];
}): ReactElement => (
    <DawPluginSectionCard
        className="toaster-window"
        title={title}
        detail={detail}
        titleClassName="text-[var(--color-accent-peach)]/70"
    >
        {children}
    </DawPluginSectionCard>
);

const Knob = ({
    value,
    label,
    min,
    max,
    step,
    defaultValue,
    onChange,
    readout,
}: {
    value: number;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    onChange: (value: number) => void;
    readout: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-1">
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-[9px] text-foreground/85">{readout}</div>
        </div>
    </div>
);

export const ToasterPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const state = useSyncExternalStore<ToasterState | null>(
        (callback) => toasterStore.subscribe(callback),
        () => toasterStore.value
    );
    const selectedTrackId = useSyncExternalStore(
        (callback) => trackStore.subscribe(callback),
        () => trackStore.value?.selectedTrackId ?? null
    );
    const [presetQuery, setPresetQuery] = useState('');
    const [eucHits, setEucHits] = useState(4);
    const [eucSteps, setEucSteps] = useState(16);

    useEffect(() => {
        if (!selectedTrackId || !state) {
            return;
        }

        const tracks = getAllTracks();
        const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
        if (!selectedTrack?.parentId) {
            return;
        }

        const parentTrack = tracks.find((track) => track.id === selectedTrack.parentId);
        if (!parentTrack?.devices.some((device) => device.type === 'toaster')) {
            return;
        }

        const childTracks = tracks.filter((track) => track.parentId === parentTrack.id);
        const padIndex = childTracks.findIndex((track) => track.id === selectedTrackId);
        if (padIndex >= 0 && padIndex !== state.selectedPadIndex) {
            selectPad(padIndex);
        }
    }, [selectedTrackId, state]);

    const liveState = state ?? toasterStore.value;
    if (!liveState) {
        return <div className="h-full" />;
    }

    const { kit, selectedPadIndex, activeVoices, isPlaying, currentStep } = liveState;
    const selectedPad: PadState = kit.pads[selectedPadIndex] ?? kit.pads[0]!;
    const activePattern = kit.patterns.find((pattern) => pattern.id === kit.activePatternId);
    const presetSearch = presetQuery.trim().toLowerCase();
    const visiblePresets = TOASTER_PRESETS.filter((preset) => {
        if (presetSearch.length === 0) {
            return true;
        }

        return `${preset.name} ${preset.description} ${preset.tags.join(' ')}`.toLowerCase().includes(presetSearch);
    });

    function triggerPad(index: number): void {
        triggerToasterPad(index, 100);
    }

    function handlePadParam(padIndex: number, key: string, value: number): void {
        if (key === 'muted') {
            updatePad(padIndex, { muted: value > 0 });
            return;
        }
        if (key === 'soloed') {
            updatePad(padIndex, { soloed: value > 0 });
            return;
        }
        setToasterPadParam(deviceId, padIndex, key as keyof PadState, value);
    }

    return (
        <div className="toaster-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <div className="grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)_17rem] gap-3">
                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Kit shelf" detail="Grab a kit, then keep the active pad right below it.">
                        <label className="toaster-window flex items-center gap-2 px-3 py-2">
                            <input
                                value={presetQuery}
                                onChange={(event) => setPresetQuery(event.target.value)}
                                placeholder="Find a loaf"
                                className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/45"
                                aria-label="Search Toaster kits"
                            />
                        </label>
                        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                            {visiblePresets.map((preset) => {
                                const active = preset.kit.name === kit.name;
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        className={`toaster-window flex flex-col items-start gap-1 px-3 py-2 text-left transition-all ${
                                            active
                                                ? 'border-white/18 bg-white/[0.03]'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                        onClick={() => loadToasterKitPreset(preset.kit)}
                                    >
                                        <div className="flex w-full items-center justify-between gap-2">
                                            <span className="text-[11px] font-medium text-foreground">
                                                {preset.name}
                                            </span>
                                            <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/45">
                                                {preset.tags[1] ?? 'kit'}
                                            </span>
                                        </div>
                                        <span className="text-[9px] leading-4 text-muted-foreground">
                                            {preset.description}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </SectionCard>

                    <SectionCard
                        title="Pad bay"
                        detail="Pads stay chunky, the active hit stays obvious, and the quick shaping lives right here."
                    >
                        <PadGrid
                            pads={kit.pads}
                            selectedIndex={selectedPadIndex}
                            onSelectPad={selectPad}
                            onTriggerPad={triggerPad}
                        />

                        <div className="toaster-window flex items-center gap-3 px-3 py-3">
                            <div
                                className="flex size-12 shrink-0 items-center justify-center rounded-[16px] border"
                                style={{
                                    background: `linear-gradient(180deg, ${selectedPad.color}33, rgba(0,0,0,0.18))`,
                                    borderColor: `${selectedPad.color}66`,
                                    boxShadow: `0 0 18px ${selectedPad.color}22`,
                                }}
                            >
                                <span className="text-[11px] font-semibold text-white/82">{selectedPadIndex + 1}</span>
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-[12px] font-semibold text-foreground">
                                    {selectedPad.name}
                                </div>
                                <div className="truncate text-[9px] uppercase tracking-[0.18em] text-muted-foreground/45">
                                    {selectedPad.engineType.replace(/-/g, ' ')}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                            <Knob
                                value={selectedPad.decay}
                                onChange={(value) => setToasterPadParam(deviceId, selectedPadIndex, 'decay', value)}
                                label="Hit"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.5}
                                readout={`${Math.round(selectedPad.decay * 100)}%`}
                            />
                            <Knob
                                value={selectedPad.tone}
                                onChange={(value) => setToasterPadParam(deviceId, selectedPadIndex, 'tone', value)}
                                label="Tone"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.5}
                                readout={`${Math.round(selectedPad.tone * 100)}%`}
                            />
                            <Knob
                                value={selectedPad.drive}
                                onChange={(value) => setToasterPadParam(deviceId, selectedPadIndex, 'drive', value)}
                                label="Crunch"
                                min={0}
                                max={10}
                                step={0.1}
                                defaultValue={0}
                                readout={selectedPad.drive.toFixed(1)}
                            />
                            <Knob
                                value={selectedPad.volume}
                                onChange={(value) => setToasterPadParam(deviceId, selectedPadIndex, 'volume', value)}
                                label="Level"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.8}
                                readout={`${Math.round(selectedPad.volume * 100)}%`}
                            />
                            <Knob
                                value={selectedPad.pan}
                                onChange={(value) => setToasterPadParam(deviceId, selectedPadIndex, 'pan', value)}
                                label="Pan"
                                min={-1}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                readout={selectedPad.pan.toFixed(2)}
                            />
                            <Knob
                                value={selectedPad.filterCutoff}
                                onChange={(value) => setToasterPadParam(deviceId, selectedPadIndex, 'filterCutoff', value)}
                                label="Bright"
                                min={20}
                                max={20000}
                                step={10}
                                defaultValue={20000}
                                readout={
                                    selectedPad.filterCutoff >= 1000
                                        ? `${(selectedPad.filterCutoff / 1000).toFixed(1)}k`
                                        : `${selectedPad.filterCutoff.toFixed(0)}`
                                }
                            />
                        </div>
                    </SectionCard>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-peach)]/70">
                                Pattern story
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">{kit.name}</div>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                            <DawPluginMetricTile className="toaster-window min-w-[94px]" label="Pattern" value={activePattern?.name ?? 'A1'} detail="Current lane" />
                            <DawPluginMetricTile className="toaster-window min-w-[94px]" label="Step" value={`${currentStep + 1}`} detail="Playback cursor" />
                            <DawPluginMetricTile className="toaster-window min-w-[94px]" label="Swing" value={`${Math.round(kit.swing * 100)}%`} detail="Groove push" />
                            <DawPluginMetricTile className="toaster-window min-w-[94px]" label="Voices" value={`${activeVoices}`} detail="Live hits" />
                        </div>
                    </div>

                    <div className="toaster-window min-h-0 shrink-0 overflow-auto p-3">
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
                </section>

                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Transport" detail="Keep the rhythm tools tight and ready.">
                        <div className="flex items-center gap-2">
                            <DawPluginChip
                                active={isPlaying}
                                tone="peach"
                                size="sm"
                                onClick={() => {
                                    if (isPlaying) {
                                        stopSequencer();
                                        return;
                                    }

                                    startSequencer(transportStore.value?.tempo ?? 120);
                                }}
                            >
                                {isPlaying ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                                {isPlaying ? 'Stop' : 'Play'}
                            </DawPluginChip>
                            <DawPluginChip type="button" tone="peach" size="sm" onClick={() => exportPatternToTimeline()}>
                                <Send className="size-3.5" />
                                To timeline
                            </DawPluginChip>
                        </div>
                        <DawPluginLed tone="peach" className="flex items-center gap-1">
                            <Cpu className="size-3" />
                            {activeVoices} voices
                        </DawPluginLed>
                    </SectionCard>

                    <SectionCard title="Pad mixer" detail="Per-pad level, pan, mute, and solo.">
                        <PadMixer pads={kit.pads} onPadParam={handlePadParam} />
                    </SectionCard>

                    <SectionCard
                        title="Fill tools"
                        detail="Euclid stays playful instead of turning into a spreadsheet."
                    >
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={eucHits}
                                onChange={(event) => setEucHits(Math.max(0, Math.min(32, Number(event.target.value))))}
                                className="toaster-window h-9 w-14 px-2 text-center text-[11px] text-foreground outline-none"
                            />
                            <span className="text-[10px] text-muted-foreground">of</span>
                            <input
                                type="number"
                                value={eucSteps}
                                onChange={(event) => setEucSteps(Math.max(1, Math.min(64, Number(event.target.value))))}
                                className="toaster-window h-9 w-14 px-2 text-center text-[11px] text-foreground outline-none"
                            />
                            <DawPluginChip
                                active
                                tone="peach"
                                size="sm"
                                onClick={() => applyEuclideanToTrack(selectedPadIndex, eucHits, eucSteps, 0)}
                            >
                                Toast
                            </DawPluginChip>
                        </div>
                    </SectionCard>

                    <SectionCard title="Groove" detail="Master motion and room live together on the right rail.">
                        <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                            <Knob
                                value={kit.swing}
                                onChange={(value) => setToasterKitParam(deviceId, 'swing', value)}
                                label="Swing"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                readout={`${Math.round(kit.swing * 100)}%`}
                            />
                            <Knob
                                value={kit.masterGain}
                                onChange={(value) => setToasterKitParam(deviceId, 'masterGain', value)}
                                label="Master"
                                min={0}
                                max={2}
                                step={0.01}
                                defaultValue={1}
                                readout={`${Math.round(kit.masterGain * 100)}%`}
                            />
                            <Knob
                                value={kit.reverbMix}
                                onChange={(value) => setToasterKitParam(deviceId, 'reverbMix', value)}
                                label="Space"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.15}
                                readout={`${Math.round(kit.reverbMix * 100)}%`}
                            />
                            <Knob
                                value={kit.delayMix}
                                onChange={(value) => setToasterKitParam(deviceId, 'delayMix', value)}
                                label="Spray"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                readout={`${Math.round(kit.delayMix * 100)}%`}
                            />
                            <Knob
                                value={kit.lofiBits}
                                onChange={(value) => setToasterKitParam(deviceId, 'lofiBits', value)}
                                label="Bits"
                                min={4}
                                max={16}
                                step={1}
                                defaultValue={16}
                                readout={`${kit.lofiBits.toFixed(0)} bit`}
                            />
                            <Knob
                                value={kit.lofiMix}
                                onChange={(value) => setToasterKitParam(deviceId, 'lofiMix', value)}
                                label="Dust"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                readout={`${Math.round(kit.lofiMix * 100)}%`}
                            />
                        </div>
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
};
