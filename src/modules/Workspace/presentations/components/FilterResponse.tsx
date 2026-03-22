/**
 * FilterResponse — Canvas2D frequency response visualization.
 *
 * Draws the frequency response of LP/HP/BP/Notch filters
 * showing cutoff, resonance peak, and rolloff slope.
 * Logarithmic frequency axis (20 Hz – 20 kHz).
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type FilterResponseProps = {
    cutoff: number;      // Hz (20–20000)
    resonance: number;   // Q (0.1–20)
    filterType: number;  // 0=LP, 1=HP, 2=BP, 3=Notch
    width?: number;
    height?: number;
};

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_RANGE = 30;

type FilterTypeLabel = 'LP' | 'HP' | 'BP' | 'Notch';
const FILTER_LABELS: FilterTypeLabel[] = ['LP', 'HP', 'BP', 'Notch'];

/** Compute approximate magnitude response for standard filter types */
const filterMag = (f: number, fc: number, Q: number, type: number): number => {
    const w = f / fc;
    const w2 = w * w;
    const inv = 1 / Q;

    switch (type) {
        case 0: { // Lowpass
            const den = Math.sqrt((1 - w2) ** 2 + (w * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001));
        }
        case 1: { // Highpass
            const den = Math.sqrt((1 - w2) ** 2 + (w * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001)) + 20 * Math.log10(Math.max(w2, 0.0001));
        }
        case 2: { // Bandpass
            const den = Math.sqrt((1 - w2) ** 2 + (w * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001)) + 20 * Math.log10(Math.max(w * inv, 0.0001));
        }
        case 3: { // Notch
            const num = Math.sqrt((1 - w2) ** 2);
            const den = Math.sqrt((1 - w2) ** 2 + (w * inv) ** 2);
            return 20 * Math.log10(Math.max(num / den, 0.0001));
        }
        default:
            return 0;
    }
};

export const FilterResponse = ({
    cutoff,
    resonance,
    filterType,
    width = 200,
    height = 80,
}: FilterResponseProps): ReactElement => {
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

        const bg = resolveToken('--color-bg-tray', '#0a0a0a');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        const zeroY = height * 0.6; // 0 dB line slightly below center to show resonance peak

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(width, zeroY);
        ctx.stroke();

        for (const freq of [100, 1000, 10000]) {
            const x = (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Cutoff vertical marker
        const cutoffX = (Math.log10(cutoff / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(cutoffX, 0);
        ctx.lineTo(cutoffX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Compute curve
        const accentCyan = resolveToken('--color-accent-cyan', '#7fb8c4');
        const type = Math.round(filterType);
        const points: [number, number][] = [];
        const steps = width;

        for (let i = 0; i <= steps; i++) {
            const freq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / steps);
            const db = filterMag(freq, cutoff, resonance, type);
            const clamped = Math.max(-DB_RANGE, Math.min(DB_RANGE, db));
            const y = zeroY - (clamped / DB_RANGE) * zeroY;
            points.push([i, y]);
        }

        // Fill
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        for (const [x, y] of points) ctx.lineTo(x, y);
        ctx.lineTo(width, zeroY);
        ctx.closePath();
        ctx.fillStyle = `${accentCyan}14`;
        ctx.fill();

        // Stroke
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i]!;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = accentCyan;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Cutoff dot
        const cutoffDb = filterMag(cutoff, cutoff, resonance, type);
        const dotY = zeroY - (Math.max(-DB_RANGE, Math.min(DB_RANGE, cutoffDb)) / DB_RANGE) * zeroY;
        ctx.beginPath();
        ctx.arc(cutoffX, dotY, 3, 0, Math.PI * 2);
        ctx.fillStyle = accentCyan;
        ctx.fill();

        // Labels
        ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        for (const [label, freq] of [['100', 100], ['1k', 1000], ['10k', 10000]] as const) {
            const lx = (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;
            ctx.fillText(label, lx, height - 2);
        }

        // Filter type badge
        const typeLabel = FILTER_LABELS[type] ?? 'LP';
        ctx.fillStyle = accentCyan;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(typeLabel, width - 4, 10);
    }, [cutoff, resonance, filterType, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label="Filter frequency response"
            role="img"
        />
    );
};
