import { type ReactElement } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginChoiceRow } from '#/components/daw/DawPluginChoiceRow';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricStrip } from '#/components/daw/DawPluginMetricStrip';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginRail } from '#/components/daw/DawPluginRail';
import { DawPluginReadoutList } from '#/components/daw/DawPluginReadoutList';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { useStore } from '#/infra/store/useStore';
import { getAudioSampleRate } from '#/modules/AudioEngine/useCases';

import { TARGET_LUFS, type ProofPatchEdit, type ProofTarget } from '../../models/ProofPatch';
import { proofStore, setProofUiLevel, setProofAbBypass, getProofState, type ProofState } from '../../stores/proofStore';
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const MODULE_LABELS = ['EQ', 'Dynamics', 'Imager', 'Exciter', 'Limiter'] as const;
const MODULE_COLORS = [
    'var(--color-accent-cyan)',
    'var(--color-accent-peach)',
    'var(--color-accent-mint)',
    'var(--color-accent-lavender)',
    'var(--color-state-danger)',
] as const;

const TARGET_OPTIONS: { value: ProofTarget; label: string; lufs: number }[] = [
    { value: 'streaming', label: 'Streaming', lufs: -14 },
    { value: 'cd', label: 'CD', lufs: -9 },
    { value: 'club', label: 'Club / DJ', lufs: -6 },
    { value: 'broadcast', label: 'Broadcast', lufs: -23 },
    { value: 'podcast', label: 'Podcast', lufs: -16 },
];

const LEVEL_OPTIONS = [
    { level: 1 as const, label: 'Play', detail: 'Target' },
    { level: 2 as const, label: 'Shape', detail: 'Tone' },
    { level: 3 as const, label: 'Build', detail: 'Modules' },
    { level: 4 as const, label: 'Route', detail: 'Chain' },
    { level: 5 as const, label: 'Lab', detail: 'Check' },
];

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
        className="proof-window"
        title={title}
        detail={detail}
        titleClassName="text-[var(--color-accent-mint)]/70"
    >
        {children}
    </DawPluginSectionCard>
);

function renderLevel(state: ProofState, deviceId: string): ReactElement {
    if (state.uiLevel === 1) {
        return <Level1Play state={state} deviceId={deviceId} />;
    }

    if (state.uiLevel === 2) {
        return <Level2Shape state={state} deviceId={deviceId} />;
    }

    if (state.uiLevel === 3) {
        return <Level3Build state={state} deviceId={deviceId} />;
    }

    if (state.uiLevel === 4) {
        return <Level4Route state={state} deviceId={deviceId} />;
    }

    return <Level5Lab state={state} deviceId={deviceId} />;
}

function isModuleBypassed(state: ProofState, moduleIndex: number): boolean {
    if (moduleIndex === 0) {
        return state.patch.eqBypassed;
    }

    if (moduleIndex === 1) {
        return state.patch.dynBypassed;
    }

    if (moduleIndex === 2) {
        return state.patch.imgBypassed;
    }

    if (moduleIndex === 3) {
        return state.patch.excBypassed;
    }

    return state.patch.limBypassed;
}

// ── Component ────────────────────────────────────────────────────────────────

