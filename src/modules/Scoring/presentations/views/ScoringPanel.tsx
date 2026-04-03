import { type ReactElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { Activity, Waves } from 'lucide-react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type DisplayMode } from '../../models/ScoringState';
import { scoringStore, setA4Reference, setDisplayMode } from '../../stores/scoringStore';

const MODES: ReadonlyArray<{ id: DisplayMode; label: string; detail: string }> = [
    { id: 'needle', label: 'Needle', detail: 'Classic center read' },
    { id: 'strobe', label: 'Strobe', detail: 'Motion lock' },
    { id: 'poly', label: 'Poly', detail: 'String spread' },
];

const GUITAR_STRINGS = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] as const;

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }): ReactElement {
    return (
        <div className="scoring-window flex min-w-[88px] flex-col gap-1 px-3 py-2">
            <span className="text-[8px] uppercase tracking-[0.24em] text-white/48">{label}</span>
            <span className="font-mono text-[13px] text-white/88">{value}</span>
            <span className="text-[9px] text-white/42">{detail}</span>
        </div>
    );
}

function SectionCard({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactElement | ReactElement[];
}): ReactElement {
    return (
        <section className="scoring-window flex flex-col gap-3 p-3">
            <div className="flex items-center justify-between gap-2">
                <div className="text-[8px] font-semibold uppercase tracking-[0.24em] text-[var(--color-accent-mint)]/72">
                    {title}
                </div>
                {detail ? <div className="scoring-led">{detail}</div> : null}
            </div>
            {children}
        </section>
    );
}

