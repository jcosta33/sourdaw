/**
 * LoudnessHistory — scrolling LUFS-over-time graph.
 *
 * Renders momentary LUFS as a filled area chart with target line.
 * Canvas-based for performance (updates ~10fps).
 */
import { type ReactElement, useRef, useEffect } from 'react';

type LoudnessHistoryProps = {
    /** Current momentary LUFS value. */
    momentaryLufs: number;
    /** Target LUFS for the platform. */
    targetLufs: number;
    /** Integrated LUFS (shown as reference line). */
    integratedLufs: number;
    width: number;
    height: number;
};

const HISTORY_LENGTH = 300; // ~30 seconds at 10fps
const MIN_DB = -60;
const MAX_DB = 0;

export const LoudnessHistory = ({ momentaryLufs, targetLufs, integratedLufs, width, height }: LoudnessHistoryProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const historyRef = useRef<number[]>([]);

    useEffect(() => {
        const history = historyRef.current;
        history.push(momentaryLufs);
        if (history.length > HISTORY_LENGTH) {
            history.shift();
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const w = width;
        const h = height;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        for (const db of [-6, -12, -18, -24, -36, -48]) {
            const y = ((db - MAX_DB) / (MIN_DB - MAX_DB)) * h;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Target line
        if (targetLufs > MIN_DB) {
            const ty = ((targetLufs - MAX_DB) / (MIN_DB - MAX_DB)) * h;
            ctx.strokeStyle = 'rgba(76, 184, 184, 0.5)'; // accent-cyan
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, ty);
            ctx.lineTo(w, ty);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label
            ctx.fillStyle = 'rgba(76, 184, 184, 0.7)';
            ctx.font = '8px system-ui';
            ctx.fillText(`${targetLufs} LUFS`, 4, ty - 3);
        }

        // Integrated LUFS line
        if (integratedLufs > MIN_DB) {
            const iy = ((integratedLufs - MAX_DB) / (MIN_DB - MAX_DB)) * h;
            ctx.strokeStyle = 'rgba(168, 130, 255, 0.4)'; // accent-lavender
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, iy);
            ctx.lineTo(w, iy);
            ctx.stroke();
        }

        // Draw momentary LUFS history as filled area
        if (history.length > 1) {
            const stepX = w / HISTORY_LENGTH;
            const startX = w - history.length * stepX;

            // Fill
            ctx.beginPath();
            ctx.moveTo(startX, h);
            for (let i = 0; i < history.length; i++) {
                const x = startX + i * stepX;
                const lufs = Math.max(MIN_DB, Math.min(MAX_DB, history[i]!));
                const y = ((lufs - MAX_DB) / (MIN_DB - MAX_DB)) * h;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(startX + (history.length - 1) * stepX, h);
            ctx.closePath();

            const gradient = ctx.createLinearGradient(0, 0, 0, h);
            gradient.addColorStop(0, 'rgba(76, 184, 184, 0.3)');
            gradient.addColorStop(1, 'rgba(76, 184, 184, 0.02)');
            ctx.fillStyle = gradient;
            ctx.fill();

            // Stroke
            ctx.beginPath();
            for (let i = 0; i < history.length; i++) {
                const x = startX + i * stepX;
                const lufs = Math.max(MIN_DB, Math.min(MAX_DB, history[i]!));
                const y = ((lufs - MAX_DB) / (MIN_DB - MAX_DB)) * h;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(76, 184, 184, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // dB scale labels
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '7px system-ui';
        ctx.textAlign = 'right';
        for (const db of [-6, -12, -18, -24, -36, -48]) {
            const y = ((db - MAX_DB) / (MIN_DB - MAX_DB)) * h;
            ctx.fillText(`${db}`, w - 3, y - 2);
        }
    }, [momentaryLufs, targetLufs, integratedLufs, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded"
            aria-label="Loudness history graph"
        />
    );
};
