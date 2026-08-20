import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Activity, Waves } from 'lucide-react';

import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { createCompactFloatBuffer } from '#/utils/createCompactFloatBuffer';

import {
    A4_REFERENCE_PARAM_ID,
    DEFAULT_A4_REFERENCE_HZ,
    MAX_A4_REFERENCE_HZ,
    MIN_A4_REFERENCE_HZ,
} from '../../models/A4Reference';
import { tunerStore, getTunerState, type DisplayMode } from '../../stores/tunerStore';
import { setA4Reference } from '../../useCases/setA4Reference';
import { setDisplayMode } from '../../useCases/setDisplayMode';

const MODES: ReadonlyArray<{ id: DisplayMode; label: string; detail: string }> = [
    { id: 'needle', label: 'Needle', detail: 'Classic center read' },
    { id: 'strobe', label: 'Strobe', detail: 'Motion lock' },
    { id: 'poly', label: 'Poly', detail: 'String spread' },
];

const GUITAR_STRINGS = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] as const;

const ANNOUNCE_DEBOUNCE_MS = 750;

/**
 * The reference this device's DSP is actually tuning to.
 *
 * Read from the authoritative device row rather than from `tunerStore` so the
 * readout cannot disagree with the engine: `a4_hz` is what the worklet was sent
 * and what a strip rebuild replays, and a panel-local mirror would survive
 * neither a project reload nor an undo. Returns a plain number so
 * `useStoreSelector`'s `Object.is` cache holds across unrelated track edits.
 */
function selectA4Reference(state: TrackStoreState | null, deviceId: string): number {
    for (const track of state?.tracks ?? []) {
        for (const device of track.devices) {
            if (device.id === deviceId) {
                return device.parameterValues[A4_REFERENCE_PARAM_ID] ?? DEFAULT_A4_REFERENCE_HZ;
            }
        }
    }

    return DEFAULT_A4_REFERENCE_HZ;
}

/**
 * Returns the latest `message` only after it has stayed unchanged for
 * ANNOUNCE_DEBOUNCE_MS. Telemetry pushes note/cents updates at display rate
 * (the producer polls via requestAnimationFrame, ~60/s on a 60 Hz display);
 * feeding every tick straight into an aria-live region would flood assistive
 * tech. Debouncing announces a stable read instead of a blur of intermediate
 * values.
 */
