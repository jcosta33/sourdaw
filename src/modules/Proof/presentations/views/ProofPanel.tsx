/**
 * ProofPanel — mastering suite panel with 5-level progressive disclosure.
 *
 * Level 1 (Play):   Style + Intensity + Target + IN/OUT LUFS
 * Level 2 (Shape):  Module enable/bypass + primary knob per module + chain meters
 * Level 3 (Build):  Full per-module controls
 * Level 4 (Route):  Reorder chain + M/S + Match EQ
 * Level 5 (Lab):    Advanced metering + AI assist
 */
import { type ReactElement, useSyncExternalStore } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { proofStore, setProofUiLevel, type ProofState } from '../../stores/proofStore';
import { setProofParamWithPatch, setProofParam } from '../../useCases/proofParamBridge';
import { PROOF_PRESETS } from '../../useCases/proofPresets';
import { loadProofPatch } from '../../stores/proofStore';
import { TARGET_LUFS, type ProofTarget } from '../../models/ProofPatch';
import { reorderChain, resetIntegratedMeters } from '../../useCases/proofParamBridge';
import { ProofEqSection } from '../components/ProofEqSection';
import { ProofDynSection } from '../components/ProofDynSection';
import { ProofImagerSection } from '../components/ProofImagerSection';
import { ProofExciterSection } from '../components/ProofExciterSection';
import { ProofLimiterSection } from '../components/ProofLimiterSection';
import { LoudnessHistory } from '../components/LoudnessHistory';
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

function formatLufs(v: number): string {
    if (v <= -100) return '-∞';
    return `${v.toFixed(1)}`;
}

