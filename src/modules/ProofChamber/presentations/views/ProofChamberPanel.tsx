import { type ComponentProps, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

import { Waves } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginChoiceRow } from '#/components/daw/DawPluginChoiceRow';
import { DawPluginInsetCard } from '#/components/daw/DawPluginInsetCard';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricStrip } from '#/components/daw/DawPluginMetricStrip';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginRail } from '#/components/daw/DawPluginRail';
import { DawPluginReadoutList } from '#/components/daw/DawPluginReadoutList';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { executeAppAction, executeAppActionBatch, generateGroupId } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { decayToRt60Seconds } from '#/utils/reverbDecayLaw';

import {
    type ProofChamberAlgorithm,
    ALGORITHM_MAP,
    DEFAULT_PARAMS,
    PARAM_MAP,
    type ProofChamberEngineState,
    expandSpacePreset,
    type SpaceType,
    usesRt60DecayLaw,
} from '../../models/ProofChamberState';
import { chamberStore } from '../../stores/chamberStore';
import { decodeImpulseResponse } from '../../useCases/proofChamber/decodeImpulseResponse';
import { registerChamberInstance } from '../../useCases/proofChamber/registerChamberInstance';
import { updateChamberEngine } from '../../useCases/proofChamber/updateChamberEngine';
import { DecayEqOverlay } from '../components/DecayEqOverlay';
import { IrBrowser } from '../components/IrBrowser';
import { SignalFlowDiagram } from '../components/SignalFlowDiagram';

const SPACES: ReadonlyArray<{ id: SpaceType; label: string; mood: string }> = [
    { id: 'hall', label: 'Hall', mood: 'Wide bloom' },
    { id: 'room', label: 'Room', mood: 'Short body' },
    { id: 'plate', label: 'Plate', mood: 'Bright sheet' },
    { id: 'chamber', label: 'Chamber', mood: 'Wood and stone' },
    { id: 'cathedral', label: 'Cathedral', mood: 'Huge tail' },
    { id: 'shimmer', label: 'Shimmer', mood: 'Lifted top' },
    { id: 'infinite', label: 'Infinite', mood: 'Freeze loaf' },
    { id: 'spring', label: 'Spring', mood: 'Boing and drip' },
];

const VINTAGE_MODES = [
    { id: 0, label: 'Modern' },
    { id: 1, label: '80s' },
    { id: 2, label: '70s' },
] as const;

const ALGORITHMS: ReadonlyArray<{ id: ProofChamberAlgorithm; label: string }> = [
    { id: 'plate', label: 'Plate' },
    { id: 'fdn-8', label: 'FDN 8' },
    { id: 'fdn-16', label: 'FDN 16' },
    { id: 'spring', label: 'Spring' },
    { id: 'reverse', label: 'Reverse' },
];

/**
 * The badge on the Flavor card, numbered by position in the list the panel
 * offers rather than by the stored wire value.
 *
 * The wire values skip 4 and 5 — they belong to two engines that need an
 * impulse response nothing can supply — so numbering by the stored value would
 * label Reverse "A7" and advertise two algorithms no chip can reach.
 */
function algorithmBadge(algorithm: ProofChamberAlgorithm): string {
    const position = ALGORITHMS.findIndex((entry) => entry.id === algorithm);
    if (position < 0) {
        return 'A1';
    }
    return `A${position + 1}`;
}

function formatValue(value: number, unit: string): string {
    if (unit === '%') {
        return `${Math.round(value * 100)}%`;
    }
    if (unit === 'ms') {
        return `${Math.round(value)}ms`;
    }
    if (unit === 'Hz') {
        return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
    }
    if (unit === 'bipolar') {
        return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
    }
    return value.toFixed(2);
}

/**
 * The Decay readout. `decay` is stored as a normalised 0…0.999 coefficient, so
 * seconds are only shown for the algorithms whose engine actually converts it
 * into an RT60 — printing a tail length for the plate or the spring would
 * describe a number their DSP never produces.
 */