export const ProofPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const allInstances = useStore(proofStore, {});
    const state: ProofState = allInstances?.[deviceId] ?? getProofState(deviceId);

    const { patch, uiLevel } = state;
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
                        <div className="space-y-2">
                            <div className="space-y-1">
                                <div className="text-[10px] font-medium text-foreground">Presets</div>
                                <div className="flex min-h-0 flex-col gap-1">
                                    {PROOF_PRESETS.map((preset) => {
                                        const active = patch.presetId === preset.id;
                                        return (
                                            <DawPluginChoiceRow
                                                key={preset.id}
                                                className="proof-window"
                                                active={active}
                                                title={preset.name}
                                                subtitle={`${preset.patch.target} · ${formatLufs(preset.patch.targetLufs)} LUFS`}
                                                onPress={() =>
                                                    loadProofPatchWithAudio({ deviceId, patch: preset.patch })
                                                }
                                            />
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-1">
                                <div className="text-[10px] font-medium text-foreground">Targets</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {TARGET_OPTIONS.map((option) => {
                                        const active = patch.target === option.value;
                                        return (
                                            <DawPluginChip
                                                key={option.value}
                                                active={active}
                                                tone="mint"
                                                size="sm"
                                                onClick={() => {
                                                    setProofTarget({
                                                        deviceId,
                                                        target: option.value,
                                                        targetLufs: option.lufs,
                                                    });
                                                }}
                                            >
                                                {option.label}
                                            </DawPluginChip>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-1">
                                <div className="text-[10px] font-medium text-foreground">Desk depth</div>
                                <div className="flex flex-col gap-1">
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
                                </div>
                            </div>
                        </div>
                    </SideCard>
                </DawPluginRail>

                <section className="flex min-h-0 min-w-0 flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-mint)]/70">
                                Mastering desk
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">{levelMeta.title}</div>
                            <span className="sr-only">{levelMeta.description}</span>
                        </div>

                        <DawPluginMetricStrip>
                            <DawPluginMetricTile
                                className="proof-window"
                                label="In"
                                value={`${formatLufs(state.inputLufs)} LUFS`}
                                detail="Incoming loudness"
                            />
                            <DawPluginMetricTile
                                className="proof-window"
                                label="Out"
                                value={`${formatLufs(state.outputLufs)} LUFS`}
                                detail="Current output"
                            />
                            <DawPluginMetricTile
                                className="proof-window"
                                label="Peak"
                                value={`${formatDb(state.truePeakDb)} dBTP`}
                                detail="True peak ceiling"
                            />
                            <DawPluginMetricTile
                                className="proof-window"
                                label="LRA"
                                value={`${state.lra.toFixed(1)} LU`}
                                detail="Loudness range"
                            />
                        </DawPluginMetricStrip>
                    </div>

                    <div className="proof-window min-h-0 flex-1 overflow-auto p-3">{renderLevel(state, deviceId)}</div>
                </section>

                <DawPluginRail>
                    <SideCard title="Quick read" detail="Keep the mission, the chain, and the compare switch in reach.">
                        <DawPluginReadoutList>
                            <DawReadoutRow label="Preset" value={patch.name} valueClassName="text-foreground/85" />
                            <DawReadoutRow label="Target" value={targetLabel} valueClassName="text-foreground/85" />
                            <DawReadoutRow
                                label="Integrated"
                                value={`${formatLufs(state.integratedLufs)} LUFS`}
                                valueClassName="text-foreground/85"
                            />
                            <DawReadoutRow
                                label="Correlation"
                                value={state.correlation.toFixed(2)}
                                valueClassName="text-foreground/85"
                            />
                            <DawReadoutRow
                                label="Limiter GR"
                                value={`${Math.abs(state.limiterGrDb).toFixed(1)} dB`}
                                valueClassName="text-foreground/85"
                            />
                        </DawPluginReadoutList>
                    </SideCard>

                    <SideCard
                        title="Chain"
                        detail="The mastering stations stay visible even when you dive into one deck."
                    >
                        <div className="flex flex-col gap-1.5">
                            {patch.chainOrder.map((moduleIndex, slot) => {
                                const label = MODULE_LABELS[moduleIndex] ?? '?';
                                const bypassed = isModuleBypassed(state, moduleIndex);
                                return (
                                    <DawPluginChoiceRow
                                        key={`${moduleIndex}-${slot}`}
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
                        </div>
                    </SideCard>

                    <SideCard title="Check" detail="Compare and reset without hunting through the deck.">
                        <div className="flex flex-col gap-2">
                            <DawPluginChip
                                active={state.abBypass}
                                tone="mint"
                                size="sm"
                                onClick={() => {
                                    const next = !state.abBypass;
                                    setProofParam({ deviceId, name: 'ab_bypass', value: next ? 1 : 0 });
                                    setProofAbBypass({ deviceId, abBypass: next });
                                }}
                            >
                                {state.abBypass ? 'A / dry' : 'B / wet'}
                            </DawPluginChip>
                            <DawPluginChip
                                type="button"
                                tone="mint"
                                size="sm"
                                onClick={() => resetIntegratedMeters(deviceId)}
                            >
                                Reset loudness
                            </DawPluginChip>
                            <div className="flex flex-col items-center gap-1 pt-1">
                                <RotaryKnob
                                    value={patch.limCeiling}
                                    onChange={(value, isTransient) =>
                                        setProofParamWithPatch({
                                            deviceId,
                                            key: 'limCeiling',
                                            value,
                                            isTransient,
                                        })
                                    }
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
                            </div>
                        </div>
                    </SideCard>
                </DawPluginRail>
            </div>
        </div>
    );
};

// ── Level 1: Play ────────────────────────────────────────────────────────────

const Level1Play = ({ state, deviceId }: { state: ProofState; deviceId: string }): ReactElement => {
    const { patch } = state;

    return (
        <div className="flex-1 flex items-center justify-center gap-12 px-8">
            {/* Target selector */}
            <div className="flex flex-col items-center gap-2">
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Target</span>
                <div className="flex flex-col gap-1">
                    {TARGET_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            className={`px-3 py-1 rounded text-[9px] font-medium transition-colors cursor-pointer ${
                                patch.target === opt.value
                                    ? 'bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)] border border-[var(--color-accent-mint)]/30'
                                    : 'text-muted-foreground hover:text-foreground border border-transparent hover:border-border/30'
                            }`}
                            onClick={() => {
                                setProofTarget({ deviceId, target: opt.value, targetLufs: opt.lufs });
                            }}
                        >
                            {opt.label} ({opt.lufs} LUFS)
                        </button>
                    ))}
                </div>
            </div>

            {/* Big LUFS meters */}
            <div className="flex flex-col items-center gap-3">
                <div className="flex gap-8">
                    <div className="flex flex-col items-center">
                        <span className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1">Input</span>
                        <span className="text-2xl font-mono text-foreground tabular-nums">
                            {formatLufs(state.inputLufs)}
                        </span>
                        <span className="text-[8px] text-muted-foreground">LUFS</span>
                    </div>
                    <div className="w-px h-16 bg-border/20 self-center" />
                    <div className="flex flex-col items-center">
                        <span className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1">Output</span>
                        <span className="text-2xl font-mono text-foreground tabular-nums">
                            {formatLufs(state.outputLufs)}
                        </span>
                        <span className="text-[8px] text-muted-foreground">LUFS</span>
                    </div>
                </div>
                <div className="flex gap-4 text-[8px] text-muted-foreground font-mono">
                    <span>Integrated: {formatLufs(state.integratedLufs)}</span>
                    <span>Short-term: {formatLufs(state.outputStLufs)}</span>
                    <span>Correlation: {state.correlation.toFixed(2)}</span>
                </div>

                {/* Streaming warning */}
                {state.integratedLufs > -100 && state.integratedLufs > (TARGET_LUFS[patch.target] ?? -14) + 1 ? (
                    <div
                        role="alert"
                        aria-live="polite"
                        className="px-3 py-1.5 rounded bg-[var(--color-accent-peach)]/10 border border-[var(--color-accent-peach)]/20 text-[9px] text-[var(--color-accent-peach)] max-w-xs text-center"
                    >
                        Your master at {formatLufs(state.integratedLufs)} LUFS will be turned down by{' '}
                        {(state.integratedLufs - (TARGET_LUFS[patch.target] ?? -14)).toFixed(1)} dB on streaming
                        platforms.
                    </div>
                ) : null}
            </div>

            {/* Ceiling knob */}
            <div className="flex flex-col items-center gap-1">
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Ceiling</span>
                <RotaryKnob
                    value={patch.limCeiling}
                    onChange={(value, isTransient) =>
                        setProofParamWithPatch({ deviceId, key: 'limCeiling', value, isTransient })
                    }
                    min={-12}
                    max={0}
                    step={0.1}
                    defaultValue={-1}
                    size="lg"
                    tone="cyan"
                />
                <span className="text-[8px] text-muted-foreground font-mono">{patch.limCeiling.toFixed(1)} dBTP</span>
            </div>
        </div>
    );
};

// ── Level 2: Shape ───────────────────────────────────────────────────────────

const Level2Shape = ({ state, deviceId }: { state: ProofState; deviceId: string }): ReactElement => {
    const { patch } = state;
    const bypasses = [patch.eqBypassed, patch.dynBypassed, patch.imgBypassed, patch.excBypassed, patch.limBypassed];
    const bypassKeys = ['eqBypassed', 'dynBypassed', 'imgBypassed', 'excBypassed', 'limBypassed'] as const;

    return (
        <div className="flex-1 flex flex-col px-3 py-2 gap-2">
            {/* Signal chain strip with inline meters */}
            <div className="flex items-center gap-1">
                {/* Input meter */}
                <MiniMeter
                    peakL={state.tapPeaks[0]?.peakL ?? -100}
                    peakR={state.tapPeaks[0]?.peakR ?? -100}
                    label="IN"
                />

                {patch.chainOrder.map((moduleIdx, slot) => {
                    const bypassed = bypasses[moduleIdx] ?? false;
                    const color = MODULE_COLORS[moduleIdx] ?? 'var(--color-accent-cyan)';
                    const label = MODULE_LABELS[moduleIdx] ?? '?';
                    const tapIdx = slot + 1;

                    return (
                        <div key={`${moduleIdx}-${slot}`} className="flex items-center gap-1">
                            <div className="w-4 h-px bg-border/30" />
                            <button
                                type="button"
                                className={`px-2 py-1 rounded text-[8px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                                    bypassed
                                        ? 'opacity-30 text-muted-foreground border border-border/20'
                                        : `border border-current/20`
                                }`}
                                style={{ color: bypassed ? undefined : color }}
                                onClick={() =>
                                    setProofParamWithPatch({ deviceId, key: bypassKeys[moduleIdx]!, value: !bypassed })
                                }
                            >
                                {label}
                            </button>
                            <div className="w-4 h-px bg-border/30" />
                            <MiniMeter
                                peakL={state.tapPeaks[tapIdx]?.peakL ?? -100}
                                peakR={state.tapPeaks[tapIdx]?.peakR ?? -100}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Primary knobs per module */}
            <div className="flex items-start justify-around flex-1 pt-2">
                <KnobColumn
                    label="Dynamics"
                    sublabel="Threshold"
                    bypassed={patch.dynBypassed}
                    value={patch.dynBands[0]?.threshold ?? -20}
                    onChange={(value, isTransient) => {
                        const bands = patch.dynBands.map((band) => ({ ...band, threshold: value }));
                        setProofParamWithPatch({
                            deviceId,
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
                    onChange={(value, isTransient) => {
                        const widths: [number, number, number, number] = [...patch.imgBandWidth];
                        widths[2] = value;
                        widths[3] = value;
                        setProofParamWithPatch({
                            deviceId,
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
                    onChange={(value, isTransient) => {
                        const bands = patch.excBands.map((b) => ({
                            ...b,
                            drive: value,
                            enabled: value > 0.01,
                        }));
                        setProofParamWithPatch({
                            deviceId,
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
                    onChange={(value, isTransient) =>
                        setProofParamWithPatch({ deviceId, key: 'limCeiling', value, isTransient })
                    }
                    min={-12}
                    max={0}
                    unit="dBTP"
                    color={MODULE_COLORS[4]}
                    defaultValue={-1}
                />
            </div>
        </div>
    );
};

// ── Level 3: Build ───────────────────────────────────────────────────────────

function applyLevel3Patch(deviceId: string, edit: ProofPatchEdit): void {
    setProofParamWithPatch({ deviceId, ...edit });
}

const Level3Build = ({ state, deviceId }: { state: ProofState; deviceId: string }): ReactElement => {
    const { patch } = state;

    return (
        <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Module controls — scrollable */}
            <div className="flex-1 overflow-y-auto py-2 space-y-3">
                <ProofEqSection
                    patch={patch}
                    onPatchChange={(changedPatch) => applyLevel3Patch(deviceId, changedPatch)}
                />
                <div className="mx-2 border-t border-border/20" />
                <ProofDynSection
                    patch={patch}
                    dynGr={state.dynGr}
                    onPatchChange={(changedPatch) => applyLevel3Patch(deviceId, changedPatch)}
                />
                <div className="mx-2 border-t border-border/20" />
                <ProofImagerSection
                    patch={patch}
                    correlation={state.correlation}
                    onPatchChange={(changedPatch) => applyLevel3Patch(deviceId, changedPatch)}
                />
                <div className="mx-2 border-t border-border/20" />
                <ProofExciterSection
                    patch={patch}
                    onPatchChange={(changedPatch) => applyLevel3Patch(deviceId, changedPatch)}
                />
                <div className="mx-2 border-t border-border/20" />
                <ProofLimiterSection
                    patch={patch}
                    limiterGrDb={state.limiterGrDb}
                    truePeakDb={state.truePeakDb}
                    onPatchChange={(changedPatch) => applyLevel3Patch(deviceId, changedPatch)}
                />
            </div>

            {/* Right: Loudness history + summary */}
            <div className="w-[200px] shrink-0 border-l border-border/20 flex flex-col gap-2 p-2">
                <LoudnessHistory
                    momentaryLufs={state.outputLufs}
                    targetLufs={TARGET_LUFS[patch.target] ?? -14}
                    integratedLufs={state.integratedLufs}
                    width={184}
                    height={120}
                />
                <div className="space-y-1 text-[8px] font-mono">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Momentary</span>
                        <span className="text-foreground">{formatLufs(state.outputLufs)} LUFS</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Short-term</span>
                        <span className="text-foreground">{formatLufs(state.outputStLufs)} LUFS</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Integrated</span>
                        <span className="text-foreground">{formatLufs(state.integratedLufs)} LUFS</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">LRA</span>
                        <span className="text-foreground">{state.lra.toFixed(1)} LU</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">True Peak</span>
                        <span
                            className={state.truePeakDb > -1 ? 'text-[var(--color-state-danger)]' : 'text-foreground'}
                        >
                            {formatDb(state.truePeakDb)} dBTP
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Correlation</span>
                        <span className="text-foreground">{state.correlation.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Level 4: Route ───────────────────────────────────────────────────────────

const Level4Route = ({ state, deviceId }: { state: ProofState; deviceId: string }): ReactElement => {
    const { patch } = state;

    const moveModule = (fromIdx: number, direction: -1 | 1) => {
        const toIdx = fromIdx + direction;
        if (toIdx < 0 || toIdx >= 5) {
            return;
        }
        const newOrder: [number, number, number, number, number] = [...patch.chainOrder];
        const temp = newOrder[fromIdx]!;
        newOrder[fromIdx] = newOrder[toIdx]!;
        newOrder[toIdx] = temp;
        reorderChain({ deviceId, order: newOrder });
    };

    return (
        <div className="flex-1 flex flex-col px-4 py-3 gap-4">
            {/* Chain reorder */}
            <div>
                <span
                    id={`${deviceId}-chain-order-label`}
                    className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block"
                >
                    Signal Chain Order
                </span>
                <div className="flex items-center gap-1" role="group" aria-labelledby={`${deviceId}-chain-order-label`}>
                    <span className="text-[7px] text-muted-foreground">IN</span>
                    <div className="w-4 h-px bg-border/30" />
                    {patch.chainOrder.map((moduleIdx, slot) => {
                        const moduleLabel = MODULE_LABELS[moduleIdx] ?? 'module';
                        return (
                            <div key={slot} className="flex items-center gap-1">
                                <div className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded bg-surface-base/80 border border-border/30">
                                    <span className="text-[9px] font-bold" style={{ color: MODULE_COLORS[moduleIdx] }}>
                                        {moduleLabel}
                                    </span>
                                    <div className="flex gap-0.5">
                                        <button
                                            type="button"
                                            className="text-[8px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
                                            onClick={() => moveModule(slot, -1)}
                                            disabled={slot === 0}
                                            aria-label={`Move ${moduleLabel} earlier in the chain`}
                                        >
                                            ←
                                        </button>
                                        <button
                                            type="button"
                                            className="text-[8px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
                                            onClick={() => moveModule(slot, 1)}
                                            disabled={slot === 4}
                                            aria-label={`Move ${moduleLabel} later in the chain`}
                                        >
                                            →
                                        </button>
                                    </div>
                                </div>
                                {slot < 4 ? <div className="w-4 h-px bg-border/30" /> : null}
                            </div>
                        );
                    })}
                    <div className="w-4 h-px bg-border/30" />
                    <span className="text-[7px] text-muted-foreground">OUT</span>
                </div>
                <span className="sr-only" role="status" aria-live="polite">
                    {`Signal chain order: ${patch.chainOrder
                        .map((moduleIdx) => MODULE_LABELS[moduleIdx] ?? 'module')
                        .join(', ')}`}
                </span>
            </div>

            {/* Latency info */}
            <div className="flex items-center gap-4 text-[8px] text-muted-foreground">
                <span>
                    Reported latency: <span className="text-foreground font-mono">{state.latency} samples</span>
                    {state.latency > 0 ? ` (${((state.latency / getAudioSampleRate()) * 1000).toFixed(1)}ms)` : ''}
                </span>
            </div>

            {/* Input/Output gain */}
            <div className="flex gap-8">
                <div className="flex flex-col items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">Input Gain</span>
                    <RotaryKnob
                        value={patch.inputGain}
                        onChange={(value, isTransient) =>
                            setProofParamWithPatch({ deviceId, key: 'inputGain', value, isTransient })
                        }
                        min={-24}
                        max={24}
                        step={0.5}
                        defaultValue={0}
                        size="md"
                        tone="cyan"
                    />
                    <span className="text-[7px] text-muted-foreground font-mono">
                        {patch.inputGain > 0 ? '+' : ''}
                        {patch.inputGain.toFixed(1)} dB
                    </span>
                </div>
                <div className="flex flex-col items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">Output Gain</span>
                    <RotaryKnob
                        value={patch.outputGain}
                        onChange={(value, isTransient) =>
                            setProofParamWithPatch({ deviceId, key: 'outputGain', value, isTransient })
                        }
                        min={-24}
                        max={24}
                        step={0.5}
                        defaultValue={0}
                        size="md"
                        tone="cyan"
                    />
                    <span className="text-[7px] text-muted-foreground font-mono">
                        {patch.outputGain > 0 ? '+' : ''}
                        {patch.outputGain.toFixed(1)} dB
                    </span>
                </div>
            </div>
        </div>
    );
};

// ── Level 5: Lab ─────────────────────────────────────────────────────────────

const Level5Lab = ({ state, deviceId }: { state: ProofState; deviceId: string }): ReactElement => {
    const { patch } = state;
    const targetLufs = TARGET_LUFS[patch.target] ?? -14;
    const delta = state.integratedLufs > -100 ? state.integratedLufs - targetLufs : 0;
    const { fftData, fftVersion, sampleRate, fftSize } = useProofAnalyser();

    let platformNormalizationTarget = ` ${patch.target}`;
    if (patch.target === 'streaming') {
        platformNormalizationTarget = ' Spotify, Apple Music, and YouTube';
    } else if (patch.target === 'broadcast') {
        platformNormalizationTarget = ' broadcast television';
    }

    return (
        <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left: Advanced metering dashboard */}
            <div className="flex-1 overflow-y-auto py-2 px-3 space-y-3">
                {/* Loudness history */}
                <div>
                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">
                        Loudness History
                    </span>
                    <LoudnessHistory
                        momentaryLufs={state.outputLufs}
                        targetLufs={targetLufs}
                        integratedLufs={state.integratedLufs}
                        width={400}
                        height={140}
                    />
                </div>

                {/* Tonal balance vs Harman target */}
                <div>
                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">
                        Tonal Balance
                    </span>
                    <TonalBalance
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
                <div className="grid grid-cols-3 gap-3">
                    <MeterCard label="Momentary LUFS" value={formatLufs(state.outputLufs)} unit="LUFS" />
                    <MeterCard label="Short-term LUFS" value={formatLufs(state.outputStLufs)} unit="LUFS" />
                    <MeterCard label="Integrated LUFS" value={formatLufs(state.integratedLufs)} unit="LUFS" />
                    <MeterCard
                        label="True Peak"
                        value={formatDb(state.truePeakDb)}
                        unit="dBTP"
                        alert={state.truePeakDb > -1}
                    />
                    <MeterCard label="LRA" value={state.lra.toFixed(1)} unit="LU" />
                    <MeterCard
                        label="Correlation"
                        value={state.correlation.toFixed(2)}
                        unit=""
                        alert={state.correlation < 0.3}
                    />
                </div>

                {/* Platform normalization info */}
                {delta > 1 ? (
                    <div
                        role="alert"
                        aria-live="polite"
                        className="px-3 py-2 rounded bg-[var(--color-accent-peach)]/10 border border-[var(--color-accent-peach)]/20 text-[9px] text-[var(--color-accent-peach)]"
                    >
                        Your master at {formatLufs(state.integratedLufs)}LUFS will be turned down by {delta.toFixed(1)}{' '}
                        dB on
                        {platformNormalizationTarget}. Consider targeting {targetLufs}LUFS.
                    </div>
                ) : null}

                {/* Reset integrated button */}
                <button
                    type="button"
                    className="text-[8px] text-muted-foreground hover:text-foreground border border-border/30 px-2 py-1 rounded cursor-pointer"
                    onClick={() => resetIntegratedMeters(deviceId)}
                >
                    Reset Integrated LUFS + True Peak
                </button>
            </div>
            {/* Right: Input vs Output comparison */}
            <div className="w-[160px] shrink-0 border-l border-border/20 flex flex-col gap-2 p-2 justify-center">
                <div className="text-center">
                    <span className="text-[7px] text-muted-foreground uppercase tracking-wider block mb-1">Input</span>
                    <span className="text-lg font-mono text-foreground">{formatLufs(state.inputLufs)}</span>
                    <span className="text-[7px] text-muted-foreground block">LUFS</span>
                </div>
                <div className="w-full h-px bg-border/20" />
                <div className="text-center">
                    <span className="text-[7px] text-muted-foreground uppercase tracking-wider block mb-1">Output</span>
                    <span className="text-lg font-mono text-foreground">{formatLufs(state.outputLufs)}</span>
                    <span className="text-[7px] text-muted-foreground block">LUFS</span>
                </div>
                <div className="w-full h-px bg-border/20" />
                <div className="text-center">
                    <span className="text-[7px] text-muted-foreground uppercase tracking-wider block mb-1">
                        Gain Applied
                    </span>
                    <span className="text-sm font-mono text-foreground">
                        {state.outputLufs > -100 && state.inputLufs > -100
                            ? `${state.outputLufs - state.inputLufs > 0 ? '+' : ''}${(state.outputLufs - state.inputLufs).toFixed(1)}`
                            : '—'}
                    </span>
                    <span className="text-[7px] text-muted-foreground block">dB</span>
                </div>
            </div>
        </div>
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
        <div className="flex flex-col items-center gap-0.5">
            {label ? <span className="text-[6px] text-muted-foreground/50">{label}</span> : null}
            <div className="flex gap-px">
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
            </div>
        </div>
    );
};

const KnobColumn = ({
    label,
    sublabel,
    bypassed,
    value,
    onChange,
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
            onChange={onChange}
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
