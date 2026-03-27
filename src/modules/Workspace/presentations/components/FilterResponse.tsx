/**
 * FilterResponse — Interactive frequency response visualization.
 *
 * Draws the frequency response of LP/HP/BP/Notch filters.
 * Drag the cutoff dot horizontally to change frequency,
 * vertically to change resonance.
 */
import { type ReactElement, useRef, useEffect, useCallback } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type FilterResponseProps = {
    cutoff: number;      // Hz (20–20000)
    resonance: number;   // Q (0.1–20)
    filterType: number;  // 0=LP, 1=HP, 2=BP, 3=Notch
    width?: number;
    height?: number;
    /** Called when user drags the cutoff dot */
    onParamChange?: (paramId: string, value: number) => void;
};

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_RANGE = 30;

type FilterTypeLabel = 'LP' | 'HP' | 'BP' | 'Notch';
const FILTER_LABELS: FilterTypeLabel[] = ['LP', 'HP', 'BP', 'Notch'];

const filterMag = (f: number, fc: number, Q: number, type: number): number => {
    const w = f / fc;
    const w2 = w * w;
    const inv = 1 / Q;

    switch (type) {
        case 0: {
            const den = Math.sqrt((1 - w2) ** 2 + (w * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001));
        }
        case 1: {
            const den = Math.sqrt((1 - w2) ** 2 + (w * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001)) + 20 * Math.log10(Math.max(w2, 0.0001));
        }
        case 2: {
            const den = Math.sqrt((1 - w2) ** 2 + (w * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001)) + 20 * Math.log10(Math.max(w * inv, 0.0001));
        }
        case 3: {
            const num = Math.sqrt((1 - w2) ** 2);
            const den = Math.sqrt((1 - w2) ** 2 + (w * inv) ** 2);
            return 20 * Math.log10(Math.max(num / den, 0.0001));
        }
        default:
            return 0;
    }
};

const freqToX = (freq: number, w: number): number =>
    (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * w;

const xToFreq = (x: number, w: number): number =>
    MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, x / w);

export const FilterResponse = ({
    cutoff,
    resonance,
    filterType,
    width = 200,
    height = 80,
    onParamChange,
}: FilterResponseProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);
    const isInteractive = !!onParamChange;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) { return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }

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

        const zeroY = height * 0.6;

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(width, zeroY);
        ctx.stroke();

        for (const freq of [100, 1000, 10000]) {
            const x = freqToX(freq, width);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Cutoff vertical marker
        const cutoffX = freqToX(cutoff, width);
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

        for (let i = 0; i <= width; i++) {
            const freq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / width);
            const db = filterMag(freq, cutoff, resonance, type);
            const clamped = Math.max(-DB_RANGE, Math.min(DB_RANGE, db));
            const y = zeroY - (clamped / DB_RANGE) * zeroY;
            points.push([i, y]);
        }

        // Fill
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        for (const [x, y] of points) { ctx.lineTo(x, y); }
        ctx.lineTo(width, zeroY);
        ctx.closePath();
        ctx.fillStyle = `${accentCyan}14`;
        ctx.fill();

        // Stroke
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i]!;
            if (i === 0) { ctx.moveTo(x, y); }
            else { ctx.lineTo(x, y); }
        }
        ctx.strokeStyle = accentCyan;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Cutoff dot — larger if interactive
        const cutoffDb = filterMag(cutoff, cutoff, resonance, type);
        const dotY = zeroY - (Math.max(-DB_RANGE, Math.min(DB_RANGE, cutoffDb)) / DB_RANGE) * zeroY;
        const dotR = isInteractive ? 5 : 3;
        ctx.beginPath();
        ctx.arc(cutoffX, dotY, dotR, 0, Math.PI * 2);
        ctx.fillStyle = accentCyan;
        ctx.fill();
        if (isInteractive) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Labels
        ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        for (const [label, freq] of [['100', 100], ['1k', 1000], ['10k', 10000]] as const) {
            ctx.fillText(label, freqToX(freq, width), height - 2);
        }

        // Filter type badge
        const typeLabel = FILTER_LABELS[type] ?? 'LP';
        ctx.fillStyle = accentCyan;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(typeLabel, width - 4, 10);

        // Interaction hint
        if (isInteractive) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '7px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText('drag to adjust', 4, 10);
        }
    }, [cutoff, resonance, filterType, width, height, isInteractive]);

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) { return; }
        const canvas = canvasRef.current;
        if (!canvas) { return; }
        isDragging.current = true;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
    }, [onParamChange]);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDragging.current || !onParamChange) { return; }
        const canvas = canvasRef.current;
        if (!canvas) { return; }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Horizontal → frequency (log scale)
        const freq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, xToFreq(x, width)));
        onParamChange('filterCutoff', Math.round(freq));

        // Vertical → resonance (inverted: top = high Q)
        const normalizedY = 1 - Math.max(0, Math.min(1, y / height));
        const q = 0.1 + normalizedY * 19.9; // 0.1 to 20
        onParamChange('filterResonance', Math.round(q * 10) / 10);
    }, [onParamChange, width, height]);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        isDragging.current = false;
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.releasePointerCapture(e.pointerId);
            canvas.style.cursor = isInteractive ? 'grab' : 'default';
        }
    }, [isInteractive]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: isInteractive ? 'grab' : 'default' }}
            className="rounded border border-border/30"
            aria-label="Filter frequency response — drag to adjust cutoff and resonance"
            role="img"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        />
    );
};
