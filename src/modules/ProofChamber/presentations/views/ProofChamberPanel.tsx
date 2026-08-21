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
import { Grid, Row, Stack } from '#/components/layout';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction, executeAppActionBatch, generateGroupId } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { decayToRt60Seconds } from '#/utils/reverbDecayLaw';

import {
    ALGORITHM_LABELS,
    chamberControlGate,
    chamberDecayEqGate,
    type ChamberControlGate,
} from '../../models/ProofChamberAlgorithmGating';
import {
    type ProofChamberAlgorithm,
    ALGORITHM_MAP,
    DEFAULT_PARAMS,
    PARAM_MAP,
    type ProofChamberEngineState,
    PROOF_CHAMBER_ALGORITHMS,
    PROOF_CHAMBER_DECAY_EQ_BANDS,
    expandSpacePreset,
    type SpaceType,
    usesRt60DecayLaw,
} from '../../models/ProofChamberState';
import { chamberStore } from '../../stores/chamberStore';
import { decodeImpulseResponse } from '../../useCases/proofChamber/decodeImpulseResponse';
import { hydrateChamberStateFromProject } from '../../useCases/proofChamber/hydrateChamberStateFromProject';
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

const defaultTrackState = { tracks: [], selectedTrackId: null, ghostClips: [] };

const VINTAGE_MODES = [
    { id: 0, label: 'Modern' },
    { id: 1, label: '80s' },
    { id: 2, label: '70s' },
] as const;

/**
 * The three saturation curves the plate implements, in the engine's own order.
 *
 * The ids are the wire values `ProofChamber::set_param` reads through
 * `(value as u8).min(2)`, so the labels and the curves cannot drift apart
 * without someone renumbering this list.
 */
const SATURATION_CURVES = [
    { id: 0, label: 'Tanh' },
    { id: 1, label: 'Cheby' },
    { id: 2, label: 'Clip' },
] as const;

/**
 * The selector's order, which is also what `algorithmBadge` numbers by. Labels
 * come from the gating model, because the disabled-control explanations name
 * the algorithm and the two must not drift into calling it different things.
 */
const ALGORITHMS: ReadonlyArray<{ id: ProofChamberAlgorithm; label: string }> = PROOF_CHAMBER_ALGORITHMS.map((id) => ({
    id,
    label: ALGORITHM_LABELS[id],
}));

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

type ChamberControlRange = {
    min: number;
    max: number;
};

function decayRangeForAlgorithm(algorithm: ProofChamberAlgorithm): ChamberControlRange {
    if (algorithm === 'spring') {
        return { min: 0, max: 0.95 };
    }
    if (algorithm === 'reverse') {
        return { min: 0, max: 0.99 };
    }
    return { min: 0, max: 0.999 };
}

function dampingRangeForAlgorithm(algorithm: ProofChamberAlgorithm): ChamberControlRange {
    if (algorithm === 'spring') {
        return { min: 0, max: 0.99 };
    }
    return { min: 0, max: 0.999 };
}

function clampToRange(value: number, range: ChamberControlRange): number {
    return Math.max(range.min, Math.min(range.max, value));
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

/**
 * A chip that refuses its write while the live algorithm cannot hear the
 * parameter behind it.
 *
 * `aria-disabled` rather than the `disabled` attribute: a disabled chip here is
 * always carrying a `title` that explains itself, and the HTML attribute would
 * take the chip out of the tab order and out of a screen reader's reach, which
 * would leave a keyboard user with a control that is dead *and* silent about
 * why. The click handler is guarded rather than removed so the refusal is the
 * component's behaviour and not an accident of how the parent spelled a prop.
 */
const GatedChip = ({
    gate,
    onClick,
    ...props
}: ComponentProps<typeof DawPluginChip> & { gate: ChamberControlGate }): ReactElement => (
    <ChamberChip
        {...props}
        aria-disabled={gate.isInert || undefined}
        title={gate.explanation ?? undefined}
        onClick={(event) => {
            if (gate.isInert) {
                return;
            }
            onClick?.(event);
        }}
    />
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
    gate,
    activeRange,
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
    gate: ChamberControlGate;
    /** Selected-engine travel; `min`/`max` remain the persisted parameter domain. */
    activeRange?: ChamberControlRange;
}): ReactElement {
    return (
        <Stack
            align="center"
            gap={1}
            className="min-w-[68px] rounded-[18px] border border-white/8 bg-[var(--color-bg-panelInset)] px-2 py-2 shadow-[var(--shadow-elevation-inset)]"
        >
            <RotaryKnob
                value={value}
                onChange={onChange}
                min={activeRange?.min ?? min}
                max={activeRange?.max ?? max}
                step={step}
                defaultValue={defaultValue}
                size={size}
                bipolar={bipolar}
                tone="amber"
                // The visible label is drawn in the sibling below, so the knob
                // itself has none — and `RotaryKnob` falls back to the shared
                // "Parameter control" name when it is given nothing, which is
                // what every knob on this panel was called. Naming it here
                // rather than passing `label` keeps the layout as it was.
                aria-label={label}
                disabled={gate.isInert}
                title={gate.explanation ?? undefined}
            />
            <div className="text-[8px] uppercase tracking-[0.2em] text-white/58">{label}</div>
            {readout ? <div className="font-mono text-[9px] text-white/42">{readout}</div> : null}
        </Stack>
    );
}

