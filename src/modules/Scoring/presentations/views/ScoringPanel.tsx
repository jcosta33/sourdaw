/**
 * ScoringPanel — chromatic tuner UI.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Top: [Scoring] · [Needle|Strobe] mode · [A4=440Hz]              │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  [Note: C#4]   [Needle/Strobe visualization]   [±cents: +3.2]  │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  [History graph — cents over time]                               │
 *   └──────────────────────────────────────────────────────────────────┘
 */
import { type ReactElement, useRef, useEffect, useSyncExternalStore } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { scoringStore, setDisplayMode, setA4Reference } from '../../stores/scoringStore';
import { type DisplayMode } from '../../models/ScoringState';

const MODES: { id: DisplayMode; label: string }[] = [
    { id: 'needle', label: 'Needle' },
    { id: 'strobe', label: 'Strobe' },
    { id: 'poly', label: 'Poly' },
];

export const ScoringPanel = (): ReactElement => {
    const state = useSyncExternalStore(
        (cb) => scoringStore.subscribe(cb),
        () => scoringStore.value,
    );

    if (!state) {
        return <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs italic">Sharpening the blade...</div>;
    }

    const { noteName, octave, cents, confidence, active, mode, a4Reference, frequency } = state;

    // Color based on cents deviation
    const absCents = Math.abs(cents);
    const color = !active ? 'text-muted-foreground/30'
        : absCents <= 2 ? 'text-emerald-400'
        : absCents <= 10 ? 'text-yellow-400'
        : 'text-red-400';

    const bgColor = !active ? 'bg-transparent'
        : absCents <= 2 ? 'bg-emerald-500/10'
        : absCents <= 10 ? 'bg-yellow-500/10'
        : 'bg-red-500/10';

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
                <span className="text-[10px] font-bold text-[var(--color-accent-mint)] tracking-tight">
                    Scoring
                </span>

                {/* Mode selector */}
                <div className="flex gap-0.5 bg-surface-base/50 rounded p-0.5">
                    {MODES.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                                mode === id
                                    ? 'bg-[var(--color-accent-mint)] text-white'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setDisplayMode(id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* A4 reference */}
                <div className="flex items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">A4=</span>
                    <RotaryKnob
                        value={a4Reference}
                        onChange={(v) => setA4Reference(Math.round(v))}
                        min={400}
                        max={490}
                        step={1}
                        defaultValue={440}
                        size="sm"
                    />
                    <span className="text-[8px] text-muted-foreground tabular-nums">{a4Reference}Hz</span>
                </div>
            </div>

            {/* ─── Main display ─── */}
            <div className={`flex-1 flex items-center justify-center gap-6 ${bgColor} transition-colors duration-300`}>
                {/* Note name — large */}
                <div className="flex flex-col items-center gap-0">
                    <span className={`text-5xl font-bold tracking-tight transition-colors duration-200 ${color}`}>
                        {active ? noteName : '—'}
                    </span>
                    <span className="text-lg text-muted-foreground/60 -mt-1">
                        {active ? octave : ''}
                    </span>
                </div>

                {/* Visualization */}
                <div className="flex-1 max-w-[400px] h-full">
                    {mode === 'needle' ? (
                        <NeedleDisplay cents={cents} active={active} confidence={confidence} />
                    ) : mode === 'strobe' ? (
                        <StrobeDisplay cents={cents} active={active} />
                    ) : (
                        <PolyDisplay />
                    )}
                </div>

                {/* Cents display */}
                <div className="flex flex-col items-center gap-0 min-w-[80px]">
                    <span className={`text-2xl font-bold tabular-nums transition-colors duration-200 ${color}`}>
                        {active ? `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}` : '—'}
                    </span>
                    <span className="text-[8px] text-muted-foreground/40 uppercase">cents</span>
                    {active ? (
                        <span className="text-[9px] text-muted-foreground/30 tabular-nums mt-1">
                            {frequency.toFixed(1)} Hz
                        </span>
                    ) : null}
                </div>
            </div>

            {/* ─── History graph ─── */}
            <div className="h-[40px] shrink-0 border-t border-border/20">
                <HistoryGraph cents={cents} active={active} />
            </div>
        </div>
    );
};

// ── Needle display ──────────────────────────────────────────────────

