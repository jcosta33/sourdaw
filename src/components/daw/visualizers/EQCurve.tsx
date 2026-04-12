/**
 * EQ Curve — Interactive 3-band parametric EQ visualization.
 *
 * Drag band dots horizontally to change frequency, vertically to change gain.
 * Log frequency axis (20 Hz – 20 kHz), linear dB axis (±24 dB).
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/utils/UI/resolveToken';

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
    onParamChange?: (paramId: string, value: number) => void;
};

const peakingMag = (f: number, fc: number, gainDb: number, Q: number): number => {
    if (Math.abs(gainDb) < 0.01) {
        return 0;
    }
    const w = f / fc;
    const w2 = w * w;
    const bw = w / Q;
    const A = Math.pow(10, gainDb / 40);
    const num = (1 - w2) ** 2 + (bw * A) ** 2;
    const den = (1 - w2) ** 2 + (bw / A) ** 2;
    return 10 * Math.log10(num / den);
};

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_RANGE = 24;

const freqToX = (freq: number, w: number): number =>
    (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * w;

const xToFreq = (x: number, w: number): number => MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, x / w);

type BandId = 'low' | 'mid' | 'high';

const BAND_FREQ_PARAMS: Record<BandId, string> = {
    low: 'eq-low-freq',
    mid: 'eq-mid-freq',
    high: 'eq-high-freq',
};
const BAND_GAIN_PARAMS: Record<BandId, string> = {
    low: 'eq-low-gain',
    mid: 'eq-mid-gain',
    high: 'eq-high-gain',
};
const BAND_FREQ_RANGES: Record<BandId, [number, number]> = {
    low: [20, 500],
    mid: [200, 8000],
    high: [2000, 20000],
};
const BAND_COLORS: Record<BandId, string> = {
    low: '#f0944c', // warm orange (saturated)
    mid: '#50d0e8', // cyan (saturated)
    high: '#c488f0', // lavender (saturated)
};

export const EQCurve = ({
    lowGain,
    lowFreq,
    lowQ,
    midGain,
    midFreq,
    midQ,
    highGain,
    highFreq,
    highQ,
    width = 200,
    height = 80,
    onParamChange,
}: EQCurveProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragBand = useRef<BandId | null>(null);
    const isInteractive = !!onParamChange;

    const bands: Array<{ id: BandId; freq: number; gain: number; q: number }> = [
        { id: 'low', freq: lowFreq, gain: lowGain, q: lowQ },
        { id: 'mid', freq: midFreq, gain: midGain, q: midQ },
        { id: 'high', freq: highFreq, gain: highGain, q: highQ },
    ];

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
        ctx.clearRect(0, 0, width, height);

        // Background — deep black with subtle gradient
        const bgColor = resolveToken('--color-bg-tray', '#0a0a0a');
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#0e0e12');
        bgGrad.addColorStop(1, '#060608');
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        const zeroY = height / 2;

        // Grid — subtle dotted lines
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1, 4]);
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
        for (const db of [-12, 12]) {
            const y = zeroY - (db / DB_RANGE) * (height / 2);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Compute combined curve
        const accentCyan = resolveToken('--color-accent-cyan', '#50d0e8');
        const points: [number, number][] = [];
        for (let i = 0; i <= width; i++) {
            const logFreq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / width);
            const totalDb =
                peakingMag(logFreq, lowFreq, lowGain, lowQ) +
                peakingMag(logFreq, midFreq, midGain, midQ) +
                peakingMag(logFreq, highFreq, highGain, highQ);
            const clampedDb = Math.max(-DB_RANGE, Math.min(DB_RANGE, totalDb));
            const y = zeroY - (clampedDb / DB_RANGE) * (height / 2);
            points.push([i, y]);
        }

        // Fill gradient below curve
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        for (const [x, y] of points) {
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width, zeroY);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
        fillGrad.addColorStop(0, `${accentCyan}30`);
        fillGrad.addColorStop(1, `${accentCyan}05`);
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Glow pass — wider stroke, low alpha
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i]!;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = `${accentCyan}30`;
        ctx.lineWidth = 5;
        ctx.stroke();

        // Sharp stroke
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i]!;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = accentCyan;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Band dots — colored and larger when interactive
        for (const band of bands) {
            const bx = freqToX(band.freq, width);
            const totalDb =
                peakingMag(band.freq, lowFreq, lowGain, lowQ) +
                peakingMag(band.freq, midFreq, midGain, midQ) +
                peakingMag(band.freq, highFreq, highGain, highQ);
            const by = zeroY - (Math.max(-DB_RANGE, Math.min(DB_RANGE, totalDb)) / DB_RANGE) * (height / 2);

            const dotR = isInteractive ? 6 : 3;
            const color = BAND_COLORS[band.id];

            ctx.beginPath();
            ctx.arc(bx, by, dotR, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            if (isInteractive) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            } else {
                ctx.strokeStyle = bgColor;
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // Band label
            if (isInteractive) {
                ctx.fillStyle = color;
                ctx.font = 'bold 7px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(band.id.toUpperCase()[0]!, bx, by - dotR - 3);
            }
        }

        // Frequency labels — very dim
        ctx.fillStyle = '#383838';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        for (const [label, freq] of [
            ['100', 100],
            ['1k', 1000],
            ['10k', 10000],
        ] as const) {
            ctx.fillText(label, freqToX(freq, width), height - 2);
        }

        if (isInteractive) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '7px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText('drag bands', 4, 10);
        }
    }, [
        lowGain,
        lowFreq,
        lowQ,
        midGain,
        midFreq,
        midQ,
        highGain,
        highFreq,
        highQ,
        width,
        height,
        isInteractive,
        bands,
    ]);

    const findNearestBand = (x: number): BandId | null => {
        let closest: BandId | null = null;
        let minDist = 20; // 20px hit radius
        for (const band of bands) {
            const bx = freqToX(band.freq, width);
            const dist = Math.abs(x - bx);
            if (dist < minDist) {
                minDist = dist;
                closest = band.id;
            }
        }
        return closest;
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const band = findNearestBand(x);
        if (!band) {
            return;
        }
        dragBand.current = band;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!dragBand.current || !onParamChange) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const band = dragBand.current;

        // Horizontal → frequency (clamped to band range)
        const [minF, maxF] = BAND_FREQ_RANGES[band];
        const freq = Math.max(minF, Math.min(maxF, xToFreq(x, width)));
        onParamChange(BAND_FREQ_PARAMS[band], Math.round(freq));

        // Vertical → gain (±24 dB)
        const zeroY = height / 2;
        const db = -((y - zeroY) / (height / 2)) * DB_RANGE;
        const clampedDb = Math.max(-DB_RANGE, Math.min(DB_RANGE, Math.round(db * 2) / 2));
        onParamChange(BAND_GAIN_PARAMS[band], clampedDb);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        dragBand.current = null;
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.releasePointerCapture(e.pointerId);
            canvas.style.cursor = isInteractive ? 'grab' : 'default';
        }
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: isInteractive ? 'grab' : 'default' }}
            className="rounded border border-border/30"
            aria-label="EQ frequency response — drag band dots to adjust"
            role="img"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        />
    );
};
