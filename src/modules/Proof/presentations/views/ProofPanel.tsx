import { type ReactElement, useLayoutEffect, useReducer, useRef } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginChoiceRow } from '#/components/daw/DawPluginChoiceRow';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricStrip } from '#/components/daw/DawPluginMetricStrip';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginRail } from '#/components/daw/DawPluginRail';
import { DawPluginReadoutList } from '#/components/daw/DawPluginReadoutList';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { RotaryKnob, type GestureAuthority } from '#/components/daw/RotaryKnob';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { getAudioSampleRate } from '#/modules/AudioEngine/useCases';

import { getLinkedBandValues } from '../../models/LinkedBandValues';
import { getProofLoudnessAlert } from '../../models/ProofLoudnessAlert';
import {
    getProofPatchSnapshot,
    PROOF_PATCH_RANGES,
    TARGET_LABELS,
    TARGET_LUFS,
    type ProofPatch,
    type ProofPatchEdit,
    type ProofTarget,
} from '../../models/ProofPatch';
import { PROOF_LOUDNESS_HISTORY_LENGTH } from '../../stores/proofLoudnessHistory';
import {
    proofStore,
    setProofUiLevel,
    setProofAbBypass,
    getProofState,
    DEFAULT_PROOF_STATE,
    type ProofState,
} from '../../stores/proofStore';
import { loadProofPatchWithAudio } from '../../useCases/proofParamBridge/loadProofPatchWithAudio';
import { reorderChain } from '../../useCases/proofParamBridge/reorderChain';
import { resetIntegratedMeters } from '../../useCases/proofParamBridge/resetIntegratedMeters';
import { setProofParam } from '../../useCases/proofParamBridge/setProofParam';
import { setProofParamWithPatch } from '../../useCases/proofParamBridge/setProofParamWithPatch';
import { setProofTarget } from '../../useCases/proofParamBridge/setProofTarget';
import { PROOF_PRESETS } from '../../useCases/proofPresets';
import { LoudnessHistory } from '../components/LoudnessHistory';
import { ProofDynSection } from '../components/ProofDynSection';
import { ProofEqSection } from '../components/ProofEqSection';
import { ProofExciterSection } from '../components/ProofExciterSection';
import { ProofImagerSection } from '../components/ProofImagerSection';
import { ProofLimiterSection } from '../components/ProofLimiterSection';
import { TonalBalance } from '../components/TonalBalance';
import { useProofAnalyser } from '../hooks/useProofAnalyser';
import { useProofLoudnessHistory } from '../hooks/useProofLoudnessHistory';
import { useProofMeter } from '../hooks/useProofMeter';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MODULE_LABELS = ['EQ', 'Dynamics', 'Imager', 'Exciter', 'Limiter'] as const;
const MODULE_COLORS = [
    'var(--color-accent-cyan)',
    'var(--color-accent-peach)',
    'var(--color-accent-mint)',
    'var(--color-accent-lavender)',
    'var(--color-state-danger)',
] as const;

// Selectable delivery targets. `custom` is deliberately absent: it is the state
// a saved project can carry, not one the user picks here. Label and loudness
// both come from the model so a chip cannot disagree with the alert copy.
const TARGET_OPTIONS: { value: ProofTarget; label: string; lufs: number }[] = (
    ['streaming', 'cd', 'club', 'broadcast', 'podcast'] as const
).map((value) => ({ value, label: TARGET_LABELS[value], lufs: TARGET_LUFS[value] }));

const LEVEL_OPTIONS = [
    { level: 1 as const, label: 'Play', detail: 'Target' },
    { level: 2 as const, label: 'Shape', detail: 'Tone' },
    { level: 3 as const, label: 'Build', detail: 'Modules' },
    { level: 4 as const, label: 'Route', detail: 'Chain' },
    { level: 5 as const, label: 'Lab', detail: 'Check' },
];

type ProofPatchChange = (edit: ProofPatchEdit) => void;

function formatLufs(v: number): string {
    if (v <= -100) {
        return '-∞';
    }
    return `${v.toFixed(1)}`;
}

