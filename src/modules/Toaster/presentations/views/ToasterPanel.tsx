import { type ReactElement, useEffect, useState } from 'react';

import { Cpu, Play, Send, Square } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { getStraightGrooveTemplateId } from '#/modules/MIDI/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { type PadState, withActivePatternId } from '../../models/ToasterKit';
import {
    defaultToasterState,
    selectPad,
    setStepVelocity,
    toasterStore,
    toggleStep,
    updateKit,
} from '../../stores/toasterStore';
import { applyEuclideanToTrack } from '../../useCases/applyEuclidean';
import { assignToasterPatternGroove } from '../../useCases/assignToasterPatternGroove';
import { exportPatternToTimeline } from '../../useCases/exportPatternToTimeline';
import { getToasterPatternGrooveStatus } from '../../useCases/getToasterPatternGrooveStatus';
import { getToasterPresetKit } from '../../useCases/getToasterPresetKit';
import { getToasterPresetSummaries } from '../../useCases/getToasterPresetSummaries';
import { loadToasterKitPreset } from '../../useCases/loadToasterKit';
import { startSequencer } from '../../useCases/startSequencer';
import { stopSequencer } from '../../useCases/stopSequencer';
import { setToasterKitParam } from '../../useCases/toasterParamBridge/setToasterKitParam';
import { setToasterPadParam } from '../../useCases/toasterParamBridge/setToasterPadParam';
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

const TOASTER_PRESET_SUMMARIES = getToasterPresetSummaries();

type GrooveAmountPreview = {
    patternId: string;
    value: number;
};

type GrooveAssignmentFailure = {
    patternId: string;
    message: string;
};

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
    <Stack align="center" gap={1}>
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
            aria-label={label}
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-[9px] text-foreground/85">{readout}</div>
        </div>
    </Stack>
);

