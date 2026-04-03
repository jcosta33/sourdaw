/**
 * Compressor Transfer Curve — Canvas2D input/output graph.
 *
 * Draws the static transfer characteristic of a compressor:
 * - Unity line (1:1) in subtle gray
 * - The actual compression curve with threshold, ratio, and knee
 * - Threshold and knee indicators
 * Uses design tokens for consistent DAW aesthetic.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type CompressorCurveProps = {
    threshold: number; // dB, e.g. -20
    ratio: number; // e.g. 4 (meaning 4:1)
    knee: number; // dB, e.g. 6
    makeup: number; // dB, e.g. 0
    width?: number;
    height?: number;
    onParamChange?: (paramId: string, value: number) => void;
};

const DB_MIN = -60;
const DB_MAX = 0;

/** Compute output dB given input dB, with soft knee */
const computeOutput = (inputDb: number, threshold: number, ratio: number, kneeWidth: number): number => {
    const halfKnee = kneeWidth / 2;
    if (inputDb <= threshold - halfKnee) {
        // Below knee — unity
        return inputDb;
    } else if (inputDb >= threshold + halfKnee) {
        // Above knee — full compression
        return threshold + (inputDb - threshold) / ratio;
    } else {
        // In the knee — quadratic interpolation
        const x = inputDb - threshold + halfKnee;
        return inputDb + ((1 / ratio - 1) * x * x) / (2 * kneeWidth);
    }
};

export const CompressorCurve = ({
    threshold,
    ratio,
    knee,
    makeup,
    width = 120,
    height = 120,
    onParamChange,
}: CompressorCurveProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);
    const isInteractive = !!onParamChange;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const pad = 4;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;
        const dbToX = (db: number): number => pad + ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotW;
        const dbToY = (db: number): number => pad + plotH - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;

        ctx.clearRect(0, 0, width, height);

        // Background — deep gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#0e0e12');
        bgGrad.addColorStop(1, '#060608');
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        // Grid — subtle dotted
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1, 4]);
        for (const db of [-48, -36, -24, -12, 0]) {
            // Horizontal
            ctx.beginPath();
            ctx.moveTo(pad, dbToY(db));
            ctx.lineTo(width - pad, dbToY(db));
            ctx.stroke();
            // Vertical
            ctx.beginPath();
            ctx.moveTo(dbToX(db), pad);
            ctx.lineTo(dbToX(db), height - pad);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Unity line (1:1)
        ctx.beginPath();
        ctx.moveTo(dbToX(DB_MIN), dbToY(DB_MIN));
        ctx.lineTo(dbToX(DB_MAX), dbToY(DB_MAX));
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Compression curve
        const accentPeach = resolveToken('--color-accent-peach', '#f0944c');
        const curvePoints: [number, number][] = [];
        const steps = plotW;
        for (let i = 0; i <= steps; i++) {
            const inputDb = DB_MIN + (i / steps) * (DB_MAX - DB_MIN);
            const outputDb = Math.min(DB_MAX, computeOutput(inputDb, threshold, ratio, knee) + makeup);
            const x = dbToX(inputDb);
            const y = dbToY(Math.max(DB_MIN, outputDb));
            curvePoints.push([x, y]);
        }

        // Fill below curve — gradient
        ctx.beginPath();
        for (let i = 0; i < curvePoints.length; i++) {
            const [x, y] = curvePoints[i]!;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(dbToX(DB_MAX), dbToY(DB_MIN));
        ctx.lineTo(dbToX(DB_MIN), dbToY(DB_MIN));
        ctx.closePath();
        const curveFillGrad = ctx.createLinearGradient(0, pad, 0, pad + plotH);
        curveFillGrad.addColorStop(0, `${accentPeach}25`);
        curveFillGrad.addColorStop(1, `${accentPeach}05`);
        ctx.fillStyle = curveFillGrad;
        ctx.fill();

        // Glow pass
        ctx.beginPath();
        for (let i = 0; i < curvePoints.length; i++) {
            const [x, y] = curvePoints[i]!;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `${accentPeach}28`;
        ctx.lineWidth = 5;
        ctx.stroke();

        // Sharp stroke
        ctx.beginPath();
        for (let i = 0; i < curvePoints.length; i++) {
            const [x, y] = curvePoints[i]!;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = accentPeach;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Threshold marker
        const thX = dbToX(threshold);
        const thY = dbToY(computeOutput(threshold, threshold, ratio, knee) + makeup);
        ctx.beginPath();
        ctx.setLineDash([2, 2]);
        ctx.moveTo(thX, pad);
        ctx.lineTo(thX, height - pad);
        ctx.strokeStyle = `${accentPeach}60`;
        ctx.lineWidth = 0.75;
        ctx.stroke();
        ctx.setLineDash([]);

        // Threshold dot
        const dotRadius = isInteractive ? 5 : 3;
        ctx.beginPath();
        ctx.arc(thX, thY, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = accentPeach;
        ctx.fill();
        if (isInteractive) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Labels — very dim
        ctx.fillStyle = '#383838';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('IN', width / 2, height - 1);
        ctx.save();
        ctx.translate(6, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('OUT', 0, 0);
        ctx.restore();

        // Ratio text
        ctx.fillStyle = `${accentPeach}90`;
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${ratio.toFixed(1)}:1`, width - pad, pad + 10);

        // "drag to adjust" hint
        if (isInteractive && !isDragging.current) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '7px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('drag to adjust', width / 2, pad + 10);
        }
    }, [threshold, ratio, knee, makeup, width, height, isInteractive]);

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        isDragging.current = true;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange || !isDragging.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const pad = 4;
        const plotH = height - pad * 2;
        // Y position to dB: top = 0 dB, bottom = -60 dB
        const yRatio = (e.clientY - rect.top - pad) / plotH;
        const db = DB_MAX - yRatio * (DB_MAX - DB_MIN);
        const clamped = Math.max(-60, Math.min(0, db));
        onParamChange('comp-threshold', clamped);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        isDragging.current = false;
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = 'grab';
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: isInteractive ? 'grab' : undefined }}
            className="rounded border border-border/30"
            aria-label="Compressor transfer curve"
            role="img"
            onPointerDown={isInteractive ? handlePointerDown : undefined}
            onPointerMove={isInteractive ? handlePointerMove : undefined}
            onPointerUp={isInteractive ? handlePointerUp : undefined}
        />
    );
};
