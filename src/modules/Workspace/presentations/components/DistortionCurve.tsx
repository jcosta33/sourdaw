/**
 * DistortionCurve — Canvas2D waveshaper transfer function visualization.
 *
 * Draws the input→output transfer curve for a waveshaper distortion,
 * showing how the drive parameter clips the signal. Higher drive = more
 * aggressive S-curve. Uses 45° unity line as reference.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type DistortionCurveProps = {
    drive: number;      // 0–100
    tone: number;       // 200–8000 Hz (for display label only)
    mix: number;        // 0–1
    width?: number;
    height?: number;
};

/** Attempt to match the waveshaper curve used in deviceNodeFactory */
const waveshape = (x: number, drive: number): number => {
    const k = drive * 4; // amplify the effect
    if (k === 0) return x;
    return Math.tanh(x * k) / Math.tanh(k);
};

export const DistortionCurve = ({
    drive,
    tone: _tone,
    mix,
    width = 200,
    height = 120,
}: DistortionCurveProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        // Background
        const bg = resolveToken('--color-bg-tray', '#0a0a0a');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        const pad = 8;
        const gw = width - pad * 2;
        const gh = height - pad * 2;

        // Grid: unity line (45°)
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(pad, pad + gh);
        ctx.lineTo(pad + gw, pad);
        ctx.stroke();
        ctx.setLineDash([]);

        // Grid: center cross
        ctx.beginPath();
        ctx.moveTo(pad + gw / 2, pad);
        ctx.lineTo(pad + gw / 2, pad + gh);
        ctx.moveTo(pad, pad + gh / 2);
        ctx.lineTo(pad + gw, pad + gh / 2);
        ctx.stroke();

        // Compute transfer curve
        const accPeach = resolveToken('--color-accent-peach', '#f0a080');
        const normalizedDrive = drive / 100; // 0–1
        const points: [number, number][] = [];
        const steps = gw;

        for (let i = 0; i <= steps; i++) {
            const inputNorm = i / steps;             // 0–1
            const input = inputNorm * 2 - 1;         // -1 to +1
            const shaped = waveshape(input, normalizedDrive);
            // Blend with dry based on mix
            const blended = input * (1 - mix) + shaped * mix;
            const outputNorm = (blended + 1) / 2;    // back to 0–1
            const x = pad + i;
            const y = pad + gh - outputNorm * gh;
            points.push([x, y]);
        }

        // Fill under curve
        ctx.beginPath();
        ctx.moveTo(pad, pad + gh);
        for (const [x, y] of points) {
            ctx.lineTo(x, y);
        }
        ctx.lineTo(pad + gw, pad + gh);
        ctx.closePath();
        ctx.fillStyle = `${accPeach}14`;
        ctx.fill();

        // Stroke curve
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i]!;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = accPeach;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Labels
        ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('IN', pad, pad + gh + 9);
        ctx.textAlign = 'right';
        ctx.fillText('OUT', pad + gw, pad - 2);
    }, [drive, mix, width, height, _tone]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label="Distortion transfer curve"
            role="img"
        />
    );
};