export const ScoringPanel = (): ReactElement => {
    const state = useSyncExternalStore(
        (callback) => scoringStore.subscribe(callback),
        () => scoringStore.value
    );

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-xs italic text-muted-foreground/40">
                Sharpening the blade...
            </div>
        );
    }

    const { noteName, octave, cents, confidence, active, mode, a4Reference, frequency } = state;
    const absoluteCents = Math.abs(cents);
    const toneColor = !active
        ? 'text-white/28'
        : absoluteCents <= 2
          ? 'text-emerald-400'
          : absoluteCents <= 10
            ? 'text-yellow-400'
            : 'text-red-400';
    const centerGlow = !active
        ? 'rgba(255,255,255,0.06)'
        : absoluteCents <= 2
          ? 'rgba(52,220,160,0.18)'
          : absoluteCents <= 10
            ? 'rgba(255,210,30,0.16)'
            : 'rgba(255,100,100,0.14)';

    return (
        <div className="scoring-faceplate flex h-full min-h-0 gap-3 overflow-hidden p-3">
            <aside className="flex h-full w-[232px] shrink-0 flex-col gap-3 overflow-y-auto pr-1">
                <SectionCard title="Display" detail={mode}>
                    <div>
                        <div className="text-[18px] font-semibold text-white/92">Scoring</div>
                        <div className="mt-1 text-[11px] text-white/44">
                            Tuning mode, reference pitch, and quick read stay docked here.
                        </div>
                    </div>
                    <div className="grid gap-2">
                        {MODES.map((entry) => {
                            const selected = mode === entry.id;
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    className={`scoring-window flex items-center justify-between gap-3 px-3 py-2 text-left transition-all ${
                                        selected
                                            ? 'border-white/16 bg-white/[0.03]'
                                            : 'hover:border-white/12 hover:bg-white/[0.02]'
                                    }`}
                                    onClick={() => setDisplayMode(entry.id)}
                                >
                                    <div>
                                        <div className="text-[11px] font-medium text-white/88">{entry.label}</div>
                                        <div className="text-[9px] text-white/42">{entry.detail}</div>
                                    </div>
                                    {selected ? <div className="scoring-led">Live</div> : null}
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>

                <SectionCard title="Reference" detail={`${a4Reference} Hz`}>
                    <div className="flex items-center justify-center">
                        <RotaryKnob
                            value={a4Reference}
                            onChange={(value) => setA4Reference(Math.round(value))}
                            min={400}
                            max={490}
                            step={1}
                            defaultValue={440}
                            size="md"
                        />
                    </div>
                    <div className="text-center">
                        <div className="font-mono text-[16px] text-white/88">{a4Reference} Hz</div>
                        <div className="text-[10px] uppercase tracking-[0.22em] text-white/42">Concert A</div>
                    </div>
                </SectionCard>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                <header className="scoring-window flex shrink-0 flex-wrap items-center gap-2.5 px-3 py-2">
                    <div className="space-y-1">
                        <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-mint)]/72">
                            Tuning deck
                        </div>
                        <div className="text-[14px] font-semibold text-white/92">
                            {active ? `${noteName}${octave}` : 'Waiting for pitch'}
                        </div>
                    </div>
                    <div className="ml-auto flex flex-wrap gap-2">
                        <MetricTile
                            label="Cents"
                            value={active ? `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}` : '—'}
                            detail="Offset"
                        />
                        <MetricTile
                            label="Pitch"
                            value={active ? `${frequency.toFixed(1)} Hz` : '—'}
                            detail="Detected"
                        />
                        <MetricTile label="Conf" value={`${Math.round(confidence * 100)}%`} detail="Tracker" />
                    </div>
                </header>

                <div className="grid min-h-0 shrink-0 grid-cols-[minmax(0,1fr)_220px] gap-3">
                    <div className="scoring-window min-h-[280px] overflow-hidden">
                        <div
                            className="flex h-full min-h-0 flex-col px-4 py-4 transition-colors duration-300"
                            style={{
                                background: `radial-gradient(circle at 50% 50%, ${centerGlow}, transparent 56%)`,
                            }}
                        >
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="text-[9px] uppercase tracking-[0.24em] text-white/42">Main read</div>
                                <div className="scoring-led">{active ? 'Tracking' : 'Idle'}</div>
                            </div>
                            <div className="grid min-h-0 flex-1 grid-cols-[140px_minmax(0,1fr)_120px] items-center gap-4">
                                <div className="flex flex-col items-center gap-1">
                                    <div
                                        className={`text-6xl font-bold tracking-tight transition-colors duration-200 ${toneColor}`}
                                    >
                                        {active ? noteName : '—'}
                                    </div>
                                    <div className="text-xl text-white/42">{active ? octave : ''}</div>
                                </div>

                                <div className="min-h-0">
                                    {mode === 'needle' ? (
                                        <NeedleDisplay cents={cents} active={active} confidence={confidence} />
                                    ) : mode === 'strobe' ? (
                                        <StrobeDisplay cents={cents} active={active} />
                                    ) : (
                                        <PolyDisplay />
                                    )}
                                </div>

                                <div className="flex flex-col items-center gap-1">
                                    <div
                                        className={`font-mono text-3xl font-semibold transition-colors duration-200 ${toneColor}`}
                                    >
                                        {active ? `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}` : '—'}
                                    </div>
                                    <div className="text-[9px] uppercase tracking-[0.24em] text-white/42">Cents</div>
                                    <div className="font-mono text-[10px] text-white/38">
                                        {active ? `${frequency.toFixed(1)} Hz` : 'No input'}
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3 h-[56px] shrink-0 overflow-hidden rounded-[14px] border border-white/8 bg-black/24">
                                <HistoryGraph cents={cents} active={active} />
                            </div>
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                        <SectionCard title="Quick read" detail={active ? 'Signal up' : 'No signal'}>
                            <div className="space-y-2 text-[10px] leading-4 text-white/56">
                                <div className="flex items-center justify-between gap-2">
                                    <span>Mode</span>
                                    <span className="font-mono text-white/84">{mode}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span>Reference</span>
                                    <span className="font-mono text-white/84">{a4Reference} Hz</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span>Status</span>
                                    <span className="font-mono text-white/84">{active ? 'Locked' : 'Listening'}</span>
                                </div>
                            </div>
                        </SectionCard>

                        <SectionCard title="Guide" detail="Center">
                            <div className="grid gap-2">
                                <div className="scoring-window flex items-center justify-between gap-2 px-3 py-2">
                                    <div className="flex items-center gap-2 text-[10px] text-white/56">
                                        <Activity className="size-3.5 text-[var(--color-accent-mint)]" />
                                        Tight zone
                                    </div>
                                    <div className="font-mono text-[11px] text-white/82">±2c</div>
                                </div>
                                <div className="scoring-window flex items-center justify-between gap-2 px-3 py-2">
                                    <div className="flex items-center gap-2 text-[10px] text-white/56">
                                        <Waves className="size-3.5 text-[var(--color-accent-cyan)]" />
                                        Usable zone
                                    </div>
                                    <div className="font-mono text-[11px] text-white/82">±10c</div>
                                </div>
                            </div>
                        </SectionCard>
                    </div>
                </div>
            </section>
        </div>
    );
};