function useDebouncedAnnouncement(message: string): string {
    const [announced, setAnnounced] = useState(message);

    useEffect(() => {
        const timer = setTimeout(() => setAnnounced(message), ANNOUNCE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [message]);

    return announced;
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
        <DawPluginSectionCard
            className="scoring-window"
            title={title}
            detail={detail}
            detailMode="badge"
            titleClassName="text-[var(--color-accent-indigo)]/72"
            detailClassName="text-[var(--color-accent-indigo)]"
        >
            {children}
        </DawPluginSectionCard>
    );
}

export const TunerPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    // Subscribe to this device's instance only — a whole-record subscription would
    // re-render every mounted TunerPanel on any device's telemetry tick (the
    // producer polls via requestAnimationFrame, ~60/s on a 60 Hz display).
    const state = useStoreSelector(tunerStore, (instances) => instances?.[deviceId] ?? getTunerState(deviceId));
    const storedA4Reference = useStoreSelector(trackStore, (tracks) => selectA4Reference(tracks, deviceId));
    // Held only for the duration of a knob drag. The transient half of
    // `setA4Reference` deliberately writes the engine and not the project, so
    // the device row does not move until release — without a local preview the
    // three "Hz" readouts would sit at the old reference while the engine is
    // already tuning to the new one. `null` means "not dragging": the moment the
    // gesture commits, the authoritative device row takes back over, so an undo
    // or a peer edit cannot be masked by a stale preview.
    const [previewA4Reference, setPreviewA4Reference] = useState<number | null>(null);
    const a4Reference = previewA4Reference ?? storedA4Reference;

    const { noteName, octave, cents, confidence, active, mode, frequency } = state;
    // The worklet emits confidence in [0,1] by contract, but nothing between the SAB
    // read and here enforces it. Clamp before any display use so the Conf tile cannot
    // read e.g. 120% and the needle alpha stays in range.
    const displayConfidence = Math.max(0, Math.min(1, confidence));
    const absoluteCents = Math.abs(cents);
    let toneColor: string;
    if (!active) {
        toneColor = 'text-white/28';
    } else if (absoluteCents <= 2) {
        toneColor = 'text-emerald-400';
    } else if (absoluteCents <= 10) {
        toneColor = 'text-yellow-400';
    } else {
        toneColor = 'text-red-400';
    }
    let centerGlow: string;
    if (!active) {
        centerGlow = 'rgba(255,255,255,0.06)';
    } else if (absoluteCents <= 2) {
        centerGlow = 'rgba(52,220,160,0.18)';
    } else if (absoluteCents <= 10) {
        centerGlow = 'rgba(255,210,30,0.16)';
    } else {
        centerGlow = 'rgba(255,100,100,0.14)';
    }

    let displayComponent = <PolyDisplay />;
    if (mode === 'needle') {
        displayComponent = <NeedleDisplay cents={cents} active={active} confidence={displayConfidence} />;
    } else if (mode === 'strobe') {
        displayComponent = <StrobeDisplay cents={cents} active={active} />;
    }

    // Debounced live announcement of the current read. Telemetry ticks at display
    // rate (~60/s on a 60 Hz display via the producer's requestAnimationFrame poll);
    // an un-debounced aria-live region would flood assistive tech with note/cents
    // updates. Settle for ANNOUNCE_DEBOUNCE_MS of quiet before announcing.
    const liveMessage = active
        ? `${noteName}${octave}, ${cents >= 0 ? 'sharp' : 'flat'} ${Math.abs(cents).toFixed(0)} cents`
        : 'Waiting for pitch';
    const announced = useDebouncedAnnouncement(liveMessage);

    return (
        <Row align="stretch" gap={3} className="scoring-faceplate h-full min-h-0 overflow-hidden p-3">
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {announced}
            </div>
            <Stack as="aside" gap={3} shrink={false} className="h-full w-[232px] overflow-y-auto pr-1">
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
                                    aria-pressed={selected}
                                    aria-label={`${entry.label} display mode`}
                                    className={`scoring-window flex items-center justify-between gap-3 px-3 py-2 text-left transition-all ${
                                        selected
                                            ? 'border-white/16 bg-white/[0.03]'
                                            : 'hover:border-white/12 hover:bg-white/[0.02]'
                                    }`}
                                    onClick={() => setDisplayMode(deviceId, entry.id)}
                                >
                                    <div>
                                        <div className="text-[11px] font-medium text-white/88">{entry.label}</div>
                                        <div className="text-[9px] text-white/42">{entry.detail}</div>
                                    </div>
                                    {selected ? <DawPluginLed tone="mint">Live</DawPluginLed> : null}
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>

                <SectionCard title="Reference" detail={`${a4Reference} Hz`}>
                    <Row justify="center">
                        <RotaryKnob
                            value={a4Reference}
                            onChange={(value, isTransient) => {
                                // Whole hertz: the descriptor declares `a4_hz`
                                // continuous, so the panel is what quantises,
                                // and a fractional reference would land in the
                                // project file.
                                const hz = Math.round(value);
                                if (isTransient) {
                                    setPreviewA4Reference(hz);
                                    setA4Reference(deviceId, hz, true);
                                    return;
                                }
                                setPreviewA4Reference(null);
                                setA4Reference(deviceId, hz, false);
                            }}
                            min={MIN_A4_REFERENCE_HZ}
                            max={MAX_A4_REFERENCE_HZ}
                            step={1}
                            defaultValue={DEFAULT_A4_REFERENCE_HZ}
                            size="md"
                            tone="indigo"
                        />
                    </Row>
                    <div className="text-center">
                        <div className="font-mono text-[16px] text-white/88">{a4Reference} Hz</div>
                        <div className="text-[10px] uppercase tracking-[0.22em] text-white/42">Concert A</div>
                    </div>
                </SectionCard>
            </Stack>

            <Stack as="section" gap={3} grow className="min-w-0 overflow-y-auto pr-1">
                <Row as="header" wrap gap={2.5} shrink={false} className="scoring-window px-3 py-2">
                    <Stack gap={1}>
                        <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-indigo)]/72">
                            Tuning deck
                        </div>
                        <div className="text-[14px] font-semibold text-white/92">
                            {active ? `${noteName}${octave}` : 'Waiting for pitch'}
                        </div>
                    </Stack>
                    <Row wrap align="stretch" gap={2} className="ml-auto">
                        <DawPluginMetricTile
                            className="scoring-window min-w-[88px]"
                            labelClassName="text-white/48"
                            valueClassName="text-white/88"
                            detailClassName="text-white/42"
                            label="Cents"
                            value={active ? `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}` : '—'}
                            detail="Offset"
                        />
                        <DawPluginMetricTile
                            className="scoring-window min-w-[88px]"
                            labelClassName="text-white/48"
                            valueClassName="text-white/88"
                            detailClassName="text-white/42"
                            label="Pitch"
                            value={active ? `${frequency.toFixed(1)} Hz` : '—'}
                            detail="Detected"
                        />
                        <DawPluginMetricTile
                            className="scoring-window min-w-[88px]"
                            labelClassName="text-white/48"
                            valueClassName="text-white/88"
                            detailClassName="text-white/42"
                            label="Conf"
                            value={`${Math.round(displayConfidence * 100)}%`}
                            detail="Tracker"
                        />
                    </Row>
                </Row>

                <div className="grid min-h-0 shrink-0 grid-cols-[minmax(0,1fr)_220px] gap-3">
                    <div className="scoring-window min-h-[280px] overflow-hidden">
                        <Stack
                            className="h-full px-4 py-4 transition-colors duration-300"
                            style={{
                                background: `radial-gradient(circle at 50% 50%, ${centerGlow}, transparent 56%)`,
                            }}
                        >
                            <Row justify="between" gap={3} className="mb-3">
                                <div className="text-[9px] uppercase tracking-[0.24em] text-white/42">Main read</div>
                                <DawPluginLed tone="mint">{active ? 'Tracking' : 'Idle'}</DawPluginLed>
                            </Row>
                            <div className="grid min-h-0 flex-1 grid-cols-[140px_minmax(0,1fr)_120px] items-center gap-4">
                                <Stack align="center" gap={1}>
                                    <div
                                        className={`text-6xl font-bold tracking-tight transition-colors duration-200 ${toneColor}`}
                                    >
                                        {active ? noteName : '—'}
                                    </div>
                                    <div className="text-xl text-white/42">{active ? octave : ''}</div>
                                </Stack>

                                <div className="min-h-0">{displayComponent}</div>

                                <Stack align="center" gap={1}>
                                    <div
                                        className={`font-mono text-3xl font-semibold transition-colors duration-200 ${toneColor}`}
                                    >
                                        {active ? `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}` : '—'}
                                    </div>
                                    <div className="text-[9px] uppercase tracking-[0.24em] text-white/42">Cents</div>
                                    <div className="font-mono text-[10px] text-white/38">
                                        {active ? `${frequency.toFixed(1)} Hz` : 'No input'}
                                    </div>
                                </Stack>
                            </div>
                            <div className="mt-3 h-[56px] shrink-0 overflow-hidden rounded-[14px] border border-white/8 bg-black/24">
                                <HistoryGraph cents={cents} active={active} />
                            </div>
                        </Stack>
                    </div>

                    <Stack gap={3} className="overflow-y-auto pr-1">
                        <SectionCard title="Quick read" detail={active ? 'Signal up' : 'No signal'}>
                            <Stack gap={2} className="text-[10px] leading-4 text-white/56">
                                <Row justify="between" gap={2}>
                                    <span>Mode</span>
                                    <span className="font-mono text-white/84">{mode}</span>
                                </Row>
                                <Row justify="between" gap={2}>
                                    <span>Reference</span>
                                    <span className="font-mono text-white/84">{a4Reference} Hz</span>
                                </Row>
                                <Row justify="between" gap={2}>
                                    <span>Status</span>
                                    <span className="font-mono text-white/84">{active ? 'Locked' : 'Listening'}</span>
                                </Row>
                            </Stack>
                        </SectionCard>

                        <SectionCard title="Guide" detail="Center">
                            <div className="grid gap-2">
                                <Row justify="between" gap={2} className="scoring-window px-3 py-2">
                                    <Row gap={2} className="text-[10px] text-white/56">
                                        <Activity className="size-3.5 text-[var(--color-accent-mint)]" />
                                        Tight zone
                                    </Row>
                                    <div className="font-mono text-[11px] text-white/82">±2c</div>
                                </Row>
                                <Row justify="between" gap={2} className="scoring-window px-3 py-2">
                                    <Row gap={2} className="text-[10px] text-white/56">
                                        <Waves className="size-3.5 text-[var(--color-accent-cyan)]" />
                                        Usable zone
                                    </Row>
                                    <div className="font-mono text-[11px] text-white/82">±10c</div>
                                </Row>
                            </div>
                        </SectionCard>
                    </Stack>
                </div>
            </Stack>
        </Row>
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
    const centsRef = useRef(cents);
    const activeRef = useRef(active);
    const confidenceRef = useRef(confidence);
    const rafRef = useRef(0);

    useEffect(() => {
        centsRef.current = cents;
        activeRef.current = active;
        confidenceRef.current = confidence;
    }, [cents, active, confidence]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        // Handle high-DPI displays
        const dpr = window.devicePixelRatio || 1;
        const logicalWidth = 480;
        const logicalHeight = 200;
        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;
        ctx.scale(dpr, dpr);

        const draw = (): void => {
            const currentCents = centsRef.current;
            const currentActive = activeRef.current;
            const currentConfidence = confidenceRef.current;

            const width = logicalWidth;
            const height = logicalHeight;
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

            if (currentActive) {
                const angle = Math.PI * 1.5 + (currentCents / 50) * maxAngle;
                const needleLength = radius * 0.9;
                const needleX = centerX + Math.cos(angle) * needleLength;
                const needleY = centerY + Math.sin(angle) * needleLength;

                ctx.save();
                ctx.shadowColor = 'rgba(255,255,255,0.25)';
                ctx.shadowBlur = 6;
                ctx.strokeStyle = `rgba(255,255,255,${0.35 + currentConfidence * 0.65})`;
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

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: 480, height: 200 }}
            className="h-full w-full"
            role="img"
            aria-label="Needle tuner display"
            data-testid="tuner-needle-display"
        />
    );
};