export const ToasterPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    // §209.1 — Typed defaults instead of non-null assertion on live values.
    const instances = useStore(toasterStore, {});
    const state = instances[deviceId] ?? defaultToasterState;
    const trackState = useStore(trackStore, defaultTrackState);
    const grooveState = useStore(grooveTemplateStore, defaultGrooveTemplateState);
    const selectedTrackId = trackState?.selectedTrackId ?? null;
    const [presetQuery, setPresetQuery] = useState('');
    const [eucHits, setEucHits] = useState(4);
    const [eucSteps, setEucSteps] = useState(16);
    const [grooveAmountPreview, setGrooveAmountPreview] = useState<GrooveAmountPreview | null>(null);
    const [grooveAssignmentFailure, setGrooveAssignmentFailure] = useState<GrooveAssignmentFailure | null>(null);

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
            selectPad(deviceId, padIndex);
        }
    }, [selectedTrackId, state, deviceId]);

    const liveState = state;
    if (!liveState) {
        return <div className="h-full" />;
    }

    const { kit, selectedPadIndex, activeVoices, isPlaying, currentStep } = liveState;

    // A corrupt persisted kit can deserialize with zero pads. `kit.pads[0]!`
    // would silence that real runtime case at the type level and then throw on
    // every field access below (AGENTS soundness, Finding #32). Handle it
    // explicitly with a fallback instead of asserting the array is non-empty.
    const selectedPad: PadState | undefined = kit.pads[selectedPadIndex] ?? kit.pads[0];
    if (!selectedPad) {
        return (
            <Row justify="center" className="toaster-faceplate h-full min-h-0 rounded-[26px] p-6 text-center">
                <Stack gap={2}>
                    <div className="text-[12px] font-semibold text-foreground">This kit has no pads</div>
                    <div className="text-[10px] text-muted-foreground">
                        Load a kit from the shelf to restore the pad bay.
                    </div>
                </Stack>
            </Row>
        );
    }

    const activePattern = kit.patterns.find((pattern) => pattern.id === kit.activePatternId);
    let grooveStatus: ReturnType<typeof getToasterPatternGrooveStatus> = { status: 'unassigned' };
    if (activePattern) {
        grooveStatus = getToasterPatternGrooveStatus({
            deviceId,
            patternId: activePattern.id,
            stepsPerBar: activePattern.stepsPerBar,
            grooveState,
        });
    }
    const isGrooveAvailable = grooveStatus.status === 'unassigned' || grooveStatus.status === 'ready';
    const canAssignGroove =
        activePattern !== undefined &&
        grooveStatus.status !== 'invalid-consumer' &&
        grooveStatus.status !== 'state-unavailable';
    let assignedGrooveTemplateId = getStraightGrooveTemplateId();
    let assignedGrooveAmount = 1;
    if (grooveStatus.status === 'ready' || grooveStatus.status === 'unsupported') {
        assignedGrooveTemplateId = grooveStatus.templateId;
        assignedGrooveAmount = grooveStatus.amount;
    }
    let grooveStatusMessage = 'Straight timing is active; no groove is assigned.';
    if (grooveStatus.status === 'ready') {
        grooveStatusMessage = 'The assigned groove is compatible with this pattern.';
    } else if (grooveStatus.status === 'unsupported') {
        grooveStatusMessage = `${grooveStatus.templateName} is not supported by this pattern grid.`;
    } else if (grooveStatus.status === 'missing-template') {
        grooveStatusMessage = `Assigned groove ${grooveStatus.templateId} is missing.`;
    } else if (grooveStatus.status === 'invalid-consumer') {
        grooveStatusMessage = 'This pattern has an invalid groove identity.';
    } else if (grooveStatus.status === 'state-unavailable') {
        grooveStatusMessage = 'Groove state is unavailable.';
    }
    if (grooveAssignmentFailure && grooveAssignmentFailure.patternId === activePattern?.id) {
        grooveStatusMessage = grooveAssignmentFailure.message;
    }
    let displayedGrooveAmount = assignedGrooveAmount;
    if (grooveAmountPreview && grooveAmountPreview.patternId === activePattern?.id) {
        displayedGrooveAmount = grooveAmountPreview.value;
    }
    const presetSearch = presetQuery.trim().toLowerCase();
    const visiblePresets = TOASTER_PRESET_SUMMARIES.filter((preset) => {
        if (presetSearch.length === 0) {
            return true;
        }

        return `${preset.name} ${preset.description} ${preset.tags.join(' ')}`.toLowerCase().includes(presetSearch);
    });

    function triggerPad(index: number): void {
        triggerToasterPad(deviceId, index, 100);
    }

    function handleSelectPattern(patternId: string): void {
        const next = withActivePatternId(kit, patternId);
        if (next !== kit) {
            updateKit(deviceId, { activePatternId: next.activePatternId });
        }
    }

    function handlePadParam(padIndex: number, key: string, value: number): void {
        // Every pad control routes the same way. Solo used to be diverted into a
        // store-only write here because `Pad::set_param` had no `soloed` arm to
        // send it to; it has one now, and `ToasterEngine::note_on` resolves solo
        // across the pad set, so solo reaches the engine exactly like mute,
        // volume and pan. `setToasterPadParam` still writes the store — via
        // `toPadStoreUpdate`, which is what turns the numeric wire value back
        // into the boolean the persisted kit chunk requires.
        setToasterPadParam(deviceId, padIndex, key as keyof PadState, value);
    }

    function handleLoadPreset(presetId: string): void {
        const presetKit = getToasterPresetKit(presetId);
        if (!presetKit) {
            return;
        }

        loadToasterKitPreset(deviceId, presetKit);
    }

    function handleAssignGroove(templateId: string, amount: number): void {
        if (!activePattern || !canAssignGroove) {
            return;
        }
        const patternId = activePattern.id;
        setGrooveAssignmentFailure(null);
        void assignToasterPatternGroove({ deviceId, patternId, templateId, amount }).catch(() => {
            setGrooveAssignmentFailure({
                patternId,
                message: 'Could not assign the groove. The previous assignment is still active.',
            });
        });
    }

    function previewGrooveAmount(value: number): void {
        if (!activePattern || !canAssignGroove) {
            return;
        }
        setGrooveAmountPreview({ patternId: activePattern.id, value });
    }

    function commitGrooveAmount(): void {
        if (!activePattern || grooveAmountPreview?.patternId !== activePattern.id) {
            return;
        }
        const amount = grooveAmountPreview.value;
        setGrooveAmountPreview(null);
        handleAssignGroove(assignedGrooveTemplateId, amount);
    }

    return (
        <div className="toaster-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <div className="grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)_17rem] gap-3">
                <Stack as="aside" gap={3} className="overflow-y-auto pr-1">
                    <SectionCard title="Kit shelf" detail="Grab a kit, then keep the active pad right below it.">
                        <Row as="label" gap={2} className="toaster-window px-3 py-2">
                            <input
                                value={presetQuery}
                                onChange={(event) => setPresetQuery(event.target.value)}
                                placeholder="Find a loaf"
                                className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/45"
                                aria-label="Search Toaster kits"
                            />
                        </Row>
                        <Stack grow gap={2} className="overflow-y-auto pr-1">
                            {visiblePresets.map((preset) => {
                                const active = preset.name === kit.name;
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        aria-pressed={active}
                                        aria-label={`Load kit ${preset.name}`}
                                        className={`toaster-window flex flex-col items-start gap-1 px-3 py-2 text-left transition-all ${
                                            active
                                                ? 'border-white/18 bg-white/[0.03]'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                        onClick={() => handleLoadPreset(preset.id)}
                                    >
                                        <Row justify="between" gap={2} className="w-full">
                                            <span className="text-[11px] font-medium text-foreground">
                                                {preset.name}
                                            </span>
                                            <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/45">
                                                {preset.tags[1] ?? 'kit'}
                                            </span>
                                        </Row>
                                        <span className="text-[9px] leading-4 text-muted-foreground">
                                            {preset.description}
                                        </span>
                                    </button>
                                );
                            })}
                        </Stack>
                    </SectionCard>

                    <SectionCard
                        title="Pad bay"
                        detail="Pads stay chunky, the active hit stays obvious, and the quick shaping lives right here."
                    >
                        <PadGrid
                            pads={kit.pads}
                            selectedIndex={selectedPadIndex}
                            onSelectPad={(index) => selectPad(deviceId, index)}
                            onTriggerPad={triggerPad}
                        />

                        <Row gap={3} className="toaster-window px-3 py-3">
                            <Row
                                justify="center"
                                shrink={false}
                                className="size-12 rounded-[16px] border"
                                style={{
                                    background: `linear-gradient(180deg, ${selectedPad.color}33, rgba(0,0,0,0.18))`,
                                    borderColor: `${selectedPad.color}66`,
                                    boxShadow: `0 0 18px ${selectedPad.color}22`,
                                }}
                            >
                                <span className="text-[11px] font-semibold text-white/82">{selectedPadIndex + 1}</span>
                            </Row>
                            <div className="min-w-0">
                                <div className="truncate text-[12px] font-semibold text-foreground">
                                    {selectedPad.name}
                                </div>
                                <div className="truncate text-[9px] uppercase tracking-[0.18em] text-muted-foreground/45">
                                    {selectedPad.engineType.replaceAll('-', ' ')}
                                </div>
                            </div>
                        </Row>

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
                                onChange={(value) =>
                                    setToasterPadParam(deviceId, selectedPadIndex, 'filterCutoff', value)
                                }
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
                </Stack>

                <Stack as="section" gap={3} className="min-w-0 overflow-y-auto pr-1">
                    <Row align="start" justify="between" gap={3}>
                        <Stack gap={2}>
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-peach)]/70">
                                Pattern story
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">{kit.name}</div>
                        </Stack>

                        <Row align="stretch" justify="end" wrap gap={2}>
                            {kit.patterns.length > 1 ? (
                                <Stack
                                    gap={1}
                                    className="toaster-window min-w-[94px] px-3 py-2"
                                    role="group"
                                    aria-label="Active pattern"
                                >
                                    <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">
                                        Pattern
                                    </div>
                                    <Row align="stretch" wrap gap={1}>
                                        {kit.patterns.map((pattern) => (
                                            <DawPluginChip
                                                key={pattern.id}
                                                active={pattern.id === kit.activePatternId}
                                                tone="peach"
                                                size="sm"
                                                aria-pressed={pattern.id === kit.activePatternId}
                                                onClick={() => handleSelectPattern(pattern.id)}
                                            >
                                                {pattern.name}
                                            </DawPluginChip>
                                        ))}
                                    </Row>
                                </Stack>
                            ) : (
                                <DawPluginMetricTile
                                    className="toaster-window min-w-[94px]"
                                    label="Pattern"
                                    value={activePattern?.name ?? 'A1'}
                                    detail="Current lane"
                                />
                            )}
                            <DawPluginMetricTile
                                className="toaster-window min-w-[94px]"
                                label="Step"
                                value={`${currentStep + 1}`}
                                detail="Playback cursor"
                            />
                            <DawPluginMetricTile
                                className="toaster-window min-w-[94px]"
                                label="Swing"
                                value={`${Math.round(kit.swing * 100)}%`}
                                detail="Groove push"
                            />
                            <DawPluginMetricTile
                                className="toaster-window min-w-[94px]"
                                label="Voices"
                                value={`${activeVoices}`}
                                detail="Live hits"
                            />
                        </Row>
                    </Row>

                    <div className="toaster-window min-h-0 shrink-0 overflow-auto p-3">
                        {activePattern ? (
                            <StepSequencer
                                pattern={activePattern}
                                pads={kit.pads}
                                currentStep={currentStep}
                                isPlaying={isPlaying}
                                onToggleStep={(trackId, stepIndex) => toggleStep(deviceId, trackId, stepIndex)}
                                onSetVelocity={(trackId, stepIndex, vel) =>
                                    setStepVelocity(deviceId, trackId, stepIndex, vel)
                                }
                            />
                        ) : null}
                    </div>
                </Stack>

                <Stack as="aside" gap={3} className="overflow-y-auto pr-1">
                    <SectionCard title="Transport" detail="Keep the rhythm tools tight and ready.">
                        <Row gap={2}>
                            <DawPluginChip
                                active={isPlaying}
                                disabled={!isGrooveAvailable}
                                tone="peach"
                                size="sm"
                                onClick={() => {
                                    if (isPlaying) {
                                        stopSequencer(deviceId);
                                        return;
                                    }

                                    startSequencer(deviceId, transportStore.value?.tempo ?? 120);
                                }}
                            >
                                {isPlaying ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                                {isPlaying ? 'Stop' : 'Play'}
                            </DawPluginChip>
                            <DawPluginChip
                                type="button"
                                disabled={!isGrooveAvailable}
                                tone="peach"
                                size="sm"
                                onClick={() => exportPatternToTimeline(deviceId)}
                            >
                                <Send className="size-3.5" />
                                To timeline
                            </DawPluginChip>
                        </Row>
                        <div role="status" className="text-[9px] leading-4 text-muted-foreground">
                            {grooveStatusMessage}
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
                        <Row gap={2}>
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
                                onClick={() => applyEuclideanToTrack(deviceId, selectedPadIndex, eucHits, eucSteps, 0)}
                            >
                                Toast
                            </DawPluginChip>
                        </Row>
                    </SectionCard>

                    <SectionCard title="Groove" detail="Master motion and room live together on the right rail.">
                        <Stack
                            as="label"
                            gap={1}
                            className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground"
                        >
                            Template
                            <select
                                aria-label="Pattern groove template"
                                value={assignedGrooveTemplateId}
                                disabled={!canAssignGroove}
                                onChange={(event) => {
                                    setGrooveAmountPreview(null);
                                    handleAssignGroove(event.target.value, assignedGrooveAmount);
                                }}
                                className="toaster-window h-8 px-2 text-[10px] normal-case tracking-normal text-foreground outline-none"
                            >
                                {grooveState.templates.map((template) => (
                                    <option key={template.id} value={template.id}>
                                        {template.name}
                                    </option>
                                ))}
                            </select>
                        </Stack>
                        <Stack
                            as="label"
                            gap={1}
                            className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground"
                        >
                            Amount {Math.round(displayedGrooveAmount * 100)}%
                            <input
                                aria-label="Pattern groove amount"
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={displayedGrooveAmount}
                                disabled={!canAssignGroove}
                                onChange={(event) => previewGrooveAmount(Number(event.target.value))}
                                onPointerUp={commitGrooveAmount}
                                onPointerCancel={() => setGrooveAmountPreview(null)}
                                onKeyUp={commitGrooveAmount}
                                onBlur={commitGrooveAmount}
                            />
                        </Stack>
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
                </Stack>
            </div>
        </div>
    );
};