const NeedleDisplay = ({
    cents,
    active,
    confidence,
}: {
    cents: number;
    active: boolean;
    confidence: number;
}): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        const background = ctx.createRadialGradient(
            width / 2,
            height * 0.85,
            0,
            width / 2,
            height * 0.85,
            height * 0.9
        );
        background.addColorStop(0, 'rgba(12,14,18,0.3)');
        background.addColorStop(1, 'rgba(4,4,6,0)');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        const centerX = width / 2;
        const centerY = height * 0.85;
        const radius = height * 0.7;
        const maxAngle = Math.PI * 0.4;

        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, Math.PI + maxAngle, -maxAngle, false);
        ctx.stroke();

        const zones = [
            { range: 2, color: 'rgba(52,220,160,0.18)' },
            { range: 10, color: 'rgba(255,210,30,0.12)' },
            { range: 50, color: 'rgba(255,100,100,0.08)' },
        ];

        for (const zone of zones) {
            const zoneAngle = (zone.range / 50) * maxAngle;
            ctx.fillStyle = zone.color;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius + 5, Math.PI * 1.5 - zoneAngle, Math.PI * 1.5 + zoneAngle, false);
            ctx.closePath();
            ctx.fill();
        }

        ctx.save();
        ctx.shadowColor = 'rgba(52,220,160,0.4)';
        ctx.shadowBlur = 6;
        ctx.strokeStyle = 'rgba(52,220,160,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const topX = centerX;
        const topY = centerY - radius - 8;
        ctx.moveTo(topX, topY);
        ctx.lineTo(topX, topY + 12);
        ctx.stroke();
        ctx.restore();

        if (active) {
            const angle = Math.PI * 1.5 + (cents / 50) * maxAngle;
            const needleLength = radius * 0.9;
            const needleX = centerX + Math.cos(angle) * needleLength;
            const needleY = centerY + Math.sin(angle) * needleLength;

            ctx.save();
            ctx.shadowColor = 'rgba(255,255,255,0.25)';
            ctx.shadowBlur = 6;
            ctx.strokeStyle = `rgba(255,255,255,${0.35 + confidence * 0.65})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(needleX, needleY);
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.shadowColor = 'rgba(255,255,255,0.5)';
            ctx.shadowBlur = 8;
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(needleX, needleY, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
        ctx.fill();
    }, [cents, active, confidence]);

    return <canvas ref={canvasRef} width={480} height={200} className="h-full w-full" />;
};

const StrobeDisplay = ({ cents, active }: { cents: number; active: boolean }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const phaseRef = useRef(0);
    const rafRef = useRef(0);

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
            const width = canvas.width;
            const height = canvas.height;
            const velocity = active ? Math.sign(cents) * Math.sqrt(Math.abs(cents)) * 0.15 : 0;
            const effectiveVelocity = Math.abs(cents) < 0.1 ? 0 : velocity;
            phaseRef.current += effectiveVelocity * 0.016;

            const background = ctx.createLinearGradient(0, 0, 0, height);
            background.addColorStop(0, 'rgb(4,4,6)');
            background.addColorStop(1, 'rgb(2,2,3)');
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, width, height);

            if (!active) {
                ctx.fillStyle = 'rgba(255,255,255,0.06)';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Waiting for signal...', width / 2, height / 2);
                rafRef.current = requestAnimationFrame(draw);
                return;
            }

            const stripeCount = 24;
            for (let x = 0; x < width; x += 1) {
                const u = x / width + phaseRef.current;
                const t = u * stripeCount;
                const fraction = t - Math.floor(t);
                const intensity = 1 - Math.abs(2 * fraction - 1);
                const powered = Math.pow(intensity, 2.5);
                const nearZero = Math.abs(cents) < 2;
                const red = nearZero ? Math.floor(powered * 30) : Math.floor(powered * 210);
                const green = nearZero ? Math.floor(powered * 220) : Math.floor(powered * 210);
                const blue = nearZero ? Math.floor(powered * 140) : Math.floor(powered * 220);
                ctx.fillStyle = `rgb(${red},${green},${blue})`;
                ctx.fillRect(x, 0, 1, height);
            }

            if (Math.abs(cents) < 0.5) {
                ctx.save();
                ctx.shadowColor = 'rgba(52,220,160,0.3)';
                ctx.shadowBlur = 8;
                ctx.strokeStyle = 'rgba(52,220,160,0.35)';
                ctx.lineWidth = 2;
                const cageWidth = width * 0.15;
                ctx.strokeRect(width / 2 - cageWidth / 2, 2, cageWidth, height - 4);
                ctx.restore();
            }

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, [cents, active]);

    return <canvas ref={canvasRef} width={480} height={180} className="h-full w-full" />;
};

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
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const width = canvas.width;
        const height = canvas.height;
        const background = ctx.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, 'rgb(8,8,11)');
        background.addColorStop(1, 'rgb(4,4,6)');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        for (const fraction of [0.25, 0.75]) {
            ctx.beginPath();
            ctx.moveTo(0, height * fraction);
            ctx.lineTo(width, height * fraction);
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(52,220,160,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        const history = historyRef.current;
        if (history.length < 2) {
            return;
        }

        ctx.save();
        ctx.shadowColor = 'rgba(130,200,220,0.3)';
        ctx.shadowBlur = 4;
        ctx.strokeStyle = 'rgba(140,200,220,0.65)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let index = 0; index < history.length; index += 1) {
            const x = (index / 300) * width;
            const y = height / 2 - ((history[index] ?? 0) / 50) * (height / 2);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = 'rgba(140,200,220,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let index = 0; index < history.length; index += 1) {
            const x = (index / 300) * width;
            const y = height / 2 - ((history[index] ?? 0) / 50) * (height / 2);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }, [cents, active]);

    return <canvas ref={canvasRef} width={720} height={56} className="h-full w-full" />;
};

const PolyDisplay = (): ReactElement => {
    return (
        <div className="flex h-full flex-col justify-center gap-2 px-4">
            {GUITAR_STRINGS.map((label) => (
                <div key={label} className="flex items-center gap-2">
                    <span className="w-6 text-right font-mono text-[10px] text-white/52">{label}</span>
                    <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-black/28">
                        <div className="absolute bottom-0 left-1/2 top-0 w-px bg-emerald-500/20" />
                    </div>
                    <span className="w-10 text-right font-mono text-[8px] text-white/36">—</span>
                </div>
            ))}
            <span className="mt-1 text-center text-[8px] text-white/34">Strum all open strings</span>
        </div>
    );
};