const StrobeDisplay = ({ cents, active }: { cents: number; active: boolean }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const phaseRef = useRef(0);
    const rafRef = useRef(0);
    const centsRef = useRef(cents);
    const activeRef = useRef(active);

    useEffect(() => {
        centsRef.current = cents;
        activeRef.current = active;
    }, [cents, active]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        // Handle high-DPI displays
        const dpr = window.devicePixelRatio || 1;
        const logicalWidth = 480;
        const logicalHeight = 180;
        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;
        ctx.scale(dpr, dpr);

        let imageData: ImageData | null = null;

        const draw = (): void => {
            const width = logicalWidth;
            const height = logicalHeight;
            const currentCents = centsRef.current;
            const currentActive = activeRef.current;
            const velocity = currentActive ? Math.sign(currentCents) * Math.sqrt(Math.abs(currentCents)) * 0.15 : 0;
            const effectiveVelocity = Math.abs(currentCents) < 0.1 ? 0 : velocity;
            phaseRef.current += effectiveVelocity * 0.016;

            if (!currentActive) {
                const background = ctx.createLinearGradient(0, 0, 0, height);
                background.addColorStop(0, 'rgb(4,4,6)');
                background.addColorStop(1, 'rgb(2,2,3)');
                ctx.fillStyle = background;
                ctx.fillRect(0, 0, width, height);

                ctx.fillStyle = 'rgba(255,255,255,0.06)';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Waiting for signal...', width / 2, height / 2);
                rafRef.current = requestAnimationFrame(draw);
                return;
            }

            if (!imageData || imageData.width !== canvas.width || imageData.height !== canvas.height) {
                imageData = ctx.createImageData(canvas.width, canvas.height);
            }

            const data = imageData.data;
            const stripeCount = 24;
            const absCents = Math.abs(currentCents);
            const nearZero = absCents < 2;

            // Render to high-DPI imageData buffer
            const physicalWidth = canvas.width;
            const physicalHeight = canvas.height;

            for (let x = 0; x < physicalWidth; x += 1) {
                const u = x / physicalWidth + phaseRef.current;
                const t = u * stripeCount;
                const fraction = t - Math.floor(t);
                const intensity = 1 - Math.abs(2 * fraction - 1);
                const powered = intensity ** 2.5;

                const r = nearZero ? Math.floor(powered * 30) : Math.floor(powered * 210);
                const g = nearZero ? Math.floor(powered * 220) : Math.floor(powered * 210);
                const b = nearZero ? Math.floor(powered * 140) : Math.floor(powered * 220);

                for (let y = 0; y < physicalHeight; y += 1) {
                    const idx = (y * physicalWidth + x) * 4;
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = 255;
                }
            }
            ctx.putImageData(imageData, 0, 0);

            if (absCents < 0.5) {
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
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: 480, height: 180 }}
            className="h-full w-full"
            role="img"
            aria-label="Strobe tuner display"
        />
    );
};