function formatDb(v: number): string {
    if (v <= -100) {
        return '-∞';
    }
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

function getLevelMeta(level: ProofState['uiLevel']): {
    title: string;
    description: string;
} {
    if (level === 1) {
        return {
            title: 'Target desk',
            description: 'Set the landing zone, check what streaming will do, and keep the finish obvious.',
        };
    }

    if (level === 2) {
        return {
            title: 'Chain shape',
            description: 'See the mastering stations as one desk instead of five stacked pages.',
        };
    }

    if (level === 3) {
        return {
            title: 'Module detail',
            description: 'Drop into the heavy controls without losing the mastering frame around them.',
        };
    }

    if (level === 4) {
        return {
            title: 'Chain route',
            description: 'Reorder the path like hardware on a bench, with the mission still in sight.',
        };
    }

    return {
        title: 'Check bench',
        description: 'Deep metering, loudness history, and edge-case verification live here.',
    };
}

const SideCard = ({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactElement | ReactElement[];
}): ReactElement => (
    <DawPluginSectionCard
        className="proof-window shrink-0"
        title={title}
        detail={detail}
        titleClassName="text-[var(--color-accent-mint)]/70"
    >
        {children}
    </DawPluginSectionCard>
);

type ProofLevelContentProps = {
    patch: ProofPatch;
    uiLevel: ProofState['uiLevel'];
    deviceId: string;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: ProofPatchChange;
    onTargetSelection: (target: ProofTarget) => void;
    onChainReorder: (order: ProofPatch['chainOrder']) => void;
};

const ProofLevelContent = ({
    patch,
    uiLevel,
    deviceId,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
    onTargetSelection,
    onChainReorder,
}: ProofLevelContentProps): ReactElement => {
    if (uiLevel === 1) {
        return (
            <Level1Play
                patch={patch}
                deviceId={deviceId}
                gestureOwner={gestureOwner}
                gestureAuthority={gestureAuthority}
                onPatchChange={onPatchChange}
                onTargetSelection={onTargetSelection}
            />
        );
    }

    if (uiLevel === 2) {
        return (
            <Level2Shape
                patch={patch}
                deviceId={deviceId}
                gestureOwner={gestureOwner}
                gestureAuthority={gestureAuthority}
                onPatchChange={onPatchChange}
            />
        );
    }

    if (uiLevel === 3) {
        return (
            <Level3Build
                patch={patch}
                deviceId={deviceId}
                gestureOwner={gestureOwner}
                gestureAuthority={gestureAuthority}
                onPatchChange={onPatchChange}
            />
        );
    }

    if (uiLevel === 4) {
        return (
            <Level4Route
                patch={patch}
                deviceId={deviceId}
                gestureOwner={gestureOwner}
                gestureAuthority={gestureAuthority}
                onPatchChange={onPatchChange}
                onChainReorder={onChainReorder}
            />
        );
    }

    return <Level5Lab patch={patch} deviceId={deviceId} />;
};

function isModuleBypassed(patch: ProofPatch, moduleIndex: number): boolean {
    if (moduleIndex === 0) {
        return patch.eqBypassed;
    }

    if (moduleIndex === 1) {
        return patch.dynBypassed;
    }

    if (moduleIndex === 2) {
        return patch.imgBypassed;
    }

    if (moduleIndex === 3) {
        return patch.excBypassed;
    }

    return patch.limBypassed;
}

// ── Meter leaves ─────────────────────────────────────────────────────────────
//
// Everything fed by the ~16 ms meter poll is read here rather than at the panel
// root, so a meter frame re-renders the readout that shows it and leaves the
// desk — knobs, sections, gesture ownership — untouched.

const areTapPeaksEqual = (a: { peakL: number; peakR: number }, b: { peakL: number; peakR: number }): boolean =>
    a.peakL === b.peakL && a.peakR === b.peakR;

const areDynGrEqual = (a: readonly number[], b: readonly number[]): boolean =>
    a.every((value, index) => value === b[index]);

const ProofDeskMetrics = ({ deviceId }: { deviceId: string }): ReactElement => {
    const inputLufs = useProofMeter(deviceId, (state) => state.inputLufs);
    const outputLufs = useProofMeter(deviceId, (state) => state.outputLufs);
    const truePeakDb = useProofMeter(deviceId, (state) => state.truePeakDb);
    const lra = useProofMeter(deviceId, (state) => state.lra);

    return (
        <DawPluginMetricStrip>
            <DawPluginMetricTile
                className="proof-window"
                label="In"
                value={`${formatLufs(inputLufs)} LUFS`}
                detail="Incoming loudness"
            />
            <DawPluginMetricTile
                className="proof-window"
                label="Out"
                value={`${formatLufs(outputLufs)} LUFS`}
                detail="Current output"
            />
            <DawPluginMetricTile
                className="proof-window"
                label="Peak"
                value={`${formatDb(truePeakDb)} dBTP`}
                detail="True peak ceiling"
            />
            <DawPluginMetricTile
                className="proof-window"
                label="LRA"
                value={`${lra.toFixed(1)} LU`}
                detail="Loudness range"
            />
        </DawPluginMetricStrip>
    );
};

const ProofQuickReadMeters = ({ deviceId }: { deviceId: string }): ReactElement => {
    const integratedLufs = useProofMeter(deviceId, (state) => state.integratedLufs);
    const correlation = useProofMeter(deviceId, (state) => state.correlation);
    const limiterGrDb = useProofMeter(deviceId, (state) => state.limiterGrDb);

    return (
        <>
            <DawReadoutRow
                label="Integrated"
                value={`${formatLufs(integratedLufs)} LUFS`}
                valueClassName="text-foreground/85"
            />
            <DawReadoutRow label="Correlation" value={correlation.toFixed(2)} valueClassName="text-foreground/85" />
            <DawReadoutRow
                label="Limiter GR"
                value={`${Math.abs(limiterGrDb).toFixed(1)} dB`}
                valueClassName="text-foreground/85"
            />
        </>
    );
};

const ProofTapMeter = ({
    deviceId,
    tapIndex,
    label,
}: {
    deviceId: string;
    tapIndex: number;
    label?: string;
}): ReactElement => {
    const peaks = useProofMeter(
        deviceId,
        (state) => state.tapPeaks[tapIndex] ?? { peakL: -100, peakR: -100 },
        areTapPeaksEqual
    );

    return <MiniMeter peakL={peaks.peakL} peakR={peaks.peakR} label={label} />;
};

const ProofAbCompareChip = ({ deviceId }: { deviceId: string }): ReactElement => {
    const abBypass = useProofMeter(deviceId, (state) => state.abBypass);

    return (
        <DawPluginChip
            active={abBypass}
            aria-label="A/B compare"
            aria-pressed={abBypass}
            tone="mint"
            size="sm"
            onClick={() => {
                const next = !abBypass;
                // Runtime-only by contract: the engine hears it, the project
                // never stores it. `setProofParam` keeps `ab_bypass` out of the
                // persisted device row.
                setProofParam({ deviceId, name: 'ab_bypass', value: next ? 1 : 0 });
                setProofAbBypass({ deviceId, abBypass: next });
            }}
        >
            {abBypass ? 'A / dry' : 'B / wet'}
        </DawPluginChip>
    );
};

// ── Component ────────────────────────────────────────────────────────────────

export const ProofPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    // Two narrow subscriptions instead of one on the whole instances record.
    // The record gets a new identity on every meter frame — ~62 a second per
    // open device — so subscribing to it here re-rendered the entire desk on
    // every frame of every device, and cancelled in-flight knob gestures'
    // memoization along the way. Patch and desk level change only on a user
    // edit, so this tree re-renders only when the user changes something.
    const patch = useStoreSelector(
        proofStore,
        (instances) => instances?.[deviceId]?.patch ?? DEFAULT_PROOF_STATE.patch
    );
    const uiLevel = useStoreSelector(
        proofStore,
        (instances) => instances?.[deviceId]?.uiLevel ?? DEFAULT_PROOF_STATE.uiLevel
    );

    const patchSnapshot = getProofPatchSnapshot(patch);
    const [gestureOwner, setGestureOwner] = useReducer((_owner: number, nextOwner: number) => nextOwner, 0);
    const activeGestureTokenRef = useRef(0);
    const activeGestureFinalizerRef = useRef<(() => void) | null>(null);
    const gestureDeviceIdRef = useRef(deviceId);
    const patchSnapshotRef = useRef(patchSnapshot);
    const acceptedPatchSnapshotRef = useRef<string | null>(null);

    const advanceGestureOwner = (): number => {
        const nextOwner = activeGestureTokenRef.current + 1;
        activeGestureTokenRef.current = nextOwner;
        setGestureOwner(nextOwner);
        return nextOwner;
    };

    const invalidateGesture = (): void => {
        acceptedPatchSnapshotRef.current = null;
        activeGestureFinalizerRef.current = null;
        advanceGestureOwner();
    };

    const finalizeActiveGesture = (): void => {
        const finalizer = activeGestureFinalizerRef.current;
        // Finalizers commit through handlePatchChange, so release ownership before invoking one.
        activeGestureFinalizerRef.current = null;
        finalizer?.();
    };

    const acquireGesture = (finalize: () => void): number => {
        const previousFinalizer = activeGestureFinalizerRef.current;
        activeGestureFinalizerRef.current = null;
        if (previousFinalizer) {
            previousFinalizer();
            // Accept A's committed snapshot before advancing ownership to B.
            acceptedPatchSnapshotRef.current = getProofPatchSnapshot(getProofState(deviceId).patch);
        }
        const nextOwner = advanceGestureOwner();
        activeGestureFinalizerRef.current = finalize;
        return nextOwner;
    };

    const gestureAuthority: GestureAuthority = {
        acquire: acquireGesture,
        isCurrent: (token) => Object.is(activeGestureTokenRef.current, token),
    };

    useLayoutEffect(() => {
        const previousDeviceId = gestureDeviceIdRef.current;
        gestureDeviceIdRef.current = deviceId;
        const previousPatchSnapshot = patchSnapshotRef.current;
        patchSnapshotRef.current = patchSnapshot;
        if (previousDeviceId !== deviceId) {
            acceptedPatchSnapshotRef.current = null;
            activeGestureFinalizerRef.current = null;
            advanceGestureOwner();
            return;
        }
        const acceptedPatch = acceptedPatchSnapshotRef.current === patchSnapshot;
        acceptedPatchSnapshotRef.current = null;
        if (previousPatchSnapshot !== patchSnapshot && !acceptedPatch) {
            activeGestureFinalizerRef.current = null;
            advanceGestureOwner();
        }
    }, [deviceId, patchSnapshot]);

    const handlePatchChange: ProofPatchChange = (edit) => {
        if (edit.isTransient !== true) {
            finalizeActiveGesture();
        }
        setProofParamWithPatch({ deviceId, ...edit });
        if (edit.isTransient === true) {
            acceptedPatchSnapshotRef.current = getProofPatchSnapshot(getProofState(deviceId).patch);
            return;
        }
        acceptedPatchSnapshotRef.current = null;
    };

    const handleTargetSelection = (target: ProofTarget): void => {
        finalizeActiveGesture();
        setProofTarget({ deviceId, target });
    };

    // Routed through the chain-order use case rather than a raw patch write, so
    // the module's own door owns the engine reorder and the persisted order.
    // A pending knob preview still commits first, as it does for every other
    // committing gesture in the panel.
    const handleChainReorder = (order: ProofPatch['chainOrder']): void => {
        finalizeActiveGesture();
        reorderChain({ deviceId, order });
        acceptedPatchSnapshotRef.current = null;
    };

    const levelMeta = getLevelMeta(uiLevel);
    const targetLabel = TARGET_OPTIONS.find((option) => option.value === patch.target)?.label ?? patch.target;

    return (
        <div className="proof-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <div className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)_16rem] gap-3">
                <DawPluginRail>
                    <SideCard
                        title="Mission"
                        detail="Choose the target, the preset, and the depth of the mastering desk."
                    >
                        <Stack gap={2}>
                            <Stack gap={1}>
                                <div className="text-[10px] font-medium text-foreground">Presets</div>
                                <Stack gap={1}>
                                    {PROOF_PRESETS.map((preset) => {
                                        const active = patch.presetId === preset.id;
                                        return (
                                            <DawPluginChoiceRow
                                                key={preset.id}
                                                className="proof-window"
                                                active={active}
                                                title={preset.name}
                                                subtitle={`${preset.patch.target} · ${formatLufs(preset.patch.targetLufs)} LUFS`}
                                                onPress={() => {
                                                    invalidateGesture();
                                                    loadProofPatchWithAudio({ deviceId, patch: preset.patch });
                                                }}
                                            />
                                        );
                                    })}
                                </Stack>
                            </Stack>

                            <Stack gap={1}>
                                <div className="text-[10px] font-medium text-foreground">Targets</div>
                                <Row align="stretch" wrap gap={1.5}>
                                    {TARGET_OPTIONS.map((option) => {
                                        const active = patch.target === option.value;
                                        return (
                                            <DawPluginChip
                                                key={option.value}
                                                active={active}
                                                tone="mint"
                                                size="sm"
                                                onClick={() => handleTargetSelection(option.value)}
                                            >
                                                {option.label}
                                            </DawPluginChip>
                                        );
                                    })}
                                </Row>
                            </Stack>

                            <Stack gap={1}>
                                <div className="text-[10px] font-medium text-foreground">Desk depth</div>
                                <Stack gap={1}>
                                    {LEVEL_OPTIONS.map((entry) => {
                                        const active = uiLevel === entry.level;
                                        return (
                                            <DawPluginChoiceRow
                                                key={entry.label}
                                                className="proof-window"
                                                active={active}
                                                title={entry.label}
                                                detail={entry.detail}
                                                onPress={() => setProofUiLevel({ deviceId, level: entry.level })}
                                            />
                                        );
                                    })}
                                </Stack>
                            </Stack>
                        </Stack>
                    </SideCard>
                </DawPluginRail>

                <Stack as="section" gap={3} className="min-w-0">
                    <Row align="start" justify="between" gap={3}>
                        <Stack gap={2}>
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-mint)]/70">
                                Mastering desk
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">{levelMeta.title}</div>
                            <span className="sr-only">{levelMeta.description}</span>
                        </Stack>

                        <ProofDeskMetrics deviceId={deviceId} />
                    </Row>

                    <div className="proof-window min-h-0 flex-1 overflow-auto p-3">
                        <ProofLevelContent
                            patch={patch}
                            uiLevel={uiLevel}
                            deviceId={deviceId}
                            gestureOwner={gestureOwner}
                            gestureAuthority={gestureAuthority}
                            onPatchChange={handlePatchChange}
                            onTargetSelection={handleTargetSelection}
                            onChainReorder={handleChainReorder}
                        />
                    </div>
                </Stack>

                <DawPluginRail>
                    <SideCard title="Quick read" detail="Keep the mission, the chain, and the compare switch in reach.">
                        <DawPluginReadoutList>
                            <DawReadoutRow label="Preset" value={patch.name} valueClassName="text-foreground/85" />
                            <DawReadoutRow label="Target" value={targetLabel} valueClassName="text-foreground/85" />
                            <ProofQuickReadMeters deviceId={deviceId} />
                        </DawPluginReadoutList>
                    </SideCard>

                    <SideCard
                        title="Chain"
                        detail="The mastering stations stay visible even when you dive into one deck."
                    >
                        <Stack gap={1.5}>
                            {patch.chainOrder.map((moduleIndex, slot) => {
                                const label = MODULE_LABELS[moduleIndex] ?? '?';
                                const bypassed = isModuleBypassed(patch, moduleIndex);
                                return (
                                    <DawPluginChoiceRow
                                        key={moduleIndex}
                                        className="proof-window"
                                        title={label}
                                        startSlot={
                                            <span className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/45">
                                                {slot + 1}
                                            </span>
                                        }
                                        endSlot={
                                            <DawPluginLed tone="mint" className={bypassed ? 'opacity-50' : ''}>
                                                {bypassed ? 'Bypass' : 'Live'}
                                            </DawPluginLed>
                                        }
                                    />
                                );
                            })}
                        </Stack>
                    </SideCard>

                    <SideCard title="Check" detail="Compare and reset without hunting through the deck.">
                        <Stack gap={2}>
                            <ProofAbCompareChip deviceId={deviceId} />
                            <DawPluginChip
                                type="button"
                                tone="mint"
                                size="sm"
                                onClick={() => resetIntegratedMeters(deviceId)}
                            >
                                Reset loudness
                            </DawPluginChip>
                            <Stack align="center" gap={1} className="pt-1">
                                <RotaryKnob
                                    value={patch.limCeiling}
                                    aria-label="Master limiter ceiling"
                                    onChange={(value, isTransient) =>
                                        handlePatchChange({
                                            key: 'limCeiling',
                                            value,
                                            isTransient,
                                        })
                                    }
                                    gestureOwner={gestureOwner}
                                    gestureAuthority={gestureAuthority}
                                    min={-12}
                                    max={0}
                                    step={0.1}
                                    defaultValue={-1}
                                    size="md"
                                    tone="cyan"
                                />
                                <span className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">
                                    Ceiling
                                </span>
                                <span className="font-mono text-[9px] text-foreground/85">
                                    {patch.limCeiling.toFixed(1)} dBTP
                                </span>
                            </Stack>
                        </Stack>
                    </SideCard>
                </DawPluginRail>
            </div>
        </div>
    );
};

