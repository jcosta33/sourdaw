/**
 * Gluten Transfer Curve — interactive compressor characteristic display.
 *
 * Shows: static I/O curve, threshold dot, real-time GR meter bar,
 * operating point. Drag threshold dot to adjust.
 * Uses same visual language as existing CompressorCurve but larger and richer.
 */
import { type ReactElement, useRef, useEffect, useCallback } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type GlutenCurveProps = {
    threshold: number;
    ratio: number;
    knee: number;
    makeup: number;
    grDb: number;
    inputDb: number;
    width?: number;
    height?: number;
    onThresholdChange?: (value: number) => void;
    onRatioChange?: (value: number) => void;
    accentColor?: string;
};

const DB_MIN = -60;
const DB_MAX = 0;

const computeOutput = (inputDb: number, threshold: number, ratio: number, kneeWidth: number): number => {
    const halfKnee = kneeWidth / 2;
    if (inputDb <= threshold - halfKnee) {
        return inputDb;
    } else if (inputDb >= threshold + halfKnee) {
        return threshold + (inputDb - threshold) / ratio;
    } else {
        const x = inputDb - threshold + halfKnee;
        return inputDb + ((1 / ratio - 1) * x * x) / (2 * kneeWidth);
    }
};

export const GlutenCurve = ({
    threshold,
    ratio,
    knee,
    makeup,
    grDb,
    inputDb,
    width = 280,
    height = 200,
    onThresholdChange,
    onRatioChange,
    accentColor,
}: GlutenCurveProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef<'threshold' | 'ratio' | null>(null);
    const lastY = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const pad = 8;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;
        const dbToX = (db: number): number => pad + ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotW;
        const dbToY = (db: number): number => pad + plotH - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;

        ctx.clearRect(0, 0, width, height);

        // Background — deep gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#0f0e12');
        bgGrad.addColorStop(0.5, '#0a090d');
        bgGrad.addColorStop(1, '#07060a');
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 6);
        ctx.fill();

        // Grid lines — subtle
        ctx.lineWidth = 0.5;
        for (const db of [-48, -36, -24, -12, 0]) {
            ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)';
            ctx.beginPath();
            ctx.moveTo(pad, dbToY(db));
            ctx.lineTo(width - pad, dbToY(db));
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(dbToX(db), pad);
            ctx.lineTo(dbToX(db), height - pad);
            ctx.stroke();
        }

        // Grid labels
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        for (const db of [-48, -36, -24, -12]) {
            ctx.fillText(`${db}`, dbToX(db), height - 1);
        }
        ctx.fillText('0', dbToX(0), height - 1);

        // Unity line (1:1)
        ctx.beginPath();
        ctx.moveTo(dbToX(DB_MIN), dbToY(DB_MIN));
        ctx.lineTo(dbToX(DB_MAX), dbToY(DB_MAX));
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        const accent = accentColor ?? resolveToken('--color-accent-peach', '#c4987b');

        // Gain reduction zone (shaded area between unity and curve)
        ctx.beginPath();
        const steps = plotW * 2;
        for (let i = 0; i <= steps; i++) {
            const inDb = DB_MIN + (i / steps) * (DB_MAX - DB_MIN);
            const outDb = Math.min(DB_MAX, computeOutput(inDb, threshold, ratio, knee) + makeup);
            const x = dbToX(inDb);
            const y = dbToY(Math.max(DB_MIN, outDb));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(dbToX(DB_MAX), dbToY(DB_MAX));
        ctx.lineTo(dbToX(DB_MIN), dbToY(DB_MIN));
        ctx.closePath();
        ctx.fillStyle = `${accent}18`;
        ctx.fill();

        // Compression curve — glow pass
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const inDb = DB_MIN + (i / steps) * (DB_MAX - DB_MIN);
            const outDb = Math.min(DB_MAX, computeOutput(inDb, threshold, ratio, knee) + makeup);
            const x = dbToX(inDb);
            const y = dbToY(Math.max(DB_MIN, outDb));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        // Compression curve — crisp pass
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Threshold vertical line
        const thX = dbToX(threshold);
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(thX, pad);
        ctx.lineTo(thX, height - pad);
        ctx.strokeStyle = `${accent}50`;
        ctx.lineWidth = 0.75;
        ctx.stroke();
        ctx.setLineDash([]);

        // Threshold dot (interactive)
        const thY = dbToY(computeOutput(threshold, threshold, ratio, knee) + makeup);
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(thX, thY, 6, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Real-time operating point
        if (inputDb > -90) {
            const opOutDb = computeOutput(inputDb, threshold, ratio, knee) + makeup;
            const opX = dbToX(inputDb);
            const opY = dbToY(Math.max(DB_MIN, Math.min(DB_MAX, opOutDb)));

            // Operating point glow
            const grad = ctx.createRadialGradient(opX, opY, 0, opX, opY, 12);
            grad.addColorStop(0, `${accent}40`);
            grad.addColorStop(1, `${accent}00`);
            ctx.fillStyle = grad;
            ctx.fillRect(opX - 12, opY - 12, 24, 24);

            // Operating point dot
            ctx.beginPath();
            ctx.arc(opX, opY, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }

        // GR meter bar (right side)
        if (grDb < -0.1) {
            const meterW = 6;
            const meterX = width - pad - meterW;
            const meterH = Math.min(plotH, (-grDb / 30) * plotH);
            const meterY = pad;

            ctx.fillStyle = `${accent}60`;
            ctx.fillRect(meterX, meterY, meterW, meterH);

            // GR text
            ctx.fillStyle = accent;
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${grDb.toFixed(1)}`, meterX - 2, meterY + meterH + 10);
        }

        // Ratio label
        ctx.fillStyle = `${accent}90`;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';
        const ratioText = ratio >= 20 ? '∞:1' : `${ratio.toFixed(1)}:1`;
        ctx.fillText(ratioText, width - pad - 10, pad + 14);

        // Threshold label
        ctx.fillStyle = `${accent}70`;
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`T: ${threshold.toFixed(0)} dB`, pad + 2, pad + 12);

    }, [threshold, ratio, knee, makeup, grDb, inputDb, width, height, accentColor]);

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onThresholdChange && !onRatioChange) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        isDragging.current = 'threshold';
        lastY.current = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
    }, [onThresholdChange, onRatioChange]);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDragging.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (isDragging.current === 'threshold' && onThresholdChange) {
            const rect = canvas.getBoundingClientRect();
            const plotH = height - 16;
            const yRatio = (e.clientY - rect.top - 8) / plotH;
            const db = DB_MAX - yRatio * (DB_MAX - DB_MIN);
            onThresholdChange(Math.max(-60, Math.min(0, db)));
        }
    }, [onThresholdChange, height]);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        isDragging.current = null;
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = 'grab';
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: (onThresholdChange || onRatioChange) ? 'grab' : undefined }}
            className="rounded-lg border border-border/20"
            aria-label="Gluten compressor transfer curve"
            role="img"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        />
    );
};
