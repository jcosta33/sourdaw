/**
 * ProofChamberPanel — flagship reverb plugin UI.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Top bar: [Proof Chamber] · [Hall|Room|Plate|...] space pills    │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │              [Spectrogram — scrolling freq × time]               │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ Size·Decay·Mix·PreDly │ HiCut·LoCut·Damp │ Mod·Width │ Shim·Frz│
 *   └──────────────────────────────────────────────────────────────────┘
 */
import { type ReactElement, useState, useRef, useEffect } from 'react';
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
            <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b border-border/30 bg-surface-app/30">
                <span className="text-[10px] font-bold text-[var(--color-accent-cyan)] tracking-tight">
                    Proof Chamber
                </span>
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
            <div className="flex-1 min-h-[60px] shrink border-b border-border/20 relative">
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
                            showDecayEq ? 'bg-[var(--color-accent-cyan)]/30 text-[var(--color-accent-cyan)]' : 'text-muted-foreground/30 hover:text-muted-foreground'
                        }`}
                        onClick={() => setShowDecayEq(!showDecayEq)}
                    >
                        EQ
                    </button>
                    <button
                        type="button"
                        className={`px-1 py-0.5 rounded text-[7px] font-medium transition-colors ${
                            showFlow ? 'bg-[var(--color-accent-cyan)]/30 text-[var(--color-accent-cyan)]' : 'text-muted-foreground/30 hover:text-muted-foreground'
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

            {/* ─── Knob row ─── */}
            <div className="shrink-0 overflow-x-auto">
                <div className="flex items-start gap-0 px-3 py-2 min-w-max">
                    {/* Core: Size, Decay, Mix, Pre-Delay */}
                    <div className="flex items-end gap-2 pr-3">
                        <KnobStack label="Size" value={params.size} onChange={(v) => set('size', v)}
                            min={0} max={1} step={0.01} defaultValue={0.75} size="xl" />
                        <KnobStack label="Decay" value={params.decay} onChange={(v) => set('decay', v)}
                            min={0} max={0.999} step={0.001} defaultValue={0.5} size="xl"
                            display={`${(params.decay * 30).toFixed(1)}s`} />
                        <KnobStack label="Mix" value={params.mix} onChange={(v) => set('mix', v)}
                            min={0} max={1} step={0.01} defaultValue={0.3} size="xl"
                            display={`${Math.round(params.mix * 100)}%`} />
                        <KnobStack label="Pre-Dly" value={params.predelay} onChange={(v) => set('predelay', v)}
                            min={0} max={500} step={1} defaultValue={15} size="lg"
                            display={`${Math.round(params.predelay)}ms`} />
                    </div>

                    <div className="w-px self-stretch bg-border/15 shrink-0" />

                    {/* Tone: High Cut, Low Cut, Damping */}
                    <div className="flex items-end gap-2 px-3">
                        <KnobStack label="Hi Cut" value={params.highCut} onChange={(v) => set('highCut', v)}
                            min={1000} max={20000} step={100} defaultValue={12000} size="lg"
                            display={params.highCut >= 1000 ? `${(params.highCut / 1000).toFixed(1)}k` : `${Math.round(params.highCut)}`} />
                        <KnobStack label="Lo Cut" value={params.lowCut} onChange={(v) => set('lowCut', v)}
                            min={20} max={1000} step={5} defaultValue={80} size="lg"
                            display={`${Math.round(params.lowCut)}Hz`} />
                        <KnobStack label="Damp" value={params.damping} onChange={(v) => set('damping', v)}
                            min={0} max={0.999} step={0.001} defaultValue={0.3} size="lg" />
                        <KnobStack label="Diffuse" value={params.diffusion} onChange={(v) => set('diffusion', v)}
                            min={0} max={1} step={0.01} defaultValue={0.75} size="md" />
                    </div>

                    <div className="w-px self-stretch bg-border/15 shrink-0" />

                    {/* Modulation & Width */}
                    <div className="flex items-end gap-2 px-3">
                        <KnobStack label="Mod" value={params.modDepth} onChange={(v) => set('modDepth', v)}
                            min={0} max={1} step={0.01} defaultValue={0.3} size="md" />
                        <KnobStack label="Rate" value={params.modRate} onChange={(v) => set('modRate', v)}
                            min={0.1} max={5} step={0.1} defaultValue={1.0} size="md"
                            display={`${params.modRate.toFixed(1)}Hz`} />
                        <KnobStack label="Width" value={params.width} onChange={(v) => set('width', v)}
                            min={0} max={2} step={0.01} defaultValue={1.0} size="md"
                            display={`${Math.round(params.width * 100)}%`} />
                    </div>

                    <div className="w-px self-stretch bg-border/15 shrink-0" />

                    {/* Advanced: Gravity, Early/Late */}
                    <div className="flex items-end gap-2 px-3">
                        <KnobStack label="Gravity" value={params.gravity} onChange={(v) => set('gravity', v)}
                            min={-1} max={1} step={0.01} defaultValue={0.5} size="md" bipolar />
                        <KnobStack label="E/L Bal" value={params.earlyLateBalance} onChange={(v) => set('earlyLateBalance', v)}
                            min={0} max={1} step={0.01} defaultValue={0.4} size="md"
                            display={`${Math.round(params.earlyLateBalance * 100)}%`} />
                    </div>

                    <div className="w-px self-stretch bg-border/15 shrink-0" />

                    {/* Special: Shimmer + Freeze */}
                    <div className="flex items-end gap-2 pl-3">
                        <div className="flex flex-col items-center gap-1">
                            <button
                                type="button"
                                className={`px-2 py-1 rounded text-[8px] font-bold uppercase tracking-wider transition-colors ${
                                    params.shimmer
                                        ? 'bg-[var(--color-accent-lavender)]/30 text-[var(--color-accent-lavender)] border border-[var(--color-accent-lavender)]/40'
                                        : 'bg-surface-raised/40 text-muted-foreground/50 border border-border/20 hover:text-foreground'
                                }`}
                                onClick={() => set('shimmer', !params.shimmer)}
                            >
                                Shimmer
                            </button>
                            {params.shimmer ? (
                                <KnobStack label="Amount" value={params.shimmerAmount} onChange={(v) => set('shimmerAmount', v)}
                                    min={0} max={1} step={0.01} defaultValue={0.2} size="sm" />
                            ) : null}
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <button
                                type="button"
                                className={`px-2 py-1 rounded text-[8px] font-bold uppercase tracking-wider transition-colors ${
                                    params.freeze
                                        ? 'bg-[var(--color-accent-cyan)]/30 text-[var(--color-accent-cyan)] border border-[var(--color-accent-cyan)]/40 animate-pulse'
                                        : 'bg-surface-raised/40 text-muted-foreground/50 border border-border/20 hover:text-foreground'
                                }`}
                                onClick={() => set('freeze', !params.freeze)}
                            >
                                Freeze
                            </button>
                        </div>
                    </div>

                    {/* IR loader (for convolution/hybrid modes) */}
                    <div className="w-px self-stretch bg-border/15 shrink-0" />
                    <div className="shrink-0 px-2 w-[160px]">
                        <IrBrowser
                            onIrLoaded={(data, channels) => {
                                console.log(`[ProofChamber] IR loaded: ${data.length} samples, ${channels}ch`);
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

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

const KnobStack = ({ label, value, onChange, min, max, step, defaultValue, size, display, bipolar }: KnobStackProps): ReactElement => (
    <div className="flex flex-col items-center gap-0">
        <RotaryKnob value={value} onChange={onChange} min={min} max={max} step={step} defaultValue={defaultValue} size={size} bipolar={bipolar} />
        <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider leading-tight">{label}</span>
        {display ? (
            <span className="text-[6px] text-muted-foreground/40 tabular-nums">{display}</span>
        ) : null}
    </div>
);

// ── Spectrogram visualization ───────────────────────────────────────

const ReverbSpectrogram = ({ decay, damping }: { decay: number; damping: number }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef({
        frame: 0,
        raf: 0,
        ripples: [] as { x: number; y: number; age: number; maxAge: number }[],
        lastTrigger: 0,
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const s = stateRef.current;

        const draw = (): void => {
            const w = canvas.width;
            const h = canvas.height;
            s.frame++;

            // Shift existing image left by 1 pixel (scrolling spectrogram)
            const imageData = ctx.getImageData(1, 0, w - 1, h);
            ctx.putImageData(imageData, 0, 0);

            // Draw new column on the right
            const t = s.frame;
            for (let y = 0; y < h; y++) {
                const freqNorm = 1.0 - y / h;
                const freqDecayMult = 1.0 + damping * freqNorm * 3.0;
                const amplitude = Math.exp(-t * 0.005 * (1.0 - decay * 0.95) * freqDecayMult);
                const noise = Math.random() * 0.12;
                const val = Math.min(1, amplitude * 0.8 + noise * amplitude);

                // Cyan-tinted color
                const r = Math.floor(val * 30 + val * val * 20);
                const g = Math.floor(val * 120 + val * val * 40);
                const b = Math.floor(val * 160 + val * val * 40);
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(w - 1, y, 1, 1);
            }

            // Ripple animation: trigger randomly to simulate transients
            if (s.frame - s.lastTrigger > 60 + Math.random() * 120) {
                s.lastTrigger = s.frame;
                s.ripples.push({
                    x: w - 1,
                    y: h * 0.3 + Math.random() * h * 0.4,
                    age: 0,
                    maxAge: 30 + decay * 60,
                });
            }

            // Draw ripples
            for (let ri = s.ripples.length - 1; ri >= 0; ri--) {
                const rip = s.ripples[ri]!;
                rip.age++;
                if (rip.age > rip.maxAge) {
                    s.ripples.splice(ri, 1);
                    continue;
                }

                const progress = rip.age / rip.maxAge;
                const radius = progress * 40;
                const alpha = (1.0 - progress) * 0.4;

                ctx.strokeStyle = `rgba(127,184,196,${alpha})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.ellipse(rip.x - s.frame + s.lastTrigger, rip.y, radius, radius * 0.5, 0, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Reset scrolling
            if (s.frame > 300) {
                s.frame = 0;
                s.lastTrigger = 0;
            }

            s.raf = requestAnimationFrame(draw);
        };

        ctx.fillStyle = 'rgb(3,3,3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        s.raf = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(s.raf);
        };
    }, [decay, damping]);

    return (
        <canvas
            ref={canvasRef}
            width={600}
            height={120}
            className="w-full h-full rounded-none"
            style={{ imageRendering: 'pixelated' }}
        />
    );
};
