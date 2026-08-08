import { type ReactElement, useEffect, useRef } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type GlutenCurveProps = {
    threshold: number;
    ratio: number;
    knee: number;
    makeup: number;
    grDb: number;
    inputDb: number;
    width?: number;
    height?: number;
    /**
     * `isTransient` is true for every intermediate value of a drag and false for
     * the value the pointer settles on, matching `RotaryKnob`'s contract. The
     * owning view commits only the non-transient call, so one drag across the
     * curve is one undo entry rather than one per pointer-move.
     */
    onThresholdChange?: (value: number, isTransient: boolean) => void;
    accentColor?: string;
};

const DB_MIN = -60;
const DB_MAX = 0;

function computeOutput(inputDb: number, threshold: number, ratio: number, kneeWidth: number): number {
    const halfKnee = kneeWidth / 2;

    if (inputDb <= threshold - halfKnee) {
        return inputDb;
    }

    if (inputDb >= threshold + halfKnee) {
        return threshold + (inputDb - threshold) / ratio;
    }

    const x = inputDb - threshold + halfKnee;
    return inputDb + ((1 / ratio - 1) * x * x) / (2 * kneeWidth);
}

export const GlutenCurve = ({
    threshold,
    ratio,
    knee,
    makeup,
    grDb,
    inputDb,
    width = 340,
    height = 180,
    onThresholdChange,
    accentColor,
}: GlutenCurveProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef<'threshold' | null>(null);
    const draggedThreshold = useRef<number | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const pad = 10;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;
        const accent = resolveToken(accentColor ?? 'var(--color-accent-peach)', '#c9a07a');
        const dbToX = (db: number): number => pad + ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotW;
        const dbToY = (db: number): number => pad + plotH - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;

        ctx.clearRect(0, 0, width, height);

        const shell = ctx.createLinearGradient(0, 0, 0, height);
        shell.addColorStop(0, '#111015');
        shell.addColorStop(0.55, '#0c0b10');
        shell.addColorStop(1, '#07070a');
        ctx.fillStyle = shell;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 14);
        ctx.fill();

        const haze = ctx.createRadialGradient(
            width * 0.22,
            height * 0.08,
            0,
            width * 0.22,
            height * 0.08,
            width * 0.75
        );
        haze.addColorStop(0, `${accent}22`);
        haze.addColorStop(1, `${accent}00`);
        ctx.fillStyle = haze;
        ctx.fillRect(0, 0, width, height);

        ctx.lineWidth = 0.75;
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        for (const db of [-48, -36, -24, -12, 0]) {
            ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
            ctx.beginPath();
            ctx.moveTo(pad, dbToY(db));
            ctx.lineTo(width - pad, dbToY(db));
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(dbToX(db), pad);
            ctx.lineTo(dbToX(db), height - pad);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.fillText(`${db}`, dbToX(db), height - 2);
        }

        ctx.beginPath();
        ctx.moveTo(dbToX(DB_MIN), dbToY(DB_MIN));
        ctx.lineTo(dbToX(DB_MAX), dbToY(DB_MAX));
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        const steps = plotW * 2;
        for (let i = 0; i <= steps; i += 1) {
            const inDb = DB_MIN + (i / steps) * (DB_MAX - DB_MIN);
            const outDb = Math.min(DB_MAX, computeOutput(inDb, threshold, ratio, knee) + makeup);
            const x = dbToX(inDb);
            const y = dbToY(Math.max(DB_MIN, outDb));
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.lineTo(dbToX(DB_MAX), dbToY(DB_MAX));
        ctx.lineTo(dbToX(DB_MIN), dbToY(DB_MIN));
        ctx.closePath();
        ctx.fillStyle = `${accent}17`;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i <= steps; i += 1) {
            const inDb = DB_MIN + (i / steps) * (DB_MAX - DB_MIN);
            const outDb = Math.min(DB_MAX, computeOutput(inDb, threshold, ratio, knee) + makeup);
            const x = dbToX(inDb);
            const y = dbToY(Math.max(DB_MIN, outDb));
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();

        const thresholdX = dbToX(threshold);
        const thresholdY = dbToY(computeOutput(threshold, threshold, ratio, knee) + makeup);
        ctx.beginPath();
        ctx.setLineDash([3, 4]);
        ctx.moveTo(thresholdX, pad);
        ctx.lineTo(thresholdX, height - pad);
        ctx.strokeStyle = `${accent}66`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(thresholdX, thresholdY, 6.2, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.stroke();

        if (inputDb > -90) {
            const outDb = computeOutput(inputDb, threshold, ratio, knee) + makeup;
            const opX = dbToX(inputDb);
            const opY = dbToY(Math.max(DB_MIN, Math.min(DB_MAX, outDb)));

            const glow = ctx.createRadialGradient(opX, opY, 0, opX, opY, 16);
            glow.addColorStop(0, `${accent}55`);
            glow.addColorStop(1, `${accent}00`);
            ctx.fillStyle = glow;
            ctx.fillRect(opX - 16, opY - 16, 32, 32);

            ctx.beginPath();
            ctx.arc(opX, opY, 3.4, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }

        if (grDb < -0.1) {
            const meterWidth = 7;
            const meterHeight = Math.min(plotH, (-grDb / 30) * plotH);
            const meterX = width - pad - meterWidth;
            const meterY = pad;
            ctx.fillStyle = `${accent}88`;
            ctx.fillRect(meterX, meterY, meterWidth, meterHeight);
            ctx.fillStyle = accent;
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${grDb.toFixed(1)}`, meterX - 3, meterY + meterHeight + 11);
        }

        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = `${accent}cc`;
        ctx.fillText(ratio >= 20 ? '∞:1' : `${ratio.toFixed(1)}:1`, width - pad - 11, pad + 14);

        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = `${accent}99`;
        ctx.fillText(`T ${threshold.toFixed(0)} dB`, pad + 2, pad + 12);
    }, [accentColor, grDb, height, inputDb, knee, makeup, ratio, threshold, width]);

    function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
        if (!onThresholdChange) {
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        isDragging.current = 'threshold';
        draggedThreshold.current = null;
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
    }

    function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
        if (isDragging.current !== 'threshold' || !onThresholdChange) {
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const plotH = height - 20;
        const yRatio = (event.clientY - rect.top - 10) / plotH;
        const db = DB_MAX - yRatio * (DB_MAX - DB_MIN);
        const next = Math.max(-60, Math.min(0, db));
        draggedThreshold.current = next;
        onThresholdChange(next, true);
    }

    function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>): void {
        if (!onThresholdChange) {
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const wasDragging = isDragging.current === 'threshold';
        const settled = draggedThreshold.current;
        isDragging.current = null;
        draggedThreshold.current = null;
        canvas.releasePointerCapture(event.pointerId);
        canvas.style.cursor = 'grab';

        // The commit. A press that never moved has no settled value and must not
        // write anything — otherwise a stray click would land an undo entry that
        // changes nothing.
        if (wasDragging && settled !== null) {
            onThresholdChange(settled, false);
        }
    }

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{ width, height, cursor: onThresholdChange ? 'grab' : undefined }}
            className="rounded-[16px] border border-white/8"
            aria-label="Gluten compressor transfer curve"
            role="img"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        />
    );
};
