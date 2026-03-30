/**
 * ProofChamberPanel — flagship reverb plugin UI.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Top bar: [Dutch Oven] · [Hall|Room|Plate|...] space pills    │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │              [Spectrogram — scrolling freq × time]               │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ Size·Decay·Mix·PreDly │ HiCut·LoCut·Damp │ Mod·Width │ Shim·Frz│
 *   └──────────────────────────────────────────────────────────────────┘
 */
import { type ReactElement, type ReactNode, useState, useRef, useEffect } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import {
    type SpaceType,
    type AlgorithmType,
    type ProofChamberParams,
    DEFAULT_PARAMS,
    SPACE_PRESETS,
    PARAM_MAP,
    ALGORITHM_MAP,
} from '../../models/ProofChamberPatch';
import { DecayEqOverlay } from '../components/DecayEqOverlay';
import { SignalFlowDiagram } from '../components/SignalFlowDiagram';
import { IrBrowser } from '../components/IrBrowser';

const SPACES: { id: SpaceType; label: string }[] = [
    { id: 'hall', label: 'Hall' },
    { id: 'room', label: 'Room' },
    { id: 'plate', label: 'Plate' },
    { id: 'chamber', label: 'Chamber' },
    { id: 'cathedral', label: 'Cathedral' },
    { id: 'shimmer', label: 'Shimmer' },
    { id: 'infinite', label: 'Infinite' },
    { id: 'spring', label: 'Spring' },
];

type ProofChamberPanelProps = {
    deviceId?: string;
    onParamChange?: (paramId: string, value: number) => void;
};