// ── Level 1: Play ────────────────────────────────────────────────────────────

const Level1Play = ({
    patch,
    deviceId,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
    onTargetSelection,
}: {
    patch: ProofPatch;
    deviceId: string;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: ProofPatchChange;
    onTargetSelection: (target: ProofTarget) => void;
}): ReactElement => {
    return (
        <Row justify="center" grow className="gap-12 px-8">
            {/* Target selector */}
            <Stack align="center" gap={2}>
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Target</span>
                <Stack gap={1}>
                    {TARGET_OPTIONS.map((opt) => (
                        <Button
                            variant="bare"
                            size="bare"
                            key={opt.value}
                            type="button"
                            className={`px-3 py-1 rounded text-[9px] font-medium transition-colors cursor-pointer ${
                                patch.target === opt.value
                                    ? 'bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)] border border-[var(--color-accent-mint)]/30'
                                    : 'text-muted-foreground hover:text-foreground border border-transparent hover:border-border/30'
                            }`}
                            onClick={() => {
                                onTargetSelection(opt.value);
                            }}
                        >
                            {opt.label} ({opt.lufs} LUFS)
                        </Button>
                    ))}
                </Stack>
            </Stack>

            {/* Big LUFS meters */}
            <Level1Meters patch={patch} deviceId={deviceId} />

            {/* Ceiling knob */}
            <Stack align="center" gap={1}>
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Ceiling</span>
                <RotaryKnob
                    value={patch.limCeiling}
                    aria-label="Mission limiter ceiling"
                    onChange={(value, isTransient) => onPatchChange({ key: 'limCeiling', value, isTransient })}
                    gestureOwner={gestureOwner}
                    min={-12}
                    max={0}
                    step={0.1}
                    defaultValue={-1}
                    size="lg"
                    tone="cyan"
                    gestureAuthority={gestureAuthority}
                />
                <span className="text-[8px] text-muted-foreground font-mono">{patch.limCeiling.toFixed(1)} dBTP</span>
            </Stack>
        </Row>
    );
};

