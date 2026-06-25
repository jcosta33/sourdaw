/**
 * Gain Reduction meter — vertical bar with peak hold and dB labels.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type GrMeterProps = {
    grDb: number;
    inputDb: number;
    outputDb: number;
    width?: number;
    height?: number;
    accentColor?: string;
    /** Accessible name for this meter instance — disambiguates multiple open panels. */
    label?: string;
};

export const GrMeter = ({
    grDb,
    inputDb,
    outputDb,
    width = 60,
    height = 160,
    accentColor,
    label = 'Gain reduction meter',
}: GrMeterProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const peakHoldRef = useRef(0);
    const peakTimerRef = useRef(0);

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

        const accent = resolveToken(accentColor ?? 'var(--color-accent-peach)', '#c4987b');

        ctx.clearRect(0, 0, width, height);

        // Background — deep gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#0f0e12');
        bgGrad.addColorStop(0.5, '#0a090d');
        bgGrad.addColorStop(1, '#07060a');
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        const meterTop = 20;
        const meterBottom = height - 4;
        const meterHeight = meterBottom - meterTop;
        const barWidth = 10;

        // GR meter (center) — grows downward from top
        const grBarH = Math.min(meterHeight, Math.max(0, (-grDb / 30) * meterHeight));
        const grX = (width - barWidth) / 2;

        // GR bar gradient with glow
        if (grBarH > 0) {
            const grad = ctx.createLinearGradient(0, meterTop, 0, meterTop + grBarH);
            grad.addColorStop(0, `${accent}ee`);
            grad.addColorStop(0.6, `${accent}88`);
            grad.addColorStop(1, `${accent}30`);
            ctx.save();
            ctx.shadowColor = accent;
            ctx.shadowBlur = 8;
            ctx.fillStyle = grad;
            ctx.fillRect(grX, meterTop, barWidth, grBarH);
            ctx.restore();
        }

        // Peak hold
        if (grDb < peakHoldRef.current) {
            peakHoldRef.current = grDb;
            peakTimerRef.current = 90; // ~1.5 sec at 60fps
        } else if (peakTimerRef.current > 0) {
            peakTimerRef.current--;
        } else {
            peakHoldRef.current += 0.1;
            peakHoldRef.current = Math.min(0, peakHoldRef.current);
        }

        if (peakHoldRef.current < -0.1) {
            const peakY = meterTop + (-peakHoldRef.current / 30) * meterHeight;
            ctx.beginPath();
            ctx.moveTo(grX - 1, Math.min(peakY, meterBottom));
            ctx.lineTo(grX + barWidth + 1, Math.min(peakY, meterBottom));
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Scale markings
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.font = '7px monospace';
        ctx.textAlign = 'right';
        for (const db of [0, -3, -6, -10, -15, -20, -30]) {
            const y = meterTop + (-db / 30) * meterHeight;
            if (y >= meterTop && y <= meterBottom) {
                // Tick
                ctx.fillRect(grX - 4, y, 3, 0.5);
                ctx.fillRect(grX + barWidth + 1, y, 3, 0.5);
                // Label
                ctx.fillText(`${db}`, grX - 5, y + 3);
            }
        }

        // GR value text
        ctx.fillStyle = accent;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(grDb < -0.1 ? `${grDb.toFixed(1)}` : '0.0', width / 2, 14);

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GR', width / 2, height - 1);
    }, [grDb, inputDb, outputDb, width, height, accentColor]);

    // Round to one decimal so the announced value matches the visible readout
    // (the canvas prints `grDb.toFixed(1)`), instead of leaking the raw float.
    const displayGrDb = Math.round(grDb * 10) / 10;

    return (
        <div
            role="meter"
            aria-label={label}
            aria-valuemin={-30}
            aria-valuemax={0}
            aria-valuenow={displayGrDb}
            aria-valuetext={`${displayGrDb.toFixed(1)} dB of gain reduction`}
        >
            <canvas
                ref={canvasRef}
                style={{ width, height }}
                className="rounded border border-border/20"
                aria-hidden="true"
            />
        </div>
    );
};