export const ProofChamberPanel = ({ onParamChange }: ProofChamberPanelProps): ReactElement => {
    const [params, setParams] = useState<ProofChamberParams>({ ...DEFAULT_PARAMS });
    const [decayEqMults, setDecayEqMults] = useState([1.0, 1.0, 1.0, 1.0, 1.0, 1.0]);
    const [showDecayEq, setShowDecayEq] = useState(false);
    const [showFlow, setShowFlow] = useState(false);

    const set = (key: keyof ProofChamberParams, value: number | boolean): void => {
        setParams((prev) => ({ ...prev, [key]: value }));
        // Forward to audio engine
        const rustKey = PARAM_MAP[key];
        if (rustKey && onParamChange) {
            const numVal = typeof value === 'boolean' ? (value ? 1.0 : 0.0) : value;
            onParamChange(rustKey, numVal);
        }
    };

    const selectSpace = (space: SpaceType): void => {
        const preset = SPACE_PRESETS[space];
        const algo = (preset as Record<string, unknown>).algorithm as AlgorithmType | undefined;
        const newParams = { ...DEFAULT_PARAMS, ...preset, space, algorithm: algo ?? 'plate' };
        setParams(newParams);
        if (onParamChange) {
            // Send algorithm switch first
            onParamChange('algorithm', ALGORITHM_MAP[newParams.algorithm] ?? 0);
            // Then send all other params
            for (const [key, val] of Object.entries(newParams)) {
                if (key === 'algorithm' || key === 'space') {
                    continue;
                }
                const rustKey = PARAM_MAP[key];
                if (rustKey && typeof val === 'number') {
                    onParamChange(rustKey, val);
                } else if (rustKey && typeof val === 'boolean') {
                    onParamChange(rustKey, val ? 1.0 : 0.0);
                }
            }
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* ─── Top bar ─── */}
            <div
                className="flex items-center justify-between px-3 py-1 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, rgba(20,20,22,0.95) 0%, rgba(14,14,16,0.95) 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.5)',
                    borderBottom: '1px solid rgba(0,0,0,0.4)',
                }}
            >
                <span className="text-[10px] font-bold text-[var(--color-accent-cyan)] tracking-tight">Dutch Oven</span>
                {/* Space selector pills */}
                <div className="flex gap-0.5 bg-surface-base/50 rounded p-0.5">
                    {SPACES.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                                params.space === id
                                    ? 'bg-[var(--color-accent-cyan)] text-white'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => selectSpace(id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {/* Vintage mode selector */}
                <div className="flex gap-0.5 bg-surface-base/50 rounded p-0.5">
                    {[
                        { id: 0, label: 'Modern' },
                        { id: 1, label: '80s' },
                        { id: 2, label: '70s' },
                    ].map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                                params.vintage === id
                                    ? 'bg-[var(--color-accent-peach)] text-white'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => set('vintage', id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── Spectrogram hero + overlays ─── */}
            <div
                className="flex-1 min-h-[60px] shrink relative"
                style={{
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
                    borderBottom: '1px solid rgba(40,40,40,0.3)',
                }}
            >
                <ReverbSpectrogram decay={params.decay} damping={params.damping} />
                {showDecayEq ? (
                    <DecayEqOverlay
                        multipliers={decayEqMults}
                        onChange={(band, mult) => {
                            const next = [...decayEqMults];
                            next[band] = mult;
                            setDecayEqMults(next);
                            if (onParamChange) {
                                onParamChange(`decay_eq_${band}`, mult);
                            }
                        }}
                        width={600}
                        height={120}
                    />
                ) : null}
                {/* Toggle buttons for overlays */}
                <div className="absolute top-1 right-1 flex gap-0.5">
                    <button
                        type="button"
                        className={`px-1 py-0.5 rounded text-[7px] font-medium transition-colors ${
                            showDecayEq
                                ? 'bg-[var(--color-accent-cyan)]/30 text-[var(--color-accent-cyan)]'
                                : 'text-muted-foreground/30 hover:text-muted-foreground'
                        }`}
                        onClick={() => setShowDecayEq(!showDecayEq)}
                    >
                        EQ
                    </button>
                    <button
                        type="button"
                        className={`px-1 py-0.5 rounded text-[7px] font-medium transition-colors ${
                            showFlow
                                ? 'bg-[var(--color-accent-cyan)]/30 text-[var(--color-accent-cyan)]'
                                : 'text-muted-foreground/30 hover:text-muted-foreground'
                        }`}
                        onClick={() => setShowFlow(!showFlow)}
                    >
                        Flow
                    </button>
                </div>
            </div>

            {/* ─── Signal flow diagram (toggleable) ─── */}
            {showFlow ? (
                <div className="shrink-0 border-b border-border/20 px-2 py-1 bg-surface-app/30">
                    <SignalFlowDiagram
                        algorithm={params.algorithm}
                        shimmerEnabled={params.shimmer}
                        freezeEnabled={params.freeze}
                    />
                </div>
            ) : null}

            {/* ─── Controls ─── */}
            <div className="shrink-0 overflow-x-auto px-2 py-2">
                <div className="flex items-stretch gap-2 min-w-max">
                    {/* Core */}
                    <KnobGroup label="Space">
                        <KnobStack label="Size" value={params.size} onChange={(v) => set('size', v)} min={0} max={1} step={0.01} defaultValue={0.75} size="lg" />
                        <KnobStack label="Decay" value={params.decay} onChange={(v) => set('decay', v)} min={0} max={0.999} step={0.001} defaultValue={0.5} size="lg" display={`${(params.decay * 30).toFixed(1)}s`} />
                        <KnobStack label="Mix" value={params.mix} onChange={(v) => set('mix', v)} min={0} max={1} step={0.01} defaultValue={0.3} size="lg" display={`${Math.round(params.mix * 100)}%`} />
                        <KnobStack label="Pre-Dly" value={params.predelay} onChange={(v) => set('predelay', v)} min={0} max={500} step={1} defaultValue={15} size="md" display={`${Math.round(params.predelay)}ms`} />
                    </KnobGroup>

                    {/* Tone */}
                    <KnobGroup label="Tone">
                        <KnobStack label="Hi Cut" value={params.highCut} onChange={(v) => set('highCut', v)} min={1000} max={20000} step={100} defaultValue={12000} size="md" display={params.highCut >= 1000 ? `${(params.highCut / 1000).toFixed(1)}k` : `${Math.round(params.highCut)}`} />
                        <KnobStack label="Lo Cut" value={params.lowCut} onChange={(v) => set('lowCut', v)} min={20} max={1000} step={5} defaultValue={80} size="md" display={`${Math.round(params.lowCut)}Hz`} />
                        <KnobStack label="Damp" value={params.damping} onChange={(v) => set('damping', v)} min={0} max={0.999} step={0.001} defaultValue={0.3} size="md" />
                        <KnobStack label="Diffuse" value={params.diffusion} onChange={(v) => set('diffusion', v)} min={0} max={1} step={0.01} defaultValue={0.75} size="md" />
                    </KnobGroup>

                    {/* Modulation */}
                    <KnobGroup label="Modulation">
                        <KnobStack label="Depth" value={params.modDepth} onChange={(v) => set('modDepth', v)} min={0} max={1} step={0.01} defaultValue={0.3} size="md" />
                        <KnobStack label="Rate" value={params.modRate} onChange={(v) => set('modRate', v)} min={0.1} max={5} step={0.1} defaultValue={1.0} size="md" display={`${params.modRate.toFixed(1)}Hz`} />
                        <KnobStack label="Width" value={params.width} onChange={(v) => set('width', v)} min={0} max={2} step={0.01} defaultValue={1.0} size="md" display={`${Math.round(params.width * 100)}%`} />
                    </KnobGroup>

                    {/* Character */}
                    <KnobGroup label="Character">
                        <KnobStack label="Gravity" value={params.gravity} onChange={(v) => set('gravity', v)} min={-1} max={1} step={0.01} defaultValue={0.5} size="md" bipolar />
                        <KnobStack label="E/L Bal" value={params.earlyLateBalance} onChange={(v) => set('earlyLateBalance', v)} min={0} max={1} step={0.01} defaultValue={0.4} size="md" display={`${Math.round(params.earlyLateBalance * 100)}%`} />
                    </KnobGroup>

                    {/* Special */}
                    <KnobGroup label="Special">
                        <div className="flex flex-col items-center gap-1.5">
                            <button
                                type="button"
                                className={`px-2.5 py-1 rounded text-[8px] font-bold uppercase tracking-wider transition-all ${
                                    params.shimmer
                                        ? 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)] border border-[var(--color-accent-lavender)]/40 shadow-[0_0_8px_rgba(168,130,255,0.2)]'
                                        : 'bg-surface-raised/30 text-muted-foreground/50 border border-border/20 hover:text-foreground'
                                }`}
                                onClick={() => set('shimmer', !params.shimmer)}
                            >
                                Shimmer
                            </button>
                            {params.shimmer ? (
                                <KnobStack label="Amount" value={params.shimmerAmount} onChange={(v) => set('shimmerAmount', v)} min={0} max={1} step={0.01} defaultValue={0.2} size="sm" />
                            ) : null}
                        </div>
                        <div className="flex flex-col items-center gap-1.5">
                            <button
                                type="button"
                                className={`px-2.5 py-1 rounded text-[8px] font-bold uppercase tracking-wider transition-all ${
                                    params.freeze
                                        ? 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)] border border-[var(--color-accent-cyan)]/40 shadow-[0_0_8px_rgba(127,184,196,0.2)] animate-pulse'
                                        : 'bg-surface-raised/30 text-muted-foreground/50 border border-border/20 hover:text-foreground'
                                }`}
                                style={params.freeze ? { animationDuration: '2s' } : undefined}
                                onClick={() => set('freeze', !params.freeze)}
                            >
                                Freeze
                            </button>
                        </div>
                    </KnobGroup>

                    {/* IR */}
                    <KnobGroup label="Impulse Response">
                        <div className="w-[140px]">
                            <IrBrowser
                                onIrLoaded={(data, channels) => {
                                    console.log(`[ProofChamber] IR loaded: ${data.length} samples, ${channels}ch`);
                                }}
                            />
                        </div>
                    </KnobGroup>
                </div>
            </div>
        </div>
    );
};

// ── Grouped knob container with label and inset surface ──────────────

const KnobGroup = ({ label, children }: { label: string; children: ReactNode }): ReactElement => (
    <div className="flex flex-col gap-1">
        <span className="text-[7px] font-semibold text-muted-foreground/40 uppercase tracking-widest px-1">{label}</span>
        <div
            className="flex items-end gap-2 px-2.5 py-2 rounded"
            style={{
                background: 'linear-gradient(180deg, #080808 0%, #0c0c0e 100%)',
                boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6), inset 0 0 1px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.03)',
                border: '1px solid rgba(0,0,0,0.4)',
                borderTop: '1px solid rgba(0,0,0,0.5)',
                borderBottom: '1px solid rgba(40,40,40,0.25)',
            }}
        >
            {children}
        </div>
    </div>
);