const Level1Meters = ({ patch, deviceId }: { patch: ProofPatch; deviceId: string }): ReactElement => {
    const inputLufs = useProofMeter(deviceId, (state) => state.inputLufs);
    const outputLufs = useProofMeter(deviceId, (state) => state.outputLufs);
    const outputStLufs = useProofMeter(deviceId, (state) => state.outputStLufs);
    const integratedLufs = useProofMeter(deviceId, (state) => state.integratedLufs);
    const correlation = useProofMeter(deviceId, (state) => state.correlation);
    const alert = getProofLoudnessAlert({
        target: patch.target,
        targetLufs: patch.targetLufs,
        integratedLufs,
    });

    return (
        <Stack align="center" gap={3}>
            <Row align="stretch" gap={8}>
                <Stack align="center">
                    <span className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1">Input</span>
                    <span className="text-2xl font-mono text-foreground tabular-nums">{formatLufs(inputLufs)}</span>
                    <span className="text-[8px] text-muted-foreground">LUFS</span>
                </Stack>
                <div className="w-px h-16 bg-border/20 self-center" />
                <Stack align="center">
                    <span className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1">Output</span>
                    <span className="text-2xl font-mono text-foreground tabular-nums">{formatLufs(outputLufs)}</span>
                    <span className="text-[8px] text-muted-foreground">LUFS</span>
                </Stack>
            </Row>
            <Row align="stretch" gap={4} className="text-[8px] text-muted-foreground font-mono">
                <span>Integrated: {formatLufs(integratedLufs)}</span>
                <span>Short-term: {formatLufs(outputStLufs)}</span>
                <span>Correlation: {correlation.toFixed(2)}</span>
            </Row>

            {/* Loudness-normalization warning */}
            {alert ? (
                <div
                    role="alert"
                    aria-live="polite"
                    className="px-3 py-1.5 rounded bg-[var(--color-accent-peach)]/10 border border-[var(--color-accent-peach)]/20 text-[9px] text-[var(--color-accent-peach)] max-w-xs text-center"
                >
                    {alert.message}
                </div>
            ) : null}
        </Stack>
    );
};

// ── Level 2: Shape ───────────────────────────────────────────────────────────