function formatDecayReadout(decay: number, algorithm: ProofChamberAlgorithm): string {
    if (usesRt60DecayLaw(algorithm)) {
        return `${decayToRt60Seconds(decay).toFixed(1)}s`;
    }
    return decay.toFixed(3);
}

function StatusTile({ label, value, accent }: { label: string; value: string; accent: string }): ReactElement {
    return (
        <DawPluginMetricTile
            className="proof-chamber-window min-w-[90px]"
            label={label}
            value={value}
            labelClassName="text-white/48"
            valueClassName="font-mono text-[13px]"
            style={{ color: accent }}
        />
    );
}

function SectionCard({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactNode;
}): ReactElement {
    return (
        <DawPluginSectionCard
            className="proof-chamber-window"
            title={title}
            detail={detail ? <ChamberLed>{detail}</ChamberLed> : undefined}
            detailMode="badge"
            titleClassName="text-[var(--color-accent-amber)]/72"
        >
            {children}
        </DawPluginSectionCard>
    );
}

const ChamberChip = ({
    tone = 'cyan',
    size = 'sm',
    shape = 'soft',
    caps = false,
    ...props
}: ComponentProps<typeof DawPluginChip>): ReactElement => (
    <DawPluginChip tone={tone} size={size} shape={shape} caps={caps} {...props} />
);

const ChamberLed = ({ tone = 'cyan', ...props }: ComponentProps<typeof DawPluginLed>): ReactElement => (
    <DawPluginLed tone={tone} {...props} />
);

function KnobCell({
    label,
    value,
    onChange,
    min,
    max,
    step,
    defaultValue,
    size,
    readout,
    bipolar,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    size: 'sm' | 'md' | 'lg' | 'xl';
    readout?: string;
    bipolar?: boolean;
}): ReactElement {
    return (
        <div className="flex min-w-[68px] flex-col items-center gap-1 rounded-[18px] border border-white/8 bg-[var(--color-bg-panelInset)] px-2 py-2 shadow-[var(--shadow-elevation-inset)]">
            <RotaryKnob
                value={value}
                onChange={onChange}
                min={min}
                max={max}
                step={step}
                defaultValue={defaultValue}
                size={size}
                bipolar={bipolar}
                tone="amber"
            />
            <div className="text-[8px] uppercase tracking-[0.2em] text-white/58">{label}</div>
            {readout ? <div className="font-mono text-[9px] text-white/42">{readout}</div> : null}
        </div>
    );
}