// ── Knob with label and optional value display ──────────────────────

type KnobStackProps = {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    size: 'sm' | 'md' | 'lg' | 'xl';
    display?: string;
    bipolar?: boolean;
};

const KnobStack = ({
    label,
    value,
    onChange,
    min,
    max,
    step,
    defaultValue,
    size,
    display,
    bipolar,
}: KnobStackProps): ReactElement => (
    <div className="flex flex-col items-center min-w-fit">
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size={size}
            bipolar={bipolar}
            label={label}
        />
        {display ? <span className="text-[6px] text-muted-foreground/40 tabular-nums -mt-0.5">{display}</span> : null}
    </div>
);

// ── Reverb tail spectrogram — continuous scrolling freq×time ────────
//
// Simulates the reverb impulse response as a live spectrogram.
// Periodically triggers synthetic "transients" that decay across the
// frequency spectrum — higher frequencies fade faster with more damping.

const ReverbSpectrogram = ({ decay, damping }: { decay: number; damping: number }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef({
        raf: 0,
        // Each transient decays independently from its trigger time
        transients: [] as { age: number; energy: number }[],
        ticksSinceLast: 0,
    });
    // Keep decay/damping in refs so the rAF loop reads fresh values
    const decayRef = useRef(decay);
    const dampingRef = useRef(damping);
    decayRef.current = decay;
    dampingRef.current = damping;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        const s = stateRef.current;

        ctx.fillStyle = 'rgb(3,3,5)';
        ctx.fillRect(0, 0, w, h);

        const draw = (): void => {
            const d = decayRef.current;
            const dmp = dampingRef.current;

            // Shift canvas left by 1px (continuous scroll, never resets)
            const imgData = ctx.getImageData(1, 0, w - 1, h);
            ctx.putImageData(imgData, 0, 0);

            // Age all active transients
            for (let i = s.transients.length - 1; i >= 0; i--) {
                s.transients[i]!.age++;
                // Remove when fully decayed
                if (s.transients[i]!.age > 200 + d * 400) {
                    s.transients.splice(i, 1);
                }
            }

            // Trigger new transient periodically
            s.ticksSinceLast++;
            if (s.ticksSinceLast > 70 + Math.random() * 80) {
                s.ticksSinceLast = 0;
                s.transients.push({ age: 0, energy: 0.6 + Math.random() * 0.4 });
            }

            // Composite new column from all active transients
            for (let y = 0; y < h; y++) {
                const freqNorm = 1.0 - y / h; // 0=low, 1=high
                let total = 0;

                for (const tr of s.transients) {
                    // High frequencies decay faster based on damping
                    const freqDecay = 1.0 + dmp * freqNorm * 4.0;
                    const decayRate = 0.006 * (1.0 - d * 0.94) * freqDecay;
                    const amp = tr.energy * Math.exp(-tr.age * decayRate);
                    total += amp;
                }

                // Add subtle noise floor
                total += Math.random() * 0.02;
                total = Math.min(1, total);

                // Color mapping: dark teal → bright cyan → white at peak
                const r = Math.floor(total * 40 + total * total * 80);
                const g = Math.floor(total * 100 + total * total * 100);
                const b = Math.floor(total * 140 + total * total * 80);
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(w - 1, y, 1, 1);
            }

            s.raf = requestAnimationFrame(draw);
        };

        s.raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(s.raf);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            width={600}
            height={120}
            className="w-full h-full"
            style={{ imageRendering: 'pixelated' }}
        />
    );
};
