/**
 * EQ Curve Visualization — Canvas2D frequency response graph.
 *
 * Draws a smooth EQ curve showing the combined frequency response of a
 * 3-band parametric EQ (Low, Mid, High peaking filters).
 * Uses logarithmic frequency axis (20 Hz – 20 kHz) and linear dB axis (±24 dB).
 * Runs in a rAF loop outside React's render cycle for smooth animation.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type EQCurveProps = {
    lowGain: number;
    lowFreq: number;
    lowQ: number;
    midGain: number;
    midFreq: number;
    midQ: number;
    highGain: number;
    highFreq: number;
    highQ: number;
    width?: number;
    height?: number;
};

/** Compute magnitude (dB) of a single peaking EQ band at frequency f */
const peakingMag = (f: number, fc: number, gainDb: number, Q: number): number => {
    if (Math.abs(gainDb) < 0.01) return 0;
    const w = f / fc;
    const w2 = w * w;
    const bw = w / Q;
    const A = Math.pow(10, gainDb / 40); // linear amplitude at peak
    const num = (1 - w2) ** 2 + (bw * A) ** 2;
    const den = (1 - w2) ** 2 + (bw / A) ** 2;
    return 10 * Math.log10(num / den);
};

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_RANGE = 24;

export const EQCurve = ({
    lowGain, lowFreq, lowQ,
    midGain, midFreq, midQ,
    highGain, highFreq, highQ,
    width = 200,
    height = 80,
}: EQCurveProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // DPR for crisp rendering
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const draw = (): void => {
            ctx.clearRect(0, 0, width, height);

            // Background
            const bgColor = resolveToken('--color-bg-tray', '#0a0a0a');
            ctx.fillStyle = bgColor;
            ctx.beginPath();
            ctx.roundRect(0, 0, width, height, 4);
            ctx.fill();

            // Grid lines
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 0.5;

            // Horizontal 0 dB line
            const zeroY = height / 2;
            ctx.beginPath();
            ctx.moveTo(0, zeroY);
            ctx.lineTo(width, zeroY);
            ctx.stroke();

            // Vertical frequency markers
            for (const freq of [100, 1000, 10000]) {
                const x = (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }

            // ±12 dB lines
            for (const db of [-12, 12]) {
                const y = zeroY - (db / DB_RANGE) * (height / 2);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // Compute curve
            const points: [number, number][] = [];
            const steps = width;
            for (let i = 0; i <= steps; i++) {
                const x = i;
                const logFreq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / steps);
                const totalDb =
                    peakingMag(logFreq, lowFreq, lowGain, lowQ) +
                    peakingMag(logFreq, midFreq, midGain, midQ) +
                    peakingMag(logFreq, highFreq, highGain, highQ);
                const clampedDb = Math.max(-DB_RANGE, Math.min(DB_RANGE, totalDb));
                const y = zeroY - (clampedDb / DB_RANGE) * (height / 2);
                points.push([x, y]);
            }

            // Fill area under curve
            const accentCyan = resolveToken('--color-accent-cyan', '#7fb8c4');
            ctx.beginPath();
            ctx.moveTo(0, zeroY);
            for (const [x, y] of points) {
                ctx.lineTo(x, y);
            }
            ctx.lineTo(width, zeroY);
            ctx.closePath();
            ctx.fillStyle = `${accentCyan}18`; // ~10% opacity
            ctx.fill();

            // Stroke curve
            ctx.beginPath();
            for (let i = 0; i < points.length; i++) {
                const [x, y] = points[i]!;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = accentCyan;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Band center markers
            const bands = [
                { freq: lowFreq, gain: lowGain },
                { freq: midFreq, gain: midGain },
                { freq: highFreq, gain: highGain },
            ];
            for (const band of bands) {
                if (Math.abs(band.gain) < 0.1) continue;
                const bx = (Math.log10(band.freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;
                const totalDb =
                    peakingMag(band.freq, lowFreq, lowGain, lowQ) +
                    peakingMag(band.freq, midFreq, midGain, midQ) +
                    peakingMag(band.freq, highFreq, highGain, highQ);
                const by = zeroY - (Math.max(-DB_RANGE, Math.min(DB_RANGE, totalDb)) / DB_RANGE) * (height / 2);
                ctx.beginPath();
                ctx.arc(bx, by, 3, 0, Math.PI * 2);
                ctx.fillStyle = accentCyan;
                ctx.fill();
                ctx.strokeStyle = bgColor;
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // Frequency labels
            ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
            ctx.font = '7px monospace';
            ctx.textAlign = 'center';
            for (const [label, freq] of [['100', 100], ['1k', 1000], ['10k', 10000]] as const) {
                const lx = (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;
                ctx.fillText(label, lx, height - 2);
            }
        };

        draw();
        // No animation loop needed — redraws on param change via effect deps
    }, [lowGain, lowFreq, lowQ, midGain, midFreq, midQ, highGain, highFreq, highQ, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label="EQ frequency response curve"
            role="img"
        />
    );
};
