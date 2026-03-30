/**
 * GR History — scrolling FabFilter-style gain reduction waveform display.
 *
 * Renders a canvas that scrolls left as new GR values arrive,
 * showing the last ~5 seconds of gain reduction over time.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type GrHistoryProps = {
    grDb: number;
    width?: number;
    height?: number;
    accentColor?: string;
};

const HISTORY_LENGTH = 256;
const DB_RANGE = 30; // 0 to -30 dB

export const GrHistory = ({
    grDb,
    width = 400,
    height = 60,
    accentColor,
}: GrHistoryProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const historyRef = useRef<Float32Array>(new Float32Array(HISTORY_LENGTH));
    const posRef = useRef(0);

    useEffect(() => {
        // Push new value
        historyRef.current[posRef.current % HISTORY_LENGTH] = grDb;
        posRef.current++;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const accent = accentColor ?? resolveToken('--color-accent-peach', '#c4987b');

        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = resolveToken('--color-bg-tray', '#0a0a0a');
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        // Grid lines at -6, -12, -18, -24 dB
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        for (const db of [-6, -12, -18, -24]) {
            const y = (-db / DB_RANGE) * height;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw GR history as filled area from top
        const history = historyRef.current;
        const pos = posRef.current;
        const colW = width / HISTORY_LENGTH;

        // Gradient fill
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        // Canvas requires actual color values, not CSS variables.
        // Ensure we have a valid hex color before appending alpha.
        const safeAccent = accent.startsWith('#') ? accent : '#c9a07a';
        grad.addColorStop(0, `${safeAccent}80`);
        grad.addColorStop(1, `${safeAccent}10`);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (let i = 0; i < HISTORY_LENGTH; i++) {
            const idx = (pos - HISTORY_LENGTH + i + HISTORY_LENGTH * 2) % HISTORY_LENGTH;
            const gr = history[idx] ?? 0;
            const barH = Math.min(height, Math.max(0, (-gr / DB_RANGE) * height));
            const x = i * colW;
            ctx.lineTo(x, barH);
        }
        ctx.lineTo(width, 0);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Outline
        ctx.beginPath();
        for (let i = 0; i < HISTORY_LENGTH; i++) {
            const idx = (pos - HISTORY_LENGTH + i + HISTORY_LENGTH * 2) % HISTORY_LENGTH;
            const gr = history[idx] ?? 0;
            const barH = Math.min(height, Math.max(0, (-gr / DB_RANGE) * height));
            const x = i * colW;
            if (i === 0) ctx.moveTo(x, barH);
            else ctx.lineTo(x, barH);
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Current value label
        if (grDb < -0.1) {
            ctx.fillStyle = accent;
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${grDb.toFixed(1)} dB`, width - 4, 12);
        }

    }, [grDb, width, height, accentColor]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/20"
            aria-label="Gain reduction history"
            role="img"
        />
    );
};