function formatDb(v: number): string {
    if (v <= -100) return '-∞';
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export const ProofPanel = (): ReactElement => {
    const state = useSyncExternalStore<ProofState | null>(
        (cb) => proofStore.subscribe(cb),
        () => proofStore.value,
    );

    if (!state) {
        return <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Loading…</div>;
    }

    const { patch, uiLevel } = state;

    return (
        <div className="flex flex-col h-full">
            {/* ─── Top bar ─── */}
            <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b border-border/30 bg-surface-app/30">
                {/* Left: Preset selector */}
                <div className="flex items-center gap-2">
                    <select
                        className="h-5 rounded border border-border/40 bg-surface-inset px-1.5 text-[9px] text-foreground outline-none cursor-pointer"
                        value={patch.name}
                        onChange={(e) => {
                            const preset = PROOF_PRESETS.find((p) => p.name === e.target.value);
                            if (preset) loadProofPatch(preset.patch);
                        }}
                    >
                        <option value={patch.name}>{patch.name}</option>
                        {PROOF_PRESETS.map((p) => (
                            <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                </div>

                {/* Center: Level switcher */}
                <div className="flex gap-0.5 bg-surface-base/50 rounded p-0.5">
                    {(['Play', 'Shape', 'Build', 'Route', 'Lab'] as const).map((label, i) => {
                        const lvl = (i + 1) as 1 | 2 | 3 | 4 | 5;
                        return (
                            <button
                                key={label}
                                type="button"
                                className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors cursor-pointer ${
                                    uiLevel === lvl
                                        ? 'bg-[var(--color-accent-mint)] text-white'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                                onClick={() => setProofUiLevel(lvl)}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                {/* A/B button */}
                <button
                    type="button"
                    className={`px-2 py-0.5 rounded text-[8px] font-bold tracking-wider transition-colors cursor-pointer border ${
                        state.abBypass
                            ? 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)] border-[var(--color-accent-peach)]/30'
                            : 'text-muted-foreground border-border/30 hover:text-foreground'
                    }`}
                    onClick={() => {
                        const next = !state.abBypass;
                        setProofParam('ab_bypass', next ? 1 : 0);
                        const s = proofStore.value;
                        if (s) proofStore.set({ ...s, abBypass: next });
                    }}
                    title="A/B comparison with auto gain-matching — press to bypass processing while matching loudness"
                >
                    {state.abBypass ? 'A (DRY)' : 'B (WET)'}
                </button>

                {/* Right: Metering summary */}
                <div className="flex items-center gap-3 text-[9px] text-muted-foreground font-mono">
                    <span>IN <span className="text-foreground">{formatLufs(state.inputLufs)}</span> LUFS</span>
                    <span>OUT <span className="text-foreground">{formatLufs(state.outputLufs)}</span> LUFS</span>
                    <span>TP <span className={state.truePeakDb > -1 ? 'text-[var(--color-state-danger)]' : 'text-foreground'}>{formatDb(state.truePeakDb)}</span> dBTP</span>
                    {state.latency > 0 ? <span className="opacity-50">{((state.latency / 44100) * 1000).toFixed(1)}ms</span> : null}
                </div>
            </div>

            {/* ─── Main body ─── */}
            {uiLevel === 1 ? (
                <Level1Play state={state} />
            ) : uiLevel === 2 ? (
                <Level2Shape state={state} />
            ) : uiLevel === 3 ? (
                <Level3Build state={state} />
            ) : uiLevel === 4 ? (
                <Level4Route state={state} />
            ) : (
                <Level5Lab state={state} />
            )}
        </div>
    );
};

// ── Level 1: Play ────────────────────────────────────────────────────────────

const Level1Play = ({ state }: { state: ProofState }): ReactElement => {
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
                                setProofParamWithPatch('target', opt.value);
                                setProofParamWithPatch('targetLufs', opt.lufs);
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
                        <span className="text-2xl font-mono text-foreground tabular-nums">{formatLufs(state.inputLufs)}</span>
                        <span className="text-[8px] text-muted-foreground">LUFS</span>
                    </div>
                    <div className="w-px h-16 bg-border/20 self-center" />
                    <div className="flex flex-col items-center">
                        <span className="text-[8px] text-muted-foreground uppercase tracking-widest mb-1">Output</span>
                        <span className="text-2xl font-mono text-foreground tabular-nums">{formatLufs(state.outputLufs)}</span>
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
                    <div className="px-3 py-1.5 rounded bg-[var(--color-accent-peach)]/10 border border-[var(--color-accent-peach)]/20 text-[9px] text-[var(--color-accent-peach)] max-w-xs text-center">
                        Your master at {formatLufs(state.integratedLufs)} LUFS will be turned down by{' '}
                        {(state.integratedLufs - (TARGET_LUFS[patch.target] ?? -14)).toFixed(1)} dB on streaming platforms.
                    </div>
                ) : null}
            </div>

            {/* Ceiling knob */}
            <div className="flex flex-col items-center gap-1">
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Ceiling</span>
                <RotaryKnob
                    value={patch.limCeiling}
                    onChange={(v) => setProofParamWithPatch('limCeiling', v)}
                    min={-12}
                    max={0}
                    step={0.1}
                    defaultValue={-1}
                    size="lg"
                />
                <span className="text-[8px] text-muted-foreground font-mono">{patch.limCeiling.toFixed(1)} dBTP</span>
            </div>
        </div>
    );
};

// ── Level 2: Shape ───────────────────────────────────────────────────────────

const Level2Shape = ({ state }: { state: ProofState }): ReactElement => {
    const { patch } = state;
    const bypasses = [patch.eqBypassed, patch.dynBypassed, patch.imgBypassed, patch.excBypassed, patch.limBypassed];
    const bypassKeys = ['eqBypassed', 'dynBypassed', 'imgBypassed', 'excBypassed', 'limBypassed'] as const;

    return (
        <div className="flex-1 flex flex-col px-3 py-2 gap-2">
            {/* Signal chain strip with inline meters */}
            <div className="flex items-center gap-1">
                {/* Input meter */}
                <MiniMeter peakL={state.tapPeaks[0]?.peakL ?? -100} peakR={state.tapPeaks[0]?.peakR ?? -100} label="IN" />

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
                                onClick={() => setProofParamWithPatch(bypassKeys[moduleIdx]!, !bypassed)}
                            >
                                {label}
                            </button>
                            <div className="w-4 h-px bg-border/30" />
                            <MiniMeter peakL={state.tapPeaks[tapIdx]?.peakL ?? -100} peakR={state.tapPeaks[tapIdx]?.peakR ?? -100} />
                        </div>
                    );
                })}
            </div>

            {/* Primary knobs per module */}
            <div className="flex items-start justify-around flex-1 pt-2">
                <KnobColumn label="EQ" sublabel="Output Gain" bypassed={patch.eqBypassed}
                    value={0} onChange={() => {}} min={-12} max={12} unit="dB" color={MODULE_COLORS[0]!} />
                <KnobColumn label="Dynamics" sublabel="Threshold" bypassed={patch.dynBypassed}
                    value={patch.dynBands[0]?.threshold ?? -20} onChange={(v) => {
                        const bands = [...patch.dynBands];
                        bands.forEach((b) => b.threshold = v);
                        setProofParamWithPatch('dynBands' as never, bands as never);
                    }} min={-60} max={0} unit="dB" color={MODULE_COLORS[1]!} />
                <KnobColumn label="Imager" sublabel="Width" bypassed={patch.imgBypassed}
                    value={patch.imgBandWidth[2] ?? 1} onChange={(v) => {
                        const widths: [number, number, number, number] = [...patch.imgBandWidth];
                        widths[2] = v; widths[3] = v;
                        setProofParamWithPatch('imgBandWidth', widths);
                    }} min={0} max={2} unit="" color={MODULE_COLORS[2]!} />
                <KnobColumn label="Exciter" sublabel="Drive" bypassed={patch.excBypassed}
                    value={patch.excBands[1]?.drive ?? 0.2} onChange={(v) => {
                        const bands = [...patch.excBands];
                        bands.forEach((b) => { b.drive = v; b.enabled = v > 0.01; });
                        setProofParamWithPatch('excBands' as never, bands as never);
                    }} min={0} max={1} unit="" color={MODULE_COLORS[3]!} />
                <KnobColumn label="Limiter" sublabel="Ceiling" bypassed={patch.limBypassed}
                    value={patch.limCeiling} onChange={(v) => setProofParamWithPatch('limCeiling', v)}
                    min={-12} max={0} unit="dBTP" color={MODULE_COLORS[4]!} />
            </div>
        </div>
    );
};

// ── Level 3: Build ───────────────────────────────────────────────────────────

const Level3Build = ({ state }: { state: ProofState }): ReactElement => {
    const { patch } = state;

    return (
        <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Module controls — scrollable */}
            <div className="flex-1 overflow-y-auto py-2 space-y-3">
                <ProofEqSection patch={patch} />
                <div className="mx-2 border-t border-border/20" />
                <ProofDynSection patch={patch} dynGr={state.dynGr} />
                <div className="mx-2 border-t border-border/20" />
                <ProofImagerSection patch={patch} correlation={state.correlation} />
                <div className="mx-2 border-t border-border/20" />
                <ProofExciterSection patch={patch} />
                <div className="mx-2 border-t border-border/20" />
                <ProofLimiterSection patch={patch} limiterGrDb={state.limiterGrDb} truePeakDb={state.truePeakDb} />
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
                        <span className={state.truePeakDb > -1 ? 'text-[var(--color-state-danger)]' : 'text-foreground'}>
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

const Level4Route = ({ state }: { state: ProofState }): ReactElement => {
    const { patch } = state;

    const moveModule = (fromIdx: number, direction: -1 | 1) => {
        const toIdx = fromIdx + direction;
        if (toIdx < 0 || toIdx >= 5) return;
        const newOrder: [number, number, number, number, number] = [...patch.chainOrder];
        const temp = newOrder[fromIdx]!;
        newOrder[fromIdx] = newOrder[toIdx]!;
        newOrder[toIdx] = temp;
        reorderChain(newOrder);
    };

    return (
        <div className="flex-1 flex flex-col px-4 py-3 gap-4">
            {/* Chain reorder */}
            <div>
                <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">Signal Chain Order</span>
                <div className="flex items-center gap-1">
                    <span className="text-[7px] text-muted-foreground">IN</span>
                    <div className="w-4 h-px bg-border/30" />
                    {patch.chainOrder.map((moduleIdx, slot) => (
                        <div key={slot} className="flex items-center gap-1">
                            <div className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded bg-surface-base/80 border border-border/30">
                                <span className="text-[9px] font-bold" style={{ color: MODULE_COLORS[moduleIdx] }}>
                                    {MODULE_LABELS[moduleIdx]}
                                </span>
                                <div className="flex gap-0.5">
                                    <button
                                        type="button"
                                        className="text-[8px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
                                        onClick={() => moveModule(slot, -1)}
                                        disabled={slot === 0}
                                    >
                                        ←
                                    </button>
                                    <button
                                        type="button"
                                        className="text-[8px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
                                        onClick={() => moveModule(slot, 1)}
                                        disabled={slot === 4}
                                    >
                                        →
                                    </button>
                                </div>
                            </div>
                            {slot < 4 ? <div className="w-4 h-px bg-border/30" /> : null}
                        </div>
                    ))}
                    <div className="w-4 h-px bg-border/30" />
                    <span className="text-[7px] text-muted-foreground">OUT</span>
                </div>
            </div>

            {/* Latency info */}
            <div className="flex items-center gap-4 text-[8px] text-muted-foreground">
                <span>Reported latency: <span className="text-foreground font-mono">{state.latency} samples</span>
                    {state.latency > 0 ? ` (${((state.latency / 44100) * 1000).toFixed(1)}ms)` : ''}
                </span>
            </div>

            {/* Input/Output gain */}
            <div className="flex gap-8">
                <div className="flex flex-col items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">Input Gain</span>
                    <RotaryKnob
                        value={patch.inputGain} onChange={(v) => setProofParamWithPatch('inputGain', v)}
                        min={-24} max={24} step={0.5} defaultValue={0} size="md"
                    />
                    <span className="text-[7px] text-muted-foreground font-mono">{patch.inputGain > 0 ? '+' : ''}{patch.inputGain.toFixed(1)} dB</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">Output Gain</span>
                    <RotaryKnob
                        value={patch.outputGain} onChange={(v) => setProofParamWithPatch('outputGain', v)}
                        min={-24} max={24} step={0.5} defaultValue={0} size="md"
                    />
                    <span className="text-[7px] text-muted-foreground font-mono">{patch.outputGain > 0 ? '+' : ''}{patch.outputGain.toFixed(1)} dB</span>
                </div>
            </div>
        </div>
    );
};

// ── Level 5: Lab ─────────────────────────────────────────────────────────────

const Level5Lab = ({ state }: { state: ProofState }): ReactElement => {
    const { patch } = state;
    const targetLufs = TARGET_LUFS[patch.target] ?? -14;
    const delta = state.integratedLufs > -100 ? state.integratedLufs - targetLufs : 0;
    const { fftData, sampleRate, fftSize } = useProofAnalyser();

    return (
        <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left: Advanced metering dashboard */}
            <div className="flex-1 overflow-y-auto py-2 px-3 space-y-3">
                {/* Loudness history */}
                <div>
                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Loudness History</span>
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
                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Tonal Balance</span>
                    <TonalBalance
                        fftData={fftData}
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
                    <MeterCard label="True Peak" value={formatDb(state.truePeakDb)} unit="dBTP"
                        alert={state.truePeakDb > -1} />
                    <MeterCard label="LRA" value={state.lra.toFixed(1)} unit="LU" />
                    <MeterCard label="Correlation" value={state.correlation.toFixed(2)} unit=""
                        alert={state.correlation < 0.3} />
                </div>

                {/* Platform normalization info */}
                {delta > 1 ? (
                    <div className="px-3 py-2 rounded bg-[var(--color-accent-peach)]/10 border border-[var(--color-accent-peach)]/20 text-[9px] text-[var(--color-accent-peach)]">
                        Your master at {formatLufs(state.integratedLufs)} LUFS will be turned down by {delta.toFixed(1)} dB on
                        {patch.target === 'streaming' ? ' Spotify, Apple Music, and YouTube' :
                         patch.target === 'broadcast' ? ' broadcast television' :
                         ` ${patch.target}`}. Consider targeting {targetLufs} LUFS.
                    </div>
                ) : null}

                {/* Reset integrated button */}
                <button
                    type="button"
                    className="text-[8px] text-muted-foreground hover:text-foreground border border-border/30 px-2 py-1 rounded cursor-pointer"
                    onClick={resetIntegratedMeters}
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
                    <span className="text-[7px] text-muted-foreground uppercase tracking-wider block mb-1">Gain Applied</span>
                    <span className="text-sm font-mono text-foreground">
                        {state.outputLufs > -100 && state.inputLufs > -100
                            ? `${(state.outputLufs - state.inputLufs) > 0 ? '+' : ''}${(state.outputLufs - state.inputLufs).toFixed(1)}`
                            : '—'}
                    </span>
                    <span className="text-[7px] text-muted-foreground block">dB</span>
                </div>
            </div>
        </div>
    );
};

const MeterCard = ({ label, value, unit, alert }: { label: string; value: string; unit: string; alert?: boolean }): ReactElement => (
    <div className={`px-2 py-1.5 rounded bg-surface-base/50 border ${alert ? 'border-[var(--color-state-danger)]/30' : 'border-border/20'}`}>
        <span className="text-[7px] text-muted-foreground block">{label}</span>
        <span className={`text-sm font-mono ${alert ? 'text-[var(--color-state-danger)]' : 'text-foreground'}`}>{value}</span>
        {unit ? <span className="text-[7px] text-muted-foreground ml-1">{unit}</span> : null}
    </div>
);

// ── Shared sub-components ────────────────────────────────────────────────────

const MiniMeter = ({ peakL, peakR, label }: { peakL: number; peakR: number; label?: string }): ReactElement => {
    const height = 24;
    const normalize = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));
    const hL = normalize(peakL) * height;
    const hR = normalize(peakR) * height;

    return (
        <div className="flex flex-col items-center gap-0.5">
            {label ? <span className="text-[6px] text-muted-foreground/50">{label}</span> : null}
            <div className="flex gap-px">
                <div className="w-1 bg-surface-inset rounded-sm overflow-hidden" style={{ height }}>
                    <div
                        className="w-full bg-[var(--color-accent-mint)] rounded-sm transition-all duration-75"
                        style={{ height: hL, marginTop: height - hL }}
                    />
                </div>
                <div className="w-1 bg-surface-inset rounded-sm overflow-hidden" style={{ height }}>
                    <div
                        className="w-full bg-[var(--color-accent-mint)] rounded-sm transition-all duration-75"
                        style={{ height: hR, marginTop: height - hR }}
                    />
                </div>
            </div>
        </div>
    );
};

const KnobColumn = ({ label, sublabel, bypassed, value, onChange, min, max, unit, color }: {
    label: string; sublabel: string; bypassed: boolean;
    value: number; onChange: (v: number) => void;
    min: number; max: number; unit: string; color: string;
}): ReactElement => (
    <div className={`flex flex-col items-center gap-1 ${bypassed ? 'opacity-30' : ''}`}>
        <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
        <RotaryKnob value={value} onChange={onChange} min={min} max={max} step={0.1} defaultValue={value} size="md" />
        <span className="text-[7px] text-muted-foreground">{sublabel}</span>
        <span className="text-[7px] text-muted-foreground/50 font-mono">
            {value.toFixed(1)}{unit ? ` ${unit}` : ''}
        </span>
    </div>
);
