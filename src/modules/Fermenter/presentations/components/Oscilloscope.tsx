/**
 * Real-time oscilloscope for Fermenter.
 * Renders the last 128 samples as a waveform on a canvas.
 */
import { type ReactElement, useRef, useEffect } from 'react';

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
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Background
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, width, height);

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Waveform
        if (!buffer || buffer.length === 0) {
            // Draw flat line when no signal
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();
            return;
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();

        const step = buffer.length / width;
        for (let i = 0; i < width; i++) {
            const idx = Math.floor(i * step);
            const sample = buffer[idx] ?? 0;
            const y = ((1 - sample) / 2) * height;
            if (i === 0) {
                ctx.moveTo(i, y);
            } else {
                ctx.lineTo(i, y);
            }
        }
        ctx.stroke();

        // Glow effect
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }, [buffer, width, height, color]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded-md"
        />
    );
};
