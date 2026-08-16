/**
 * LoudnessHistory — scrolling LUFS-over-time graph.
 *
 * Renders momentary LUFS as a filled area chart with target line.
 * Canvas-based for performance (updates ~10fps).
 */
import { type ReactElement, useRef, useEffect } from 'react';

type LoudnessHistoryProps = {
    /** Retained momentary-LUFS samples, oldest first. */
    samples: readonly number[];
    /** Slots the time axis spans, so a partial history draws at its true width. */
    capacity: number;
    /** Target LUFS for the platform. */
    targetLufs: number;
    /** Integrated LUFS (shown as reference line). */
    integratedLufs: number;
    width: number;
    height: number;
};

const MIN_DB = -60;
const MAX_DB = 0;

export const LoudnessHistory = ({
    samples,
    capacity,
    targetLufs,
    integratedLufs,
    width,
    height,
}: LoudnessHistoryProps): ReactElement => {
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

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
    }, [width, height]);

    useEffect(() => {
        const historyLength = samples.length;
        const readHistory = (i: number): number => samples[i] ?? 0;

        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const w = width;
        const h = height;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background — deep gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#0e0d13');
        bgGrad.addColorStop(0.5, '#09080d');
        bgGrad.addColorStop(1, '#060509');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Grid lines — subtle
        ctx.lineWidth = 0.5;
        for (const db of [-6, -12, -18, -24, -36, -48]) {
            const y = ((db - MAX_DB) / (MIN_DB - MAX_DB)) * h;
            ctx.strokeStyle = db === -24 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.035)';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Target line
        if (targetLufs > MIN_DB) {
            const ty = ((targetLufs - MAX_DB) / (MIN_DB - MAX_DB)) * h;
            ctx.save();
            ctx.shadowColor = 'rgba(76,200,200,0.25)';
            ctx.shadowBlur = 4;
            ctx.strokeStyle = 'rgba(76, 200, 200, 0.55)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, ty);
            ctx.lineTo(w, ty);
            ctx.stroke();
            ctx.restore();
            ctx.setLineDash([]);

            // Label
            ctx.fillStyle = 'rgba(76, 200, 200, 0.75)';
            ctx.font = '8px system-ui';
            ctx.fillText(`${targetLufs} LUFS`, 4, ty - 3);
        }

        // Integrated LUFS line
        if (integratedLufs > MIN_DB) {
            const iy = ((integratedLufs - MAX_DB) / (MIN_DB - MAX_DB)) * h;
            ctx.strokeStyle = 'rgba(178, 140, 255, 0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, iy);
            ctx.lineTo(w, iy);
            ctx.stroke();
        }

        // Draw momentary LUFS history as filled area
        if (historyLength > 1) {
            const stepX = w / capacity;
            const startX = w - historyLength * stepX;

            // Fill
            ctx.beginPath();
            ctx.moveTo(startX, h);
            for (let i = 0; i < historyLength; i++) {
                const x = startX + i * stepX;
                const lufs = Math.max(MIN_DB, Math.min(MAX_DB, readHistory(i)));
                const y = ((lufs - MAX_DB) / (MIN_DB - MAX_DB)) * h;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(startX + (historyLength - 1) * stepX, h);
            ctx.closePath();

            const gradient = ctx.createLinearGradient(0, 0, 0, h);
            gradient.addColorStop(0, 'rgba(76, 200, 200, 0.35)');
            gradient.addColorStop(0.4, 'rgba(76, 190, 190, 0.12)');
            gradient.addColorStop(1, 'rgba(76, 184, 184, 0.01)');
            ctx.fillStyle = gradient;
            ctx.fill();

            // Stroke — glow pass
            ctx.beginPath();
            for (let i = 0; i < historyLength; i++) {
                const x = startX + i * stepX;
                const lufs = Math.max(MIN_DB, Math.min(MAX_DB, readHistory(i)));
                const y = ((lufs - MAX_DB) / (MIN_DB - MAX_DB)) * h;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.save();
            ctx.shadowColor = 'rgba(76,210,210,0.4)';
            ctx.shadowBlur = 6;
            ctx.strokeStyle = 'rgba(76, 200, 200, 0.85)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
        }

        // dB scale labels
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '7px system-ui';
        ctx.textAlign = 'right';
        for (const db of [-6, -12, -18, -24, -36, -48]) {
            const y = ((db - MAX_DB) / (MIN_DB - MAX_DB)) * h;
            ctx.fillText(`${db}`, w - 3, y - 2);
        }
    }, [samples, capacity, targetLufs, integratedLufs, width, height]);

    return <canvas ref={canvasRef} style={{ width, height }} className="rounded" aria-label="Loudness history graph" />;
};