const NeedleDisplay = ({ cents, active, confidence }: { cents: number; active: boolean; confidence: number }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) { return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h * 0.85;
        const radius = h * 0.7;

        // Draw arc
        const maxAngle = Math.PI * 0.4;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI + maxAngle, -maxAngle, false);
        ctx.stroke();

        // Color zones
        const zones = [
            { range: 2, color: 'rgba(52,211,153,0.15)' },  // green
            { range: 10, color: 'rgba(250,204,21,0.1)' },   // yellow
            { range: 50, color: 'rgba(248,113,113,0.08)' },  // red
        ];

        for (const zone of zones) {
            const zoneAngle = (zone.range / 50) * maxAngle;
            ctx.fillStyle = zone.color;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius + 5, Math.PI / 2 * 3 - zoneAngle, Math.PI / 2 * 3 + zoneAngle, false);
            ctx.closePath();
            ctx.fill();
        }

        // Center mark
        ctx.strokeStyle = 'rgba(52,211,153,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const topX = cx;
        const topY = cy - radius - 8;
        ctx.moveTo(topX, topY);
        ctx.lineTo(topX, topY + 12);
        ctx.stroke();

        // Needle
        if (active) {
            const angle = Math.PI / 2 * 3 + (cents / 50) * maxAngle;
            const needleLen = radius * 0.9;
            const nx = cx + Math.cos(angle) * needleLen;
            const ny = cy + Math.sin(angle) * needleLen;

            ctx.strokeStyle = `rgba(255,255,255,${0.3 + confidence * 0.7})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(nx, ny);
            ctx.stroke();

            // Needle tip dot
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(nx, ny, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Center pivot
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
    }, [cents, active, confidence]);

    return <canvas ref={canvasRef} width={400} height={160} className="w-full h-full" />;
};

// ── Strobe display ──────────────────────────────────────────────────

const StrobeDisplay = ({ cents, active }: { cents: number; active: boolean }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const phaseRef = useRef(0);
    const rafRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) { return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }

        const draw = (): void => {
            const w = canvas.width;
            const h = canvas.height;

            // Strobe motion: sqrt scaling for perceptual sensitivity
            const velocity = active
                ? Math.sign(cents) * Math.sqrt(Math.abs(cents)) * 0.15
                : 0;

            // Lock zone: freeze at ±0.1 cent
            const effectiveVelocity = Math.abs(cents) < 0.1 ? 0 : velocity;

            phaseRef.current += effectiveVelocity * 0.016; // ~60fps

            ctx.fillStyle = 'rgb(3,3,3)';
            ctx.fillRect(0, 0, w, h);

            if (!active) {
                ctx.fillStyle = 'rgba(255,255,255,0.05)';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Waiting for signal…', w / 2, h / 2);
                rafRef.current = requestAnimationFrame(draw);
                return;
            }

            // Draw strobe stripes
            const numStripes = 24;
            for (let x = 0; x < w; x++) {
                const u = x / w + phaseRef.current;
                const t = u * numStripes;
                const frac = t - Math.floor(t);
                const intensity = 1.0 - Math.abs(2.0 * frac - 1.0);
                const powered = Math.pow(intensity, 2.5);

                // Green when near zero, white otherwise
                const nearZero = Math.abs(cents) < 2;
                const r = nearZero ? Math.floor(powered * 40) : Math.floor(powered * 200);
                const g = nearZero ? Math.floor(powered * 200) : Math.floor(powered * 200);
                const b = nearZero ? Math.floor(powered * 120) : Math.floor(powered * 200);

                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(x, 0, 1, h);
            }

            // Center cage overlay (when near in-tune)
            if (Math.abs(cents) < 0.5) {
                ctx.strokeStyle = 'rgba(52,211,153,0.3)';
                ctx.lineWidth = 2;
                const cageW = w * 0.15;
                ctx.strokeRect(w / 2 - cageW / 2, 2, cageW, h - 4);
            }

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, [cents, active]);

    return <canvas ref={canvasRef} width={400} height={120} className="w-full h-full" />;
};

// ── History graph ───────────────────────────────────────────────────

const HistoryGraph = ({ cents, active }: { cents: number; active: boolean }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const historyRef = useRef<number[]>([]);

    useEffect(() => {
        if (active) {
            historyRef.current.push(cents);
            if (historyRef.current.length > 300) {
                historyRef.current.shift();
            }
        }

        const canvas = canvasRef.current;
        if (!canvas) { return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }

        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = 'rgb(5,5,5)';
        ctx.fillRect(0, 0, w, h);

        // Center line (0 cents)
        ctx.strokeStyle = 'rgba(52,211,153,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // History line
        const history = historyRef.current;
        if (history.length < 2) { return; }

        ctx.strokeStyle = 'rgba(127,184,196,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
            const x = (i / 300) * w;
            const y = h / 2 - ((history[i] ?? 0) / 50) * (h / 2);
            if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
    }, [cents, active]);

    return <canvas ref={canvasRef} width={600} height={40} className="w-full h-full" />;
};

// ── Polyphonic string display ───────────────────────────────────────

const GUITAR_STRINGS = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

const PolyDisplay = (): ReactElement => {
    // In a full implementation, this would read from the scoring store's poly data.
    // For now, show the string labels with placeholder indicators.
    return (
        <div className="flex flex-col justify-center gap-1 px-4 h-full">
            {GUITAR_STRINGS.map((label) => {
                const stringCents = 0; // would come from store
                const stringActive = false;
                const absCents = Math.abs(stringCents);
                const barColor = !stringActive ? 'bg-muted-foreground/10'
                    : absCents <= 2 ? 'bg-emerald-500'
                    : absCents <= 10 ? 'bg-yellow-500'
                    : 'bg-red-500';

                return (
                    <div key={label} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground/60 w-6 text-right font-mono">{label}</span>
                        <div className="flex-1 h-3 bg-surface-base/50 rounded-full relative overflow-hidden">
                            {/* Center line */}
                            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-emerald-500/20" />
                            {/* Deviation indicator */}
                            {stringActive ? (
                                <div
                                    className={`absolute top-0 bottom-0 w-2 rounded-full ${barColor} transition-all duration-100`}
                                    style={{
                                        left: `${50 + (stringCents / 50) * 50}%`,
                                        transform: 'translateX(-50%)',
                                    }}
                                />
                            ) : null}
                        </div>
                        <span className="text-[8px] text-muted-foreground/40 w-10 text-right tabular-nums">
                            {stringActive ? `${stringCents >= 0 ? '+' : ''}${stringCents.toFixed(1)}` : '—'}
                        </span>
                    </div>
                );
            })}
            <span className="text-[7px] text-muted-foreground/30 text-center mt-1">Strum all open strings</span>
        </div>
    );
};
