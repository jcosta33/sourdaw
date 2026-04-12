/**
 * Real-time oscilloscope for Fermenter.
 * Renders the last 128 samples as a waveform on a canvas.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/utils/UI/resolveToken';

type OscilloscopeProps = {
    buffer: Float32Array | null;
    width?: number;
    height?: number;
    color?: string;
};

export const Oscilloscope = ({
    buffer,
    width = 200,
    height = 64,
    color = 'var(--color-accent-lavender)',
}: OscilloscopeProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {return;}
        const ctx = canvas.getContext('2d');
        if (!ctx) {return;}

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Resolve CSS variable color to hex for canvas
        const resolvedColor = color.startsWith('var(') ? resolveToken(color.slice(4, -1), '#a882ff') : color;

        // Background — deep gradient
        ctx.clearRect(0, 0, width, height);
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, 'rgba(12,10,18,0.85)');
        bgGrad.addColorStop(1, 'rgba(6,5,10,0.85)');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Subtle grid lines at 25% and 75%
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        for (const frac of [0.25, 0.75]) {
            ctx.beginPath();
            ctx.moveTo(0, height * frac);
            ctx.lineTo(width, height * frac);
            ctx.stroke();
        }

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Waveform
        if (!buffer || buffer.length === 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();
            return;
        }

        const step = buffer.length / width;

        // Glow pass (wide, soft)
        ctx.save();
        ctx.shadowColor = resolvedColor;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = resolvedColor;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.35;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < width; i++) {
            const idx = Math.floor(i * step);
            const sample = buffer[idx] ?? 0;
            const y = ((1 - sample) / 2) * height;
            if (i === 0) {ctx.moveTo(i, y);}
            else {ctx.lineTo(i, y);}
        }
        ctx.stroke();
        ctx.restore();

        // Crisp pass
        ctx.strokeStyle = resolvedColor;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < width; i++) {
            const idx = Math.floor(i * step);
            const sample = buffer[idx] ?? 0;
            const y = ((1 - sample) / 2) * height;
            if (i === 0) {ctx.moveTo(i, y);}
            else {ctx.lineTo(i, y);}
        }
        ctx.stroke();
    }, [buffer, width, height, color]);

    return <canvas ref={canvasRef} style={{ width, height }} className="rounded-md" />;
};
