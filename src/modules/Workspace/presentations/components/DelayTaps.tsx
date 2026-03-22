/**
 * Delay Tap Visualization — Canvas2D tap pattern display.
 *
 * Shows the delay feedback pattern as descending echo taps.
 * Each tap is a vertical bar whose height represents amplitude,
 * spaced by the delay time and decaying by the feedback amount.
 * Uses cyan accent (routing/secondary) for consistency.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type DelayTapsProps = {
    time: number; // ms, delay time
    feedback: number; // 0–0.95, feedback amount
    mix: number; // 0–1, dry/wet
    width?: number;
    height?: number;
};

export const DelayTaps = ({
    time,
    feedback,
    mix,
    width = 200,
    height = 50,
}: DelayTapsProps): ReactElement => {
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
        ctx.fillStyle = resolveToken('--color-bg-tray', '#0a0a0a');
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        const accentCyan = resolveToken('--color-accent-cyan', '#7fb8c4');
        const pad = 6;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;

        // How many taps can we show?
        const maxTaps = Math.min(12, Math.max(2, Math.floor(2000 / time)));
        const totalDuration = time * maxTaps;
        const barWidth = Math.max(2, Math.min(8, (plotW / maxTaps) * 0.4));

        // Draw baseline
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(pad, pad + plotH);
        ctx.lineTo(pad + plotW, pad + plotH);
        ctx.stroke();

        // Dry signal bar
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        const dryBarH = plotH * 0.9;
        ctx.fillRect(pad, pad + plotH - dryBarH, barWidth, dryBarH);

        // "D" label for dry
        ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
        ctx.font = '6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('D', pad + barWidth / 2, pad + plotH - dryBarH - 2);

        // Delay taps
        for (let tap = 1; tap <= maxTaps; tap++) {
            const amplitude = mix * Math.pow(feedback, tap);
            if (amplitude < 0.01) break;

            const tapTime = time * tap;
            const x = pad + (tapTime / totalDuration) * plotW;
            const barH = amplitude * plotH;

            // Gradient per tap: brighter at top
            const grad = ctx.createLinearGradient(0, pad + plotH - barH, 0, pad + plotH);
            grad.addColorStop(0, `${accentCyan}${Math.round(amplitude * 200).toString(16).padStart(2, '0')}`);
            grad.addColorStop(1, `${accentCyan}10`);
            ctx.fillStyle = grad;
            ctx.fillRect(x - barWidth / 2, pad + plotH - barH, barWidth, barH);

            // Top highlight
            ctx.fillStyle = `${accentCyan}${Math.round(amplitude * 180).toString(16).padStart(2, '0')}`;
            ctx.fillRect(x - barWidth / 2, pad + plotH - barH, barWidth, 1);
        }

        // Connecting decay envelope line
        ctx.beginPath();
        ctx.moveTo(pad + barWidth, pad + plotH - mix * plotH);
        for (let tap = 1; tap <= maxTaps; tap++) {
            const amplitude = mix * Math.pow(feedback, tap);
            if (amplitude < 0.01) break;
            const tapTime = time * tap;
            const x = pad + (tapTime / totalDuration) * plotW;
            const y = pad + plotH - amplitude * plotH;
            ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `${accentCyan}40`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Time label
        ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
        ctx.font = '7px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(time)}ms`, width - pad, height - 2);
    }, [time, feedback, mix, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label="Delay tap pattern"
            role="img"
        />
    );
};