export const ProofChamberPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const storeState = useStore(chamberStore, { activeInstanceId: null, instances: {} });
    const params = storeState?.instances?.[deviceId]?.engineState ?? DEFAULT_PARAMS;

    useEffect(() => {
        registerChamberInstance(deviceId);
    }, [deviceId]);
    const [decayEqMults, setDecayEqMults] = useState([1.0, 1.0, 1.0, 1.0, 1.0, 1.0]);
    const [showDecayEq, setShowDecayEq] = useState(false);
    const [showFlow, setShowFlow] = useState(false);

    function setParam(key: keyof ProofChamberEngineState, value: number | boolean): void {
        updateChamberEngine(deviceId, (prev: ProofChamberEngineState) => ({ ...prev, [key]: value }));
        const rustKey = PARAM_MAP[key];
        if (!rustKey) {
            return;
        }
        let numericValue: number;
        if (typeof value === 'boolean') {
            numericValue = value ? 1 : 0;
        } else {
            numericValue = value;
        }
        void executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId, paramId: rustKey, value: numericValue },
        });
    }

    /**
     * Load a space preset as **one** history step.
     *
     * This used to fire one bare `executeAppAction` per expanded parameter —
     * upwards of twenty independent Automerge transactions and twenty undo
     * entries for a single click on a space tile, so undoing a preset meant
     * pressing undo twenty times and watching the reverb rebuild itself one
     * field at a time. `executeAppActionBatch` runs the whole expansion inside a
     * single transaction and tags every resulting entry with one `groupId`,
     * which `undo` pops as a unit.
     */
    function selectSpace(space: SpaceType): void {
        const nextParams = expandSpacePreset(space);

        updateChamberEngine(deviceId, () => nextParams);

        const actions: AppAction[] = [
            {
                type: 'setDeviceParameter',
                payload: { deviceId, paramId: 'algorithm', value: ALGORITHM_MAP[nextParams.algorithm] ?? 0 },
            },
        ];

        for (const [key, rawValue] of Object.entries(nextParams)) {
            if (key === 'algorithm' || key === 'space') {
                continue;
            }
            const rustKey = PARAM_MAP[key];
            if (!rustKey) {
                continue;
            }

            if (typeof rawValue === 'boolean') {
                actions.push({
                    type: 'setDeviceParameter',
                    payload: { deviceId, paramId: rustKey, value: rawValue ? 1 : 0 },
                });
            } else if (typeof rawValue === 'number') {
                actions.push({
                    type: 'setDeviceParameter',
                    payload: { deviceId, paramId: rustKey, value: rawValue },
                });
            }
        }

        const { groupId, groupLabel } = generateGroupId(`Load ${space} space`);
        void executeAppActionBatch(actions, { groupId, groupLabel });
    }

    let tailViewLed = 'Live tail';
    if (showDecayEq) {
        tailViewLed = 'EQ overlay';
    } else if (showFlow) {
        tailViewLed = 'Flow open';
    }

    return (
        <div className="proof-chamber-faceplate flex h-full min-h-0 gap-3 overflow-hidden p-3">
            <DawPluginRail className="h-full w-[248px] shrink-0">
                <SectionCard title="Space tray" detail={params.space}>
                    <div>
                        <div className="text-[18px] font-semibold text-white/92">Dutch Oven</div>
                        <div className="mt-1 text-[11px] text-white/44">
                            Reverb spaces, flavor switches, and the IR tray stay parked here.
                        </div>
                    </div>
                    <div className="grid gap-2">
                        {SPACES.map((space) => {
                            const active = params.space === space.id;
                            return (
                                <DawPluginChoiceRow
                                    key={space.id}
                                    className="proof-chamber-window"
                                    active={active}
                                    title={space.label}
                                    subtitle={space.mood}
                                    endSlot={active ? <ChamberLed>Live</ChamberLed> : null}
                                    onPress={() => selectSpace(space.id)}
                                />
                            );
                        })}
                    </div>
                </SectionCard>

                <SectionCard title="Flavor" detail={algorithmBadge(params.algorithm)}>
                    <div className="flex flex-wrap gap-1.5">
                        {VINTAGE_MODES.map((mode) => {
                            const active = params.vintage === mode.id;
                            return (
                                <ChamberChip key={mode.id} active={active} onClick={() => setParam('vintage', mode.id)}>
                                    {mode.label}
                                </ChamberChip>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {ALGORITHMS.map((algorithm) => {
                            const active = params.algorithm === algorithm.id;
                            return (
                                <ChamberChip
                                    key={algorithm.id}
                                    active={active}
                                    onClick={() => {
                                        updateChamberEngine(deviceId, (prev: ProofChamberEngineState) => ({
                                            ...prev,
                                            algorithm: algorithm.id,
                                        }));
                                        void executeAppAction({
                                            type: 'setDeviceParameter',
                                            payload: {
                                                deviceId,
                                                paramId: 'algorithm',
                                                value: ALGORITHM_MAP[algorithm.id] ?? 0,
                                            },
                                        });
                                    }}
                                >
                                    {algorithm.label}
                                </ChamberChip>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        <ChamberChip active={showDecayEq} onClick={() => setShowDecayEq((value) => !value)}>
                            Decay EQ
                        </ChamberChip>
                        <ChamberChip active={showFlow} onClick={() => setShowFlow((value) => !value)}>
                            Flow
                        </ChamberChip>
                        <ChamberChip active={params.freeze} onClick={() => setParam('freeze', !params.freeze)}>
                            Freeze
                        </ChamberChip>
                        <ChamberChip active={params.shimmer} onClick={() => setParam('shimmer', !params.shimmer)}>
                            Shimmer
                        </ChamberChip>
                        <ChamberChip
                            active={params.saturation}
                            onClick={() => setParam('saturation', !params.saturation)}
                        >
                            Saturation
                        </ChamberChip>
                    </div>
                </SectionCard>

                <SectionCard title="IR tray" detail="Cabinet-free">
                    <IrBrowser
                        onFileDrop={decodeImpulseResponse}
                        onIrLoaded={(data, channels) => {
                            logger.info(`[ProofChamber] IR loaded: ${data.length} samples, ${channels}ch`);
                        }}
                    />
                </SectionCard>
            </DawPluginRail>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                <header className="proof-chamber-window flex shrink-0 flex-wrap items-center gap-2.5 px-3 py-2">
                    <div className="space-y-1">
                        <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-amber)]/72">
                            Reverb stage
                        </div>
                        <div className="text-[14px] font-semibold text-white/92">
                            {SPACES.find((space) => space.id === params.space)?.label ?? 'Hall'}
                        </div>
                    </div>
                    <DawPluginMetricStrip className="ml-auto">
                        <StatusTile
                            label="Decay"
                            value={formatDecayReadout(params.decay, params.algorithm)}
                            accent="var(--color-accent-cyan)"
                        />
                        <StatusTile
                            label="Mix"
                            value={formatValue(params.mix, '%')}
                            accent="var(--color-accent-amber)"
                        />
                        <StatusTile
                            label="Pre"
                            value={formatValue(params.predelay, 'ms')}
                            accent="var(--color-accent-peach)"
                        />
                        <StatusTile
                            label="Width"
                            value={formatValue(params.width / 2, '%')}
                            accent="var(--color-accent-lavender)"
                        />
                    </DawPluginMetricStrip>
                </header>

                <div className="grid min-h-0 shrink-0 grid-cols-[minmax(0,1.1fr)_280px] gap-3">
                    <div className="proof-chamber-window min-h-[280px] overflow-hidden">
                        <div className="flex h-full min-h-0 flex-col">
                            <div className="flex items-center justify-between px-3 py-2">
                                <div className="text-[9px] uppercase tracking-[0.24em] text-white/44">Tail view</div>
                                <ChamberLed>{tailViewLed}</ChamberLed>
                            </div>
                            <div className="relative min-h-0 flex-1 border-t border-white/6">
                                <ReverbSpectrogram decay={params.decay} damping={params.damping} />
                                {showDecayEq ? (
                                    <DecayEqOverlay
                                        multipliers={decayEqMults}
                                        onChange={(band, mult) => {
                                            const next = [...decayEqMults];
                                            next[band] = mult;
                                            setDecayEqMults(next);
                                            void executeAppAction({
                                                type: 'setDeviceParameter',
                                                payload: { deviceId, paramId: `decay_eq_${band}`, value: mult },
                                            });
                                        }}
                                        width={600}
                                        height={120}
                                    />
                                ) : null}
                            </div>
                            {showFlow ? (
                                <div className="shrink-0 border-t border-white/6 px-3 py-2">
                                    <SignalFlowDiagram
                                        algorithm={params.algorithm}
                                        shimmerEnabled={params.shimmer}
                                        freezeEnabled={params.freeze}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <DawPluginRail as="div">
                        <SectionCard title="Quick read" detail={params.algorithm}>
                            <DawPluginReadoutList>
                                <DawReadoutRow
                                    label="High cut"
                                    value={formatValue(params.highCut, 'Hz')}
                                    labelClassName="text-white/56"
                                    valueClassName="text-white/82"
                                />
                                <DawReadoutRow
                                    label="Low cut"
                                    value={formatValue(params.lowCut, 'Hz')}
                                    labelClassName="text-white/56"
                                    valueClassName="text-white/82"
                                />
                                <DawReadoutRow
                                    label="Damping"
                                    value={formatValue(params.damping, '%')}
                                    labelClassName="text-white/56"
                                    valueClassName="text-white/82"
                                />
                                <DawReadoutRow
                                    label="Gravity"
                                    value={formatValue(params.gravity, 'bipolar')}
                                    labelClassName="text-white/56"
                                    valueClassName="text-white/82"
                                />
                            </DawPluginReadoutList>
                        </SectionCard>
                        <SectionCard title="Switches" detail={params.freeze ? 'Frozen' : 'Moving'}>
                            <div className="flex flex-wrap gap-1.5">
                                <ChamberChip
                                    active={params.shimmer}
                                    onClick={() => setParam('shimmer', !params.shimmer)}
                                >
                                    Shimmer
                                </ChamberChip>
                                <ChamberChip active={params.freeze} onClick={() => setParam('freeze', !params.freeze)}>
                                    Freeze
                                </ChamberChip>
                                <ChamberChip
                                    active={params.saturation}
                                    onClick={() => setParam('saturation', !params.saturation)}
                                >
                                    Saturation
                                </ChamberChip>
                            </div>
                            {params.shimmer ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <KnobCell
                                        label="Amount"
                                        value={params.shimmerAmount}
                                        onChange={(value) => setParam('shimmerAmount', value)}
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        defaultValue={0.2}
                                        size="sm"
                                        readout={formatValue(params.shimmerAmount, '%')}
                                    />
                                    <KnobCell
                                        label="Pitch"
                                        value={params.shimmerPitch}
                                        onChange={(value) => setParam('shimmerPitch', Math.round(value))}
                                        min={0}
                                        max={1}
                                        step={1}
                                        defaultValue={1}
                                        size="sm"
                                        readout={params.shimmerPitch < 0.5 ? 'Fifth' : 'Octave'}
                                    />
                                </div>
                            ) : null}
                        </SectionCard>
                    </DawPluginRail>
                </div>

                <section className="proof-chamber-window shrink-0 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <div className="text-[9px] uppercase tracking-[0.24em] text-white/44">Control deck</div>
                            <div className="mt-1 text-[13px] font-semibold text-white/88">Space, tone, motion</div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-white/48">
                            <Waves className="size-3.5" />
                            <span>Keep the tail centered, tweak the edges on the right.</span>
                        </div>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-5 md:grid-cols-3">
                        <SectionCard title="Core" detail="Size">
                            <div className="grid grid-cols-2 gap-2">
                                <KnobCell
                                    label="Size"
                                    value={params.size}
                                    onChange={(value) => setParam('size', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.75}
                                    size="md"
                                    readout={formatValue(params.size, '%')}
                                />
                                <KnobCell
                                    label="Decay"
                                    value={params.decay}
                                    onChange={(value) => setParam('decay', value)}
                                    min={0}
                                    max={0.999}
                                    step={0.001}
                                    defaultValue={0.5}
                                    size="md"
                                    readout={formatDecayReadout(params.decay, params.algorithm)}
                                />
                                <KnobCell
                                    label="Mix"
                                    value={params.mix}
                                    onChange={(value) => setParam('mix', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.3}
                                    size="md"
                                    readout={formatValue(params.mix, '%')}
                                />
                                <KnobCell
                                    label="Pre"
                                    value={params.predelay}
                                    onChange={(value) => setParam('predelay', value)}
                                    min={0}
                                    max={500}
                                    step={1}
                                    defaultValue={15}
                                    size="md"
                                    readout={formatValue(params.predelay, 'ms')}
                                />
                            </div>
                        </SectionCard>

                        <SectionCard title="Tone" detail="Cuts">
                            <div className="grid grid-cols-2 gap-2">
                                <KnobCell
                                    label="Hi Cut"
                                    value={params.highCut}
                                    onChange={(value) => setParam('highCut', value)}
                                    min={1000}
                                    max={20000}
                                    step={100}
                                    defaultValue={12000}
                                    size="md"
                                    readout={formatValue(params.highCut, 'Hz')}
                                />
                                <KnobCell
                                    label="Lo Cut"
                                    value={params.lowCut}
                                    onChange={(value) => setParam('lowCut', value)}
                                    min={20}
                                    max={1000}
                                    step={5}
                                    defaultValue={80}
                                    size="md"
                                    readout={`${Math.round(params.lowCut)}Hz`}
                                />
                                <KnobCell
                                    label="Damp"
                                    value={params.damping}
                                    onChange={(value) => setParam('damping', value)}
                                    min={0}
                                    max={0.999}
                                    step={0.001}
                                    defaultValue={0.3}
                                    size="md"
                                    readout={formatValue(params.damping, '%')}
                                />
                                <KnobCell
                                    label="Diffuse"
                                    value={params.diffusion}
                                    onChange={(value) => setParam('diffusion', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.75}
                                    size="md"
                                    readout={formatValue(params.diffusion, '%')}
                                />
                            </div>
                        </SectionCard>

                        <SectionCard title="Motion" detail="Swirl">
                            <div className="grid grid-cols-2 gap-2">
                                <KnobCell
                                    label="Rate"
                                    value={params.modRate}
                                    onChange={(value) => setParam('modRate', value)}
                                    min={0.1}
                                    max={5}
                                    step={0.1}
                                    defaultValue={1}
                                    size="md"
                                    readout={`${params.modRate.toFixed(1)}Hz`}
                                />
                                <KnobCell
                                    label="Depth"
                                    value={params.modDepth}
                                    onChange={(value) => setParam('modDepth', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.3}
                                    size="md"
                                    readout={formatValue(params.modDepth, '%')}
                                />
                                <KnobCell
                                    label="Width"
                                    value={params.width}
                                    onChange={(value) => setParam('width', value)}
                                    min={0}
                                    max={2}
                                    step={0.01}
                                    defaultValue={1}
                                    size="md"
                                    readout={formatValue(params.width / 2, '%')}
                                />
                                <KnobCell
                                    label="E/L"
                                    value={params.earlyLateBalance}
                                    onChange={(value) => setParam('earlyLateBalance', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.4}
                                    size="md"
                                    readout={formatValue(params.earlyLateBalance, '%')}
                                />
                            </div>
                        </SectionCard>

                        <SectionCard title="Character" detail="Push">
                            <div className="grid grid-cols-2 gap-2">
                                <KnobCell
                                    label="Gravity"
                                    value={params.gravity}
                                    onChange={(value) => setParam('gravity', value)}
                                    min={-1}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.5}
                                    size="md"
                                    bipolar
                                    readout={formatValue(params.gravity, 'bipolar')}
                                />
                                <KnobCell
                                    label="Vintage"
                                    value={params.vintage}
                                    onChange={(value) => setParam('vintage', Math.round(value))}
                                    min={0}
                                    max={2}
                                    step={1}
                                    defaultValue={0}
                                    size="md"
                                    readout={VINTAGE_MODES[Math.round(params.vintage)]?.label ?? 'Modern'}
                                />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {VINTAGE_MODES.map((mode) => (
                                    <ChamberChip
                                        key={mode.id}
                                        active={params.vintage === mode.id}
                                        onClick={() => setParam('vintage', mode.id)}
                                    >
                                        {mode.label}
                                    </ChamberChip>
                                ))}
                            </div>
                        </SectionCard>

                        <SectionCard title="Engine" detail="Algo">
                            <div className="grid grid-cols-2 gap-2">
                                <DawPluginInsetCard
                                    className="proof-chamber-window"
                                    title="Algorithm"
                                    headerSize="xs"
                                    titleClassName="text-white/46"
                                >
                                    <div className="flex flex-wrap gap-1.5">
                                        {ALGORITHMS.map((algorithm) => (
                                            <ChamberChip
                                                key={algorithm.id}
                                                active={params.algorithm === algorithm.id}
                                                onClick={() => {
                                                    updateChamberEngine(deviceId, (prev: ProofChamberEngineState) => ({
                                                        ...prev,
                                                        algorithm: algorithm.id,
                                                    }));
                                                    void executeAppAction({
                                                        type: 'setDeviceParameter',
                                                        payload: {
                                                            deviceId,
                                                            paramId: 'algorithm',
                                                            value: ALGORITHM_MAP[algorithm.id] ?? 0,
                                                        },
                                                    });
                                                }}
                                            >
                                                {algorithm.label}
                                            </ChamberChip>
                                        ))}
                                    </div>
                                </DawPluginInsetCard>
                                <DawPluginInsetCard
                                    className="proof-chamber-window"
                                    title="State"
                                    headerSize="xs"
                                    titleClassName="text-white/46"
                                >
                                    <div className="flex flex-wrap gap-1.5">
                                        <ChamberLed>{params.freeze ? 'Freeze on' : 'Freeze off'}</ChamberLed>
                                        <ChamberLed>{params.shimmer ? 'Shimmer on' : 'Shimmer off'}</ChamberLed>
                                    </div>
                                </DawPluginInsetCard>
                            </div>
                        </SectionCard>
                    </div>
                </section>
            </section>
        </div>
    );
};

const ReverbSpectrogram = ({ decay, damping }: { decay: number; damping: number }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef({
        raf: 0,
        transients: [] as { age: number; energy: number }[],
        ticksSinceLast: 0,
    });
    const decayRef = useRef(decay);
    const dampingRef = useRef(damping);
    decayRef.current = decay;
    dampingRef.current = damping;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        const width = canvas.width;
        const height = canvas.height;
        const state = stateRef.current;

        ctx.fillStyle = 'rgb(3,3,5)';
        ctx.fillRect(0, 0, width, height);

        const draw = (): void => {
            const currentDecay = decayRef.current;
            const currentDamping = dampingRef.current;

            const imageData = ctx.getImageData(1, 0, width - 1, height);
            ctx.putImageData(imageData, 0, 0);

            for (let index = state.transients.length - 1; index >= 0; index -= 1) {
                const transient = state.transients[index];
                if (!transient) {
                    continue;
                }
                transient.age += 1;
                if (transient.age > 200 + currentDecay * 400) {
                    state.transients.splice(index, 1);
                }
            }

            state.ticksSinceLast += 1;
            if (state.ticksSinceLast > 70 + Math.random() * 80) {
                state.ticksSinceLast = 0;
                state.transients.push({ age: 0, energy: 0.6 + Math.random() * 0.4 });
            }

            for (let y = 0; y < height; y += 1) {
                const frequencyNorm = 1 - y / height;
                let total = 0;

                for (const transient of state.transients) {
                    const frequencyDecay = 1 + currentDamping * frequencyNorm * 4;
                    const decayRate = 0.006 * (1 - currentDecay * 0.94) * frequencyDecay;
                    total += transient.energy * Math.exp(-transient.age * decayRate);
                }

                total += Math.random() * 0.02;
                total = Math.min(1, total);

                const red = Math.floor(total * 40 + total * total * 80);
                const green = Math.floor(total * 100 + total * total * 100);
                const blue = Math.floor(total * 140 + total * total * 80);
                ctx.fillStyle = `rgb(${red},${green},${blue})`;
                ctx.fillRect(width - 1, y, 1, 1);
            }

            state.raf = requestAnimationFrame(draw);
        };

        state.raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(state.raf);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            width={720}
            height={260}
            className="h-full w-full"
            style={{ imageRendering: 'pixelated' }}
        />
    );
};