const Level2Shape = ({
    patch,
    deviceId,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: {
    patch: ProofPatch;
    deviceId: string;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: ProofPatchChange;
}): ReactElement => {
    const bypasses = [patch.eqBypassed, patch.dynBypassed, patch.imgBypassed, patch.excBypassed, patch.limBypassed];
    const bypassKeys = ['eqBypassed', 'dynBypassed', 'imgBypassed', 'excBypassed', 'limBypassed'] as const;

    return (
        <Stack grow gap={2} className="px-3 py-2">
            {/* Signal chain strip with inline meters */}
            <Row gap={1}>
                {/* Input meter */}
                <ProofTapMeter deviceId={deviceId} tapIndex={0} label="IN" />

                {patch.chainOrder.map((moduleIdx, slot) => {
                    const bypassed = bypasses[moduleIdx] ?? false;
                    const color = MODULE_COLORS[moduleIdx] ?? 'var(--color-accent-cyan)';
                    const label = MODULE_LABELS[moduleIdx] ?? '?';
                    const tapIdx = slot + 1;

                    return (
                        <Row gap={1} key={moduleIdx}>
                            <div className="w-4 h-px bg-border/30" />
                            <Button
                                variant="bare"
                                size="bare"
                                type="button"
                                aria-label={`${label} module`}
                                aria-pressed={!bypassed}
                                className={`px-2 py-1 rounded text-[8px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                                    bypassed
                                        ? 'opacity-30 text-muted-foreground border border-border/20'
                                        : `border border-current/20`
                                }`}
                                style={{ color: bypassed ? undefined : color }}
                                onClick={() => onPatchChange({ key: bypassKeys[moduleIdx]!, value: !bypassed })}
                            >
                                {label}
                            </Button>
                            <div className="w-4 h-px bg-border/30" />
                            <ProofTapMeter deviceId={deviceId} tapIndex={tapIdx} />
                        </Row>
                    );
                })}
            </Row>

            {/* Primary knobs per module */}
            <Row align="start" justify="around" grow className="pt-2">
                <KnobColumn
                    label="Dynamics"
                    sublabel="Threshold"
                    bypassed={patch.dynBypassed}
                    value={patch.dynBands[0]?.threshold ?? -20}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onChange={(value, isTransient) => {
                        // Macro move: every band shifts by the same offset, so
                        // the preset's band-to-band threshold tilt survives.
                        const thresholds = getLinkedBandValues({
                            values: patch.dynBands.map((band) => band.threshold),
                            representativeIndex: 0,
                            requestedValue: value,
                            min: PROOF_PATCH_RANGES.dynBand.threshold[0],
                            max: PROOF_PATCH_RANGES.dynBand.threshold[1],
                        });
                        const bands = patch.dynBands.map((band, bandIndex) => ({
                            ...band,
                            threshold: thresholds[bandIndex] ?? band.threshold,
                        }));
                        onPatchChange({
                            key: 'dynBands',
                            value: bands,
                            changedParams: bands.flatMap((band, bandIndex) =>
                                patch.dynBands[bandIndex]?.threshold === band.threshold
                                    ? []
                                    : [{ bandIndex, field: 'threshold' as const }]
                            ),
                            isTransient,
                        });
                    }}
                    min={-60}
                    max={0}
                    unit="dB"
                    color={MODULE_COLORS[1]}
                    defaultValue={-20}
                />
                <KnobColumn
                    label="Imager"
                    sublabel="Width"
                    bypassed={patch.imgBypassed}
                    value={patch.imgBandWidth[2] ?? 1}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onChange={(value, isTransient) => {
                        // Bands 2 and 3 move together and keep their spread; the
                        // low bands stay where the preset put them, mono bass
                        // included.
                        const linked = getLinkedBandValues({
                            values: [patch.imgBandWidth[2], patch.imgBandWidth[3]],
                            representativeIndex: 0,
                            requestedValue: value,
                            min: PROOF_PATCH_RANGES.imgBandWidth[0],
                            max: PROOF_PATCH_RANGES.imgBandWidth[1],
                        });
                        const widths: [number, number, number, number] = [...patch.imgBandWidth];
                        widths[2] = linked[0] ?? widths[2];
                        widths[3] = linked[1] ?? widths[3];
                        onPatchChange({
                            key: 'imgBandWidth',
                            value: widths,
                            changedParams: [2, 3].flatMap((bandIndex) =>
                                patch.imgBandWidth[bandIndex] === widths[bandIndex] ? [] : [{ bandIndex }]
                            ),
                            isTransient,
                        });
                    }}
                    min={0}
                    max={2}
                    unit=""
                    color={MODULE_COLORS[2]}
                    defaultValue={1}
                />
                <KnobColumn
                    label="Exciter"
                    sublabel="Drive"
                    bypassed={patch.excBypassed}
                    value={patch.excBands[1]?.drive ?? 0.2}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onChange={(value, isTransient) => {
                        const drives = getLinkedBandValues({
                            values: patch.excBands.map((band) => band.drive),
                            representativeIndex: 1,
                            requestedValue: value,
                            min: PROOF_PATCH_RANGES.excBand.drive[0],
                            max: PROOF_PATCH_RANGES.excBand.drive[1],
                        });
                        // A band switched off is a voicing decision — presets
                        // ship exciters with a band deliberately out — so the
                        // macro leaves the switches alone. With every band off
                        // there is no voicing to protect and nothing to hear, so
                        // driving up brings the whole module in.
                        const anyBandEnabled = patch.excBands.some((band) => band.enabled);
                        const bands = patch.excBands.map((band, bandIndex) => {
                            const drive = drives[bandIndex] ?? band.drive;
                            return {
                                ...band,
                                drive,
                                enabled: anyBandEnabled ? band.enabled : drive > 0.01,
                            };
                        });
                        onPatchChange({
                            key: 'excBands',
                            value: bands,
                            changedParams: bands.flatMap((band, bandIndex) => {
                                const previousBand = patch.excBands[bandIndex];
                                const changedParams: Array<{
                                    bandIndex: number;
                                    field: 'drive' | 'enabled';
                                }> = [];
                                if (previousBand?.drive !== band.drive) {
                                    changedParams.push({ bandIndex, field: 'drive' as const });
                                }
                                if (previousBand?.enabled !== band.enabled) {
                                    changedParams.push({ bandIndex, field: 'enabled' as const });
                                }
                                return changedParams;
                            }),
                            isTransient,
                        });
                    }}
                    min={0}
                    max={1}
                    unit=""
                    color={MODULE_COLORS[3]}
                    defaultValue={0}
                />
                <KnobColumn
                    label="Limiter"
                    sublabel="Ceiling"
                    bypassed={patch.limBypassed}
                    value={patch.limCeiling}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onChange={(value, isTransient) => onPatchChange({ key: 'limCeiling', value, isTransient })}
                    min={-12}
                    max={0}
                    unit="dBTP"
                    color={MODULE_COLORS[4]}
                    defaultValue={-1}
                />
            </Row>
        </Stack>
    );
};

// ── Level 3: Build ───────────────────────────────────────────────────────────

const Level3Build = ({
    patch,
    deviceId,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: {
    patch: ProofPatch;
    deviceId: string;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: ProofPatchChange;
}): ReactElement => {
    return (
        <Row align="stretch" grow className="min-h-0 overflow-hidden">
            {/* Module controls — scrollable */}
            <Stack grow gap={3} className="overflow-y-auto py-2">
                <ProofEqSection
                    patch={patch}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onPatchChange={onPatchChange}
                />
                <div className="mx-2 border-t border-border/20" />
                <ProofDynSectionWithMeters
                    patch={patch}
                    deviceId={deviceId}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onPatchChange={onPatchChange}
                />
                <div className="mx-2 border-t border-border/20" />
                <ProofImagerSectionWithMeters
                    patch={patch}
                    deviceId={deviceId}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onPatchChange={onPatchChange}
                />
                <div className="mx-2 border-t border-border/20" />
                <ProofExciterSection
                    patch={patch}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onPatchChange={onPatchChange}
                />
                <div className="mx-2 border-t border-border/20" />
                <ProofLimiterSectionWithMeters
                    patch={patch}
                    deviceId={deviceId}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onPatchChange={onPatchChange}
                />
            </Stack>

            {/* Right: Loudness history + summary */}
            <Level3MeterAside deviceId={deviceId} targetLufs={patch.targetLufs} />
        </Row>
    );
};

type SectionWithMetersProps = {
    patch: ProofPatch;
    deviceId: string;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: ProofPatchChange;
};

const ProofDynSectionWithMeters = ({
    patch,
    deviceId,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: SectionWithMetersProps): ReactElement => {
    // Compared by value: the engine hands the store a fresh gain-reduction array
    // per frame, so identity alone would re-render the whole dynamics section
    // ~62 times a second while the numbers sit still.
    const dynGr = useProofMeter(deviceId, (state) => state.dynGr, areDynGrEqual);

    return (
        <ProofDynSection
            patch={patch}
            dynGr={dynGr}
            gestureOwner={gestureOwner}
            gestureAuthority={gestureAuthority}
            onPatchChange={onPatchChange}
        />
    );
};

const ProofImagerSectionWithMeters = ({
    patch,
    deviceId,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: SectionWithMetersProps): ReactElement => {
    const correlation = useProofMeter(deviceId, (state) => state.correlation);

    return (
        <ProofImagerSection
            patch={patch}
            correlation={correlation}
            gestureOwner={gestureOwner}
            gestureAuthority={gestureAuthority}
            onPatchChange={onPatchChange}
        />
    );
};

const ProofLimiterSectionWithMeters = ({
    patch,
    deviceId,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: SectionWithMetersProps): ReactElement => {
    const limiterGrDb = useProofMeter(deviceId, (state) => state.limiterGrDb);
    const truePeakDb = useProofMeter(deviceId, (state) => state.truePeakDb);

    return (
        <ProofLimiterSection
            patch={patch}
            limiterGrDb={limiterGrDb}
            truePeakDb={truePeakDb}
            gestureOwner={gestureOwner}
            gestureAuthority={gestureAuthority}
            onPatchChange={onPatchChange}
        />
    );
};

const Level3MeterAside = ({ deviceId, targetLufs }: { deviceId: string; targetLufs: number }): ReactElement => {
    const outputLufs = useProofMeter(deviceId, (state) => state.outputLufs);
    const outputStLufs = useProofMeter(deviceId, (state) => state.outputStLufs);
    const integratedLufs = useProofMeter(deviceId, (state) => state.integratedLufs);
    const lra = useProofMeter(deviceId, (state) => state.lra);
    const truePeakDb = useProofMeter(deviceId, (state) => state.truePeakDb);
    const correlation = useProofMeter(deviceId, (state) => state.correlation);
    const samples = useProofLoudnessHistory(deviceId);

    return (
        <Stack gap={2} shrink={false} className="w-[200px] border-l border-border/20 p-2">
            <LoudnessHistory
                samples={samples}
                capacity={PROOF_LOUDNESS_HISTORY_LENGTH}
                targetLufs={targetLufs}
                integratedLufs={integratedLufs}
                width={184}
                height={120}
            />
            <Stack gap={1} className="text-[8px] font-mono">
                <Row align="stretch" justify="between">
                    <span className="text-muted-foreground">Momentary</span>
                    <span className="text-foreground">{formatLufs(outputLufs)} LUFS</span>
                </Row>
                <Row align="stretch" justify="between">
                    <span className="text-muted-foreground">Short-term</span>
                    <span className="text-foreground">{formatLufs(outputStLufs)} LUFS</span>
                </Row>
                <Row align="stretch" justify="between">
                    <span className="text-muted-foreground">Integrated</span>
                    <span className="text-foreground">{formatLufs(integratedLufs)} LUFS</span>
                </Row>
                <Row align="stretch" justify="between">
                    <span className="text-muted-foreground">LRA</span>
                    <span className="text-foreground">{lra.toFixed(1)} LU</span>
                </Row>
                <Row align="stretch" justify="between">
                    <span className="text-muted-foreground">True Peak</span>
                    <span className={truePeakDb > -1 ? 'text-[var(--color-state-danger)]' : 'text-foreground'}>
                        {formatDb(truePeakDb)} dBTP
                    </span>
                </Row>
                <Row align="stretch" justify="between">
                    <span className="text-muted-foreground">Correlation</span>
                    <span className="text-foreground">{correlation.toFixed(2)}</span>
                </Row>
            </Stack>
        </Stack>
    );
};

// ── Level 4: Route ───────────────────────────────────────────────────────────

const Level4Route = ({
    patch,
    deviceId,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
    onChainReorder,
}: {
    patch: ProofPatch;
    deviceId: string;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: ProofPatchChange;
    onChainReorder: (order: ProofPatch['chainOrder']) => void;
}): ReactElement => {
    const moveModule = (fromIdx: number, direction: -1 | 1) => {
        const toIdx = fromIdx + direction;
        if (toIdx < 0 || toIdx >= 5) {
            return;
        }
        const newOrder: [number, number, number, number, number] = [...patch.chainOrder];
        const temp = newOrder[fromIdx]!;
        newOrder[fromIdx] = newOrder[toIdx]!;
        newOrder[toIdx] = temp;
        onChainReorder(newOrder);
    };

    return (
        <Stack grow gap={4} className="px-4 py-3">
            {/* Chain reorder */}
            <div>
                <span
                    id={`${deviceId}-chain-order-label`}
                    className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
                >
                    Signal Chain Order
                </span>
                <Row gap={1} role="group" aria-labelledby={`${deviceId}-chain-order-label`}>
                    <span className="text-[7px] text-muted-foreground">IN</span>
                    <div className="w-4 h-px bg-border/30" />
                    {patch.chainOrder.map((moduleIdx, slot) => {
                        const moduleLabel = MODULE_LABELS[moduleIdx] ?? 'module';
                        return (
                            <Row gap={1} key={moduleIdx}>
                                <Stack
                                    align="center"
                                    gap={0.5}
                                    className="px-2 py-1.5 rounded bg-surface-base/80 border border-border/30"
                                >
                                    <span className="text-[9px] font-bold" style={{ color: MODULE_COLORS[moduleIdx] }}>
                                        {moduleLabel}
                                    </span>
                                    <Row align="stretch" gap={0.5}>
                                        <Button
                                            variant="bare"
                                            size="bare"
                                            type="button"
                                            className="text-[8px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
                                            onClick={() => moveModule(slot, -1)}
                                            disabled={slot === 0}
                                            aria-label={`Move ${moduleLabel} earlier in the chain`}
                                        >
                                            ←
                                        </Button>
                                        <Button
                                            variant="bare"
                                            size="bare"
                                            type="button"
                                            className="text-[8px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
                                            onClick={() => moveModule(slot, 1)}
                                            disabled={slot === 4}
                                            aria-label={`Move ${moduleLabel} later in the chain`}
                                        >
                                            →
                                        </Button>
                                    </Row>
                                </Stack>
                                {slot < 4 ? <div className="w-4 h-px bg-border/30" /> : null}
                            </Row>
                        );
                    })}
                    <div className="w-4 h-px bg-border/30" />
                    <span className="text-[7px] text-muted-foreground">OUT</span>
                </Row>
                <span className="sr-only" role="status" aria-live="polite">
                    {`Signal chain order: ${patch.chainOrder
                        .map((moduleIdx) => MODULE_LABELS[moduleIdx] ?? 'module')
                        .join(', ')}`}
                </span>
            </div>

            {/* Latency info */}
            <ProofLatencyReadout deviceId={deviceId} />

            {/* Input/Output gain */}
            <Row align="stretch" gap={8}>
                <Stack align="center" gap={1}>
                    <span className="text-[8px] text-muted-foreground">Input Gain</span>
                    <RotaryKnob
                        value={patch.inputGain}
                        aria-label="Input gain"
                        onChange={(value, isTransient) => onPatchChange({ key: 'inputGain', value, isTransient })}
                        gestureOwner={gestureOwner}
                        min={-24}
                        max={24}
                        step={0.5}
                        defaultValue={0}
                        size="md"
                        tone="cyan"
                        gestureAuthority={gestureAuthority}
                    />
                    <span className="text-[7px] text-muted-foreground font-mono">
                        {patch.inputGain > 0 ? '+' : ''}
                        {patch.inputGain.toFixed(1)} dB
                    </span>
                </Stack>
                <Stack align="center" gap={1}>
                    <span className="text-[8px] text-muted-foreground">Output Gain</span>
                    <RotaryKnob
                        value={patch.outputGain}
                        aria-label="Output gain"
                        onChange={(value, isTransient) => onPatchChange({ key: 'outputGain', value, isTransient })}
                        gestureOwner={gestureOwner}
                        min={-24}
                        max={24}
                        step={0.5}
                        defaultValue={0}
                        size="md"
                        tone="cyan"
                        gestureAuthority={gestureAuthority}
                    />
                    <span className="text-[7px] text-muted-foreground font-mono">
                        {patch.outputGain > 0 ? '+' : ''}
                        {patch.outputGain.toFixed(1)} dB
                    </span>
                </Stack>
            </Row>
        </Stack>
    );
};

const ProofLatencyReadout = ({ deviceId }: { deviceId: string }): ReactElement => {
    const latency = useProofMeter(deviceId, (state) => state.latency);

    return (
        <Row gap={4} className="text-[8px] text-muted-foreground">
            <span>
                Reported latency: <span className="text-foreground font-mono">{latency} samples</span>
                {latency > 0 ? ` (${((latency / getAudioSampleRate()) * 1000).toFixed(1)}ms)` : ''}
            </span>
        </Row>
    );
};

// ── Level 5: Lab ─────────────────────────────────────────────────────────────

const Level5Lab = ({ patch, deviceId }: { patch: ProofPatch; deviceId: string }): ReactElement => {
    const targetLufs = patch.targetLufs;
    const { status, fftData, fftVersion, sampleRate, fftSize } = useProofAnalyser();

    return (
        <Row align="stretch" grow className="min-h-0 overflow-hidden">
            {/* Left: Advanced metering dashboard */}
            <Stack grow gap={3} className="overflow-y-auto py-2 px-3">
                {/* Loudness history */}
                <div>
                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">
                        Loudness History
                    </span>
                    <Level5LoudnessHistory deviceId={deviceId} targetLufs={targetLufs} />
                </div>

                {/* Tonal balance vs Harman target */}
                <div>
                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">
                        Tonal Balance
                    </span>
                    <TonalBalance
                        status={status}
                        fftData={fftData}
                        fftVersion={fftVersion}
                        sampleRate={sampleRate}
                        fftSize={fftSize}
                        genre={patch.target === 'club' ? 'edm' : undefined}
                        width={400}
                        height={120}
                    />
                </div>

                {/* Full metering grid */}
                <Level5MeterGrid deviceId={deviceId} />

                {/* Platform normalization info */}
                <Level5NormalizationAlert deviceId={deviceId} patch={patch} />

                {/* Reset integrated button */}
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    className="text-[8px] text-muted-foreground hover:text-foreground border border-border/30 px-2 py-1 rounded cursor-pointer"
                    onClick={() => resetIntegratedMeters(deviceId)}
                >
                    Reset Integrated LUFS + True Peak
                </Button>
            </Stack>
            {/* Right: Input vs Output comparison */}
            <Level5GainComparison deviceId={deviceId} />
        </Row>
    );
};

const Level5LoudnessHistory = ({ deviceId, targetLufs }: { deviceId: string; targetLufs: number }): ReactElement => {
    const integratedLufs = useProofMeter(deviceId, (state) => state.integratedLufs);
    const samples = useProofLoudnessHistory(deviceId);

    return (
        <LoudnessHistory
            samples={samples}
            capacity={PROOF_LOUDNESS_HISTORY_LENGTH}
            targetLufs={targetLufs}
            integratedLufs={integratedLufs}
            width={400}
            height={140}
        />
    );
};

const Level5MeterGrid = ({ deviceId }: { deviceId: string }): ReactElement => {
    const outputLufs = useProofMeter(deviceId, (state) => state.outputLufs);
    const outputStLufs = useProofMeter(deviceId, (state) => state.outputStLufs);
    const integratedLufs = useProofMeter(deviceId, (state) => state.integratedLufs);
    const truePeakDb = useProofMeter(deviceId, (state) => state.truePeakDb);
    const lra = useProofMeter(deviceId, (state) => state.lra);
    const correlation = useProofMeter(deviceId, (state) => state.correlation);

    return (
        <Grid cols={3} gap={3}>
            <MeterCard label="Momentary LUFS" value={formatLufs(outputLufs)} unit="LUFS" />
            <MeterCard label="Short-term LUFS" value={formatLufs(outputStLufs)} unit="LUFS" />
            <MeterCard label="Integrated LUFS" value={formatLufs(integratedLufs)} unit="LUFS" />
            <MeterCard label="True Peak" value={formatDb(truePeakDb)} unit="dBTP" alert={truePeakDb > -1} />
            <MeterCard label="LRA" value={lra.toFixed(1)} unit="LU" />
            <MeterCard label="Correlation" value={correlation.toFixed(2)} unit="" alert={correlation < 0.3} />
        </Grid>
    );
};

const Level5NormalizationAlert = ({
    deviceId,
    patch,
}: {
    deviceId: string;
    patch: ProofPatch;
}): ReactElement | null => {
    const integratedLufs = useProofMeter(deviceId, (state) => state.integratedLufs);
    const alert = getProofLoudnessAlert({
        target: patch.target,
        targetLufs: patch.targetLufs,
        integratedLufs,
    });

    if (!alert) {
        return null;
    }

    return (
        <div
            role="alert"
            aria-live="polite"
            className="px-3 py-2 rounded bg-[var(--color-accent-peach)]/10 border border-[var(--color-accent-peach)]/20 text-[9px] text-[var(--color-accent-peach)]"
        >
            {`${alert.message} ${alert.advice}`}
        </div>
    );
};

const Level5GainComparison = ({ deviceId }: { deviceId: string }): ReactElement => {
    const inputLufs = useProofMeter(deviceId, (state) => state.inputLufs);
    const outputLufs = useProofMeter(deviceId, (state) => state.outputLufs);

    return (
        <Stack justify="center" gap={2} shrink={false} className="w-[160px] border-l border-border/20 p-2">
            <div className="text-center">
                <span className="text-[7px] text-muted-foreground uppercase tracking-wider block mb-1">Input</span>
                <span className="text-lg font-mono text-foreground">{formatLufs(inputLufs)}</span>
                <span className="text-[7px] text-muted-foreground block">LUFS</span>
            </div>
            <div className="w-full h-px bg-border/20" />
            <div className="text-center">
                <span className="text-[7px] text-muted-foreground uppercase tracking-wider block mb-1">Output</span>
                <span className="text-lg font-mono text-foreground">{formatLufs(outputLufs)}</span>
                <span className="text-[7px] text-muted-foreground block">LUFS</span>
            </div>
            <div className="w-full h-px bg-border/20" />
            <div className="text-center">
                <span className="text-[7px] text-muted-foreground uppercase tracking-wider block mb-1">
                    Gain Applied
                </span>
                <span className="text-sm font-mono text-foreground">
                    {outputLufs > -100 && inputLufs > -100
                        ? `${outputLufs - inputLufs > 0 ? '+' : ''}${(outputLufs - inputLufs).toFixed(1)}`
                        : '—'}
                </span>
                <span className="text-[7px] text-muted-foreground block">dB</span>
            </div>
        </Stack>
    );
};

const MeterCard = ({
    label,
    value,
    unit,
    alert,
}: {
    label: string;
    value: string;
    unit: string;
    alert?: boolean;
}): ReactElement => (
    <div
        className="daw-readout-well rounded px-2 py-1.5"
        style={{
            border: alert ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(0,0,0,0.4)',
            borderBottom: alert ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(40,40,40,0.3)',
        }}
        role={alert ? 'alert' : undefined}
        aria-live={alert ? 'polite' : undefined}
        aria-label={alert ? `${label} out of range: ${value} ${unit}`.trim() : undefined}
    >
        <span className="text-[7px] text-muted-foreground block">{label}</span>
        <span className={`text-sm font-mono ${alert ? 'text-[var(--color-state-danger)]' : 'text-foreground'}`}>
            {value}
        </span>
        {unit ? <span className="text-[7px] text-muted-foreground ml-1">{unit}</span> : null}
    </div>
);

// ── Shared sub-components ────────────────────────────────────────────────────

const MiniMeter = ({ peakL, peakR, label }: { peakL: number; peakR: number; label?: string }): ReactElement => {
    const height = 24;
    const normalize = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));
    const hL = normalize(peakL) * height;
    const hR = normalize(peakR) * height;
    const meterName = label ? `${label} peak` : 'Tap peak';
    const clampDb = (db: number) => Math.round(Math.max(-60, Math.min(0, db)));

    return (
        <Stack align="center" gap={0.5}>
            {label ? <span className="text-[6px] text-muted-foreground/50">{label}</span> : null}
            <Row align="stretch" className="gap-px">
                <div
                    className="w-1 bg-surface-inset rounded-sm overflow-hidden"
                    style={{ height }}
                    role="meter"
                    aria-label={`${meterName} left`}
                    aria-valuemin={-60}
                    aria-valuemax={0}
                    aria-valuenow={clampDb(peakL)}
                    aria-valuetext={`${clampDb(peakL)} dB`}
                >
                    <div
                        className="w-full bg-[var(--color-accent-mint)] rounded-sm transition-all duration-75"
                        style={{ height: hL, marginTop: height - hL }}
                    />
                </div>
                <div
                    className="w-1 bg-surface-inset rounded-sm overflow-hidden"
                    style={{ height }}
                    role="meter"
                    aria-label={`${meterName} right`}
                    aria-valuemin={-60}
                    aria-valuemax={0}
                    aria-valuenow={clampDb(peakR)}
                    aria-valuetext={`${clampDb(peakR)} dB`}
                >
                    <div
                        className="w-full bg-[var(--color-accent-mint)] rounded-sm transition-all duration-75"
                        style={{ height: hR, marginTop: height - hR }}
                    />
                </div>
            </Row>
        </Stack>
    );
};

const KnobColumn = ({
    label,
    sublabel,
    bypassed,
    value,
    onChange,
    gestureOwner,
    gestureAuthority,
    min,
    max,
    unit,
    color,
    defaultValue,
}: {
    label: string;
    sublabel: string;
    bypassed: boolean;
    value: number;
    onChange: (value: number, isTransient?: boolean) => void;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    min: number;
    max: number;
    unit: string;
    color: string;
    defaultValue: number;
}): ReactElement => (
    <div className={`flex flex-col items-center gap-1 ${bypassed ? 'opacity-30' : ''}`}>
        <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color }}>
            {label}
        </span>
        <RotaryKnob
            value={value}
            aria-label={`${label} ${sublabel}`}
            onChange={onChange}
            gestureOwner={gestureOwner}
            gestureAuthority={gestureAuthority}
            min={min}
            max={max}
            step={0.1}
            defaultValue={defaultValue}
            size="md"
            tone="cyan"
        />
        <span className="text-[7px] text-muted-foreground">{sublabel}</span>
        <span className="text-[7px] text-muted-foreground/50 font-mono">
            {value.toFixed(1)}
            {unit ? ` ${unit}` : ''}
        </span>
    </div>
);