export const ProofChamberPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const storeState = useStore(chamberStore, { activeInstanceId: null, instances: {} });
    const trackState = useStore(trackStore, defaultTrackState);
    const params = storeState?.instances?.[deviceId]?.engineState ?? DEFAULT_PARAMS;
    const projectParameterValues = trackState.tracks
        .flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)?.parameterValues;

    useEffect(() => {
        registerChamberInstance(deviceId);
    }, [deviceId]);

    useEffect(() => {
        hydrateChamberStateFromProject(deviceId);
    }, [deviceId, projectParameterValues]);
    const [showDecayEq, setShowDecayEq] = useState(false);
    const [showFlow, setShowFlow] = useState(false);
    const decayRange = decayRangeForAlgorithm(params.algorithm);
    const dampingRange = dampingRangeForAlgorithm(params.algorithm);
    const effectiveDecay = clampToRange(params.decay, decayRange);
    const effectiveDamping = clampToRange(params.damping, dampingRange);

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
     * Whether the algorithm now selected can hear this parameter at all.
     *
     * Every control on the panel asks, and the answer comes from the engine-gap
     * census in `#/utils/nativeDspEngineGaps` — the same table
     * `descriptorEngineParamWeld.spec.ts` asserts in both directions. Nothing
     * here enumerates which knobs are dead; the day a gap is closed in Rust its
     * row is deleted (the weld spec reds until it is) and the control comes
     * back on its own.
     */
    function gateFor(paramKey: keyof ProofChamberEngineState, controlLabel: string): ChamberControlGate {
        return chamberControlGate({ algorithm: params.algorithm, paramKey, controlLabel });
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
     *
     * ## This batch needed the engine-side cache too
     *
     * `algorithm` goes first and the expanded parameters follow, and every one
     * of those parameter actions is subject to `handleSetDeviceParameter`'s
     * `isNoop` (`parameterValues[paramId] === value`), which
     * `executeAppActionBatch` uses to skip an action whose value already equals
     * project truth. So on a **repeat** click of a tile whose values are still
     * in the project — load `hall`, audition another algorithm from the rail,
     * click `hall` again — the twenty-one non-algorithm actions are all no-ops
     * and the only thing that reaches the device is the bare `algorithm` write.
     *
     * Before the parameter cache that write reconstructed the engine and
     * replayed nothing into it, so a re-clicked space tile loaded a reverb at
     * constructor defaults: measured on the PR base, a re-clicked `hall`
     * rendered bit-identical to a plate that had never been told anything, and
     * 13.511 dB peak away from the preset the tile claims to load. All eight
     * `SPACE_PRESETS` were reachable in that state. The cache
     * (`crates/proof-chamber/src/lib.rs`, replayed at `lib.rs:363`) is what
     * makes this tile actually load its preset on the second click; the batch
     * here was never the missing half.
     *
     * `selectAlgorithm` below explains why a panel-side replay cannot fix that,
     * and the no-op filter it defends as correct is the same filter that had
     * been eating this function's preset batch. Both are true: the filter is
     * right about *project truth* — nothing changed, so nothing is written —
     * and the engine losing its state is not a change in truth, so it has to be
     * resynced where the loss happens.
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

    /**
     * Select a reverb algorithm.
     *
     * One function rather than two identical chip handlers — the selector is
     * drawn twice, on the rail and in the Engine card.
     *
     * ## Why this writes `algorithm` and nothing else
     *
     * It used to reset the device. `ProofChamberInstance::set_param`
     * constructed a **new** engine when `algorithm` arrived and replayed
     * nothing into it, so every parameter reverted to the constructor's
     * defaults — measured plate → reverse → plate as bit-identical to an
     * engine nobody had ever written to (`max_delta = 0e0` against defaults,
     * `7.77e-1` against the settings the user had). `mix` went the same way,
     * so it had nothing to do with gating and predated it.
     *
     * A panel-side replay was tried here and removed, because it cannot work
     * at this layer. Sourcing it from the store writes stale values over
     * project truth; sourcing it from project truth makes every replayed
     * action satisfy `handleSetDeviceParameter`'s `isNoop` —
     * `parameterValues[paramId] === value` — so `executeAppActionBatch` skips
     * all of them and the engine is never told. The two required fixes are
     * contradictory. A replay is an engine *resync*, and `executeAppAction*`
     * propagates *changes to truth*; the no-op filter is right and the payload
     * was the wrong shape for it.
     *
     * That filter is not a hypothetical objection to a replay nobody wrote. It
     * had already been emptying `selectSpace`'s preset batch above — on a
     * repeat click of a space tile the twenty-one parameter actions all equal
     * project truth, so the device received only `algorithm` and, before the
     * cache, rebuilt at defaults. Same filter, same correctness, one function
     * up; see that note for the measurement.
     *
     * The fix is a parameter cache inside `ProofChamberInstance`
     * (`crates/proof-chamber/src/lib.rs`, replayed at `lib.rs:363`), the one
     * place every writer of `algorithm` must pass through — which the
     * Inspector, MIDI learn, undo and the initial project projection all do
     * without any of them being able to carry a replay of their own. So this
     * handler stays a single write, and that is now correct rather than merely
     * unavoidable.
     */
    function selectAlgorithm(next: ProofChamberAlgorithm): void {
        updateChamberEngine(deviceId, (prev: ProofChamberEngineState) => ({ ...prev, algorithm: next }));

        void executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId, paramId: 'algorithm', value: ALGORITHM_MAP[next] ?? 0 },
        });
    }

    /**
     * The Decay EQ's six bands are one control as far as gating is concerned:
     * a loop either has per-pass loss for a multiplier to be relative to or it
     * does not, so the six ids are always gated together.
     *
     * Three states make it inert and only one of them is about the algorithm.
     * `chamberDecayEqGate` also answers for Freeze — which holds the tank at
     * unity and is a chip sitting right beside the Decay EQ chip — and for the
     * top of the Decay range, where the tail loses less per pass than the
     * shaping would add. Both were previously silent: the nodes dragged, the
     * writes persisted, and the render was bit-identical, which is the defect
     * this whole PR exists to close, reappearing one layer up.
     */
    const decayEqGate = chamberDecayEqGate({
        algorithm: params.algorithm,
        freeze: params.freeze,
        decay: effectiveDecay,
    });
    const decayEqMultipliers = PROOF_CHAMBER_DECAY_EQ_BANDS.map((band) => params[band]);

    let tailViewLed = 'Live tail';
    if (decayEqGate.isInert && showDecayEq) {
        tailViewLed = 'EQ no headroom';
    } else if (showDecayEq) {
        tailViewLed = 'EQ overlay';
    } else if (showFlow) {
        tailViewLed = 'Flow open';
    }

    return (
        <Row align="stretch" gap={3} className="proof-chamber-faceplate h-full min-h-0 overflow-hidden p-3">
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
                    <Row align="stretch" wrap gap={1.5}>
                        {VINTAGE_MODES.map((mode) => {
                            const active = params.vintage === mode.id;
                            return (
                                <ChamberChip key={mode.id} active={active} onClick={() => setParam('vintage', mode.id)}>
                                    {mode.label}
                                </ChamberChip>
                            );
                        })}
                    </Row>
                    <Row align="stretch" wrap gap={1.5}>
                        {ALGORITHMS.map((algorithm) => {
                            const active = params.algorithm === algorithm.id;
                            return (
                                <ChamberChip
                                    key={algorithm.id}
                                    active={active}
                                    onClick={() => selectAlgorithm(algorithm.id)}
                                >
                                    {algorithm.label}
                                </ChamberChip>
                            );
                        })}
                    </Row>
                    <Row align="stretch" wrap gap={1.5}>
                        {/*
                         * The chip still opens the overlay on an algorithm that
                         * cannot hear it — this is a *view* toggle, not a
                         * parameter write, and hiding the curve would hide the
                         * shape a project has saved. What the gate does is
                         * carry the explanation and hand the overlay its
                         * disabled state, so the nodes draw and refuse to move
                         * rather than moving and doing nothing.
                         */}
                        <ChamberChip
                            active={showDecayEq}
                            title={decayEqGate.explanation ?? undefined}
                            onClick={() => setShowDecayEq((value) => !value)}
                        >
                            Decay EQ
                        </ChamberChip>
                        <ChamberChip active={showFlow} onClick={() => setShowFlow((value) => !value)}>
                            Flow
                        </ChamberChip>
                        <GatedChip
                            gate={gateFor('freeze', 'Freeze')}
                            active={params.freeze}
                            onClick={() => setParam('freeze', !params.freeze)}
                        >
                            Freeze
                        </GatedChip>
                        <GatedChip
                            gate={gateFor('shimmer', 'Shimmer')}
                            active={params.shimmer}
                            onClick={() => setParam('shimmer', !params.shimmer)}
                        >
                            Shimmer
                        </GatedChip>
                        <GatedChip
                            gate={gateFor('saturation', 'Saturation')}
                            active={params.saturation}
                            onClick={() => setParam('saturation', !params.saturation)}
                        >
                            Saturation
                        </GatedChip>
                    </Row>
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

            <Stack as="section" grow gap={3} className="min-w-0 overflow-y-auto pr-1">
                <Row as="header" wrap gap={2.5} shrink={false} className="proof-chamber-window px-3 py-2">
                    <Stack gap={1}>
                        <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-amber)]/72">
                            Reverb stage
                        </div>
                        <div className="text-[14px] font-semibold text-white/92">
                            {SPACES.find((space) => space.id === params.space)?.label ?? 'Hall'}
                        </div>
                    </Stack>
                    <DawPluginMetricStrip className="ml-auto">
                        <StatusTile
                            label="Decay"
                            value={formatDecayReadout(effectiveDecay, params.algorithm)}
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
                </Row>

                <div className="grid min-h-0 shrink-0 grid-cols-[minmax(0,1.1fr)_280px] gap-3">
                    <div className="proof-chamber-window min-h-[280px] overflow-hidden">
                        <Stack className="h-full">
                            <Row justify="between" className="px-3 py-2">
                                <div className="text-[9px] uppercase tracking-[0.24em] text-white/44">Tail view</div>
                                <ChamberLed>{tailViewLed}</ChamberLed>
                            </Row>
                            <div className="relative min-h-0 flex-1 border-t border-white/6">
                                <ReverbSpectrogram decay={effectiveDecay} damping={effectiveDamping} />
                                {showDecayEq ? (
                                    <DecayEqOverlay
                                        multipliers={decayEqMultipliers}
                                        // The write goes through `setParam` like
                                        // every other control, rather than
                                        // straight to `executeAppAction` as it
                                        // used to. That is what puts the curve
                                        // into `chamberStore` — so the nodes
                                        // draw where the project says they are
                                        // after a reload instead of snapping
                                        // back to 1.0x — and it is what routes
                                        // the id through `PARAM_MAP`, which is
                                        // the same hop the gate above reads.
                                        onChange={(band, multiplier) => {
                                            // Refused here as well as inside
                                            // the overlay, on the same
                                            // principle as `GatedChip`: the
                                            // panel owns whether a write leaves
                                            // it, so a gated parameter cannot
                                            // reach project truth through a
                                            // child that forgot to check.
                                            if (decayEqGate.isInert) {
                                                return;
                                            }
                                            const field = PROOF_CHAMBER_DECAY_EQ_BANDS[band];
                                            if (field === undefined) {
                                                return;
                                            }
                                            setParam(field, multiplier);
                                        }}
                                        disabled={decayEqGate.isInert}
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
                        </Stack>
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
                                    value={formatValue(effectiveDamping, '%')}
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
                            <Row align="stretch" wrap gap={1.5}>
                                <GatedChip
                                    gate={gateFor('shimmer', 'Shimmer')}
                                    active={params.shimmer}
                                    onClick={() => setParam('shimmer', !params.shimmer)}
                                >
                                    Shimmer
                                </GatedChip>
                                <GatedChip
                                    gate={gateFor('freeze', 'Freeze')}
                                    active={params.freeze}
                                    onClick={() => setParam('freeze', !params.freeze)}
                                >
                                    Freeze
                                </GatedChip>
                                <GatedChip
                                    gate={gateFor('saturation', 'Saturation')}
                                    active={params.saturation}
                                    onClick={() => setParam('saturation', !params.saturation)}
                                >
                                    Saturation
                                </GatedChip>
                            </Row>
                            {params.shimmer ? (
                                <Grid cols={2} gap={2}>
                                    <KnobCell
                                        label="Amount"
                                        gate={gateFor('shimmerAmount', 'Amount')}
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
                                        gate={gateFor('shimmerPitch', 'Pitch')}
                                        value={params.shimmerPitch}
                                        onChange={(value) => setParam('shimmerPitch', Math.round(value))}
                                        min={0}
                                        max={1}
                                        step={1}
                                        defaultValue={1}
                                        size="sm"
                                        readout={params.shimmerPitch < 0.5 ? 'Fifth' : 'Octave'}
                                    />
                                </Grid>
                            ) : null}
                            {params.saturation ? (
                                <Row align="stretch" wrap gap={1.5}>
                                    {SATURATION_CURVES.map((curve) => (
                                        <GatedChip
                                            key={curve.id}
                                            gate={gateFor('saturationType', 'The saturation curve')}
                                            active={params.saturationType === curve.id}
                                            onClick={() => setParam('saturationType', curve.id)}
                                        >
                                            {curve.label}
                                        </GatedChip>
                                    ))}
                                </Row>
                            ) : null}
                        </SectionCard>
                    </DawPluginRail>
                </div>

                <section className="proof-chamber-window shrink-0 p-3">
                    <Row justify="between" gap={3} className="mb-3">
                        <div>
                            <div className="text-[9px] uppercase tracking-[0.24em] text-white/44">Control deck</div>
                            <div className="mt-1 text-[13px] font-semibold text-white/88">Space, tone, motion</div>
                        </div>
                        <Row gap={2} className="text-[10px] text-white/48">
                            <Waves className="size-3.5" />
                            <span>Keep the tail centered, tweak the edges on the right.</span>
                        </Row>
                    </Row>

                    <div className="grid gap-3 xl:grid-cols-5 md:grid-cols-3">
                        <SectionCard title="Core" detail="Size">
                            <Grid cols={2} gap={2}>
                                <KnobCell
                                    label="Size"
                                    gate={gateFor('size', 'Size')}
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
                                    gate={gateFor('decay', 'Decay')}
                                    value={effectiveDecay}
                                    onChange={(value) => setParam('decay', value)}
                                    min={0}
                                    max={0.999}
                                    step={0.001}
                                    defaultValue={0.5}
                                    size="md"
                                    readout={formatDecayReadout(effectiveDecay, params.algorithm)}
                                    activeRange={decayRange}
                                />
                                <KnobCell
                                    label="Mix"
                                    gate={gateFor('mix', 'Mix')}
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
                                    gate={gateFor('predelay', 'Pre')}
                                    value={params.predelay}
                                    onChange={(value) => setParam('predelay', value)}
                                    min={0}
                                    max={500}
                                    step={1}
                                    defaultValue={15}
                                    size="md"
                                    readout={formatValue(params.predelay, 'ms')}
                                />
                            </Grid>
                        </SectionCard>

                        <SectionCard title="Tone" detail="Cuts">
                            <Grid cols={2} gap={2}>
                                <KnobCell
                                    label="Hi Cut"
                                    gate={gateFor('highCut', 'Hi Cut')}
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
                                    gate={gateFor('lowCut', 'Lo Cut')}
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
                                    gate={gateFor('damping', 'Damp')}
                                    value={effectiveDamping}
                                    onChange={(value) => setParam('damping', value)}
                                    min={0}
                                    max={0.999}
                                    step={0.001}
                                    defaultValue={0.3}
                                    size="md"
                                    readout={formatValue(effectiveDamping, '%')}
                                    activeRange={dampingRange}
                                />
                                <KnobCell
                                    label="Diffuse"
                                    gate={gateFor('diffusion', 'Diffuse')}
                                    value={params.diffusion}
                                    onChange={(value) => setParam('diffusion', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.75}
                                    size="md"
                                    readout={formatValue(params.diffusion, '%')}
                                />
                            </Grid>
                        </SectionCard>

                        <SectionCard title="Motion" detail="Swirl">
                            <Grid cols={2} gap={2}>
                                <KnobCell
                                    label="Rate"
                                    gate={gateFor('modRate', 'Rate')}
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
                                    gate={gateFor('modDepth', 'Depth')}
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
                                    gate={gateFor('width', 'Width')}
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
                                    gate={gateFor('earlyLateBalance', 'E/L')}
                                    value={params.earlyLateBalance}
                                    onChange={(value) => setParam('earlyLateBalance', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.4}
                                    size="md"
                                    readout={formatValue(params.earlyLateBalance, '%')}
                                />
                            </Grid>
                        </SectionCard>

                        <SectionCard title="Character" detail="Push">
                            <Grid cols={2} gap={2}>
                                <KnobCell
                                    label="Gravity"
                                    gate={gateFor('gravity', 'Gravity')}
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
                                    gate={gateFor('vintage', 'Vintage')}
                                    value={params.vintage}
                                    onChange={(value) => setParam('vintage', Math.round(value))}
                                    min={0}
                                    max={2}
                                    step={1}
                                    defaultValue={0}
                                    size="md"
                                    readout={VINTAGE_MODES[Math.round(params.vintage)]?.label ?? 'Modern'}
                                />
                                <KnobCell
                                    label="Density"
                                    gate={gateFor('density', 'Density')}
                                    value={params.density}
                                    onChange={(value) => setParam('density', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={1}
                                    size="md"
                                    readout={formatValue(params.density, '%')}
                                />
                            </Grid>
                            <Row align="stretch" wrap gap={1.5}>
                                {VINTAGE_MODES.map((mode) => (
                                    <ChamberChip
                                        key={mode.id}
                                        active={params.vintage === mode.id}
                                        onClick={() => setParam('vintage', mode.id)}
                                    >
                                        {mode.label}
                                    </ChamberChip>
                                ))}
                            </Row>
                        </SectionCard>

                        <SectionCard title="Engine" detail="Algo">
                            <Grid cols={2} gap={2}>
                                <DawPluginInsetCard
                                    className="proof-chamber-window"
                                    title="Algorithm"
                                    headerSize="xs"
                                    titleClassName="text-white/46"
                                >
                                    <Row align="stretch" wrap gap={1.5}>
                                        {ALGORITHMS.map((algorithm) => (
                                            <ChamberChip
                                                key={algorithm.id}
                                                active={params.algorithm === algorithm.id}
                                                onClick={() => selectAlgorithm(algorithm.id)}
                                            >
                                                {algorithm.label}
                                            </ChamberChip>
                                        ))}
                                    </Row>
                                </DawPluginInsetCard>
                                <DawPluginInsetCard
                                    className="proof-chamber-window"
                                    title="State"
                                    headerSize="xs"
                                    titleClassName="text-white/46"
                                >
                                    <Row align="stretch" wrap gap={1.5}>
                                        <ChamberLed>{params.freeze ? 'Freeze on' : 'Freeze off'}</ChamberLed>
                                        <ChamberLed>{params.shimmer ? 'Shimmer on' : 'Shimmer off'}</ChamberLed>
                                    </Row>
                                </DawPluginInsetCard>
                            </Grid>
                        </SectionCard>
                    </div>
                </section>
            </Stack>
        </Row>
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
