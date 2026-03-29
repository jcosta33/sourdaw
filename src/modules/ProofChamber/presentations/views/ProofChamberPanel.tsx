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
    type ProofChamberParams,
    DEFAULT_PARAMS,
    SPACE_PRESETS,
    PARAM_MAP,
} from '../../models/ProofChamberPatch';

const SPACES: { id: SpaceType; label: string }[] = [
    { id: 'hall', label: 'Hall' },
    { id: 'room', label: 'Room' },
    { id: 'plate', label: 'Plate' },
    { id: 'chamber', label: 'Chamber' },
    { id: 'cathedral', label: 'Cathedral' },
    { id: 'shimmer', label: 'Shimmer' },
    { id: 'infinite', label: 'Infinite' },
];

type ProofChamberPanelProps = {
    deviceId?: string;
    onParamChange?: (paramId: string, value: number) => void;
};

export const ProofChamberPanel = ({ onParamChange }: ProofChamberPanelProps): ReactElement => {
    const [params, setParams] = useState<ProofChamberParams>({ ...DEFAULT_PARAMS });

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
        const newParams = { ...DEFAULT_PARAMS, ...preset, space };
        setParams(newParams);
        // Send all preset params to engine
        if (onParamChange) {
            for (const [key, val] of Object.entries(newParams)) {
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
                <div className="w-16" /> {/* spacer */}
            </div>

            {/* ─── Spectrogram hero ─── */}
            <div className="flex-1 min-h-[60px] shrink border-b border-border/20">
                <ReverbSpectrogram decay={params.decay} damping={params.damping} />
            </div>

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
};

const KnobStack = ({ label, value, onChange, min, max, step, defaultValue, size, display }: KnobStackProps): ReactElement => (
    <div className="flex flex-col items-center gap-0">
        <RotaryKnob value={value} onChange={onChange} min={min} max={max} step={step} defaultValue={defaultValue} size={size} />
        <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider leading-tight">{label}</span>
        {display ? (
            <span className="text-[6px] text-muted-foreground/40 tabular-nums">{display}</span>
        ) : null}
    </div>
);

// ── Spectrogram visualization ───────────────────────────────────────

const ReverbSpectrogram = ({ decay, damping }: { decay: number; damping: number }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef(0);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const draw = (): void => {
            const w = canvas.width;
            const h = canvas.height;
            frameRef.current++;

            // Shift existing image left by 1 pixel (scrolling spectrogram)
            const imageData = ctx.getImageData(1, 0, w - 1, h);
            ctx.putImageData(imageData, 0, 0);

            // Draw new column on the right
            const t = frameRef.current;
            for (let y = 0; y < h; y++) {
                // Frequency: bottom = low, top = high (log scale simulation)
                const freqNorm = 1.0 - y / h; // 0 at top, 1 at bottom

                // Decay visualization: higher frequencies decay faster with more damping
                const freqDecayMult = 1.0 + damping * freqNorm * 3.0;
                const amplitude = Math.exp(-t * 0.005 * (1.0 - decay * 0.95) * freqDecayMult);

                // Add some randomness for texture
                const noise = Math.random() * 0.15;
                const val = Math.min(1, amplitude * 0.8 + noise * amplitude);

                // Color: cyan-tinted for the theme
                const r = Math.floor(val * 40);
                const g = Math.floor(val * 140);
                const b = Math.floor(val * 170);
                const a = Math.floor(val * 255);

                ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
                ctx.fillRect(w - 1, y, 1, 1);
            }

            // Reset every ~5 seconds to keep the visualization dynamic
            if (frameRef.current > 300) {
                frameRef.current = 0;
            }

            rafRef.current = requestAnimationFrame(draw);
        };

        // Initial fill with black
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        rafRef.current = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(rafRef.current);
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