const HISTORY_GRAPH_WINDOW = 300;

const HistoryGraph = ({ cents, active }: { cents: number; active: boolean }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const historyRef = useRef<Float32Array>(createCompactFloatBuffer({ length: HISTORY_GRAPH_WINDOW }));
    const posRef = useRef(0);
    const centsRef = useRef(cents);
    const activeRef = useRef(active);
    const rafRef = useRef(0);

    useEffect(() => {
        centsRef.current = cents;
        activeRef.current = active;
    }, [cents, active]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        // Handle high-DPI displays
        const dpr = window.devicePixelRatio || 1;
        const logicalWidth = 720;
        const logicalHeight = 56;
        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;
        ctx.scale(dpr, dpr);

        const draw = (): void => {
            const currentCents = centsRef.current;
            const currentActive = activeRef.current;
            const history = historyRef.current;

            if (currentActive) {
                history[posRef.current % HISTORY_GRAPH_WINDOW] = currentCents;
                posRef.current++;
            }

            const historyLength = Math.min(posRef.current, HISTORY_GRAPH_WINDOW);
            const pos = posRef.current;
            const readHistory = (i: number): number => history[(pos - historyLength + i) % HISTORY_GRAPH_WINDOW]!;

            const width = logicalWidth;
            const height = logicalHeight;
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

            if (historyLength >= 2) {
                // Single shadowed trace of the pitch history. A previous revision walked
                // this same moveTo/lineTo path twice (a shadowed pass then a plain pass),
                // doubling per-frame path cost for a barely-perceptible second stroke; the
                // shadowed pass alone carries the glow and the visible line.
                ctx.save();
                ctx.shadowColor = 'rgba(130,200,220,0.3)';
                ctx.shadowBlur = 4;
                ctx.strokeStyle = 'rgba(140,200,220,0.7)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let index = 0; index < historyLength; index += 1) {
                    const x = (index / HISTORY_GRAPH_WINDOW) * width;
                    const y = height / 2 - (readHistory(index) / 50) * (height / 2);
                    if (index === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
                ctx.restore();
            }

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: 720, height: 56 }}
            className="h-full w-full"
            role="img"
            aria-label="Pitch history graph"
        />
    );
};

const PolyDisplay = (): ReactElement => {
    return (
        <Stack justify="center" gap={2} className="h-full px-4">
            {GUITAR_STRINGS.map((label) => (
                <Row key={label} gap={2}>
                    <span className="w-6 text-right font-mono text-[10px] text-white/52">{label}</span>
                    <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-black/28">
                        <div className="absolute bottom-0 left-1/2 top-0 w-px bg-emerald-500/20" />
                    </div>
                    <span className="w-10 text-right font-mono text-[8px] text-white/36">—</span>
                </Row>
            ))}
            <span className="mt-1 text-center text-[8px] text-white/34">Strum all open strings</span>
        </Stack>
    );
};
