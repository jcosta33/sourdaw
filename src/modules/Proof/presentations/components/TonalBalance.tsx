/**
 * TonalBalance — spectrum analyzer with Harman target curve overlay.
 *
 * Shows the current signal's frequency content against the research-derived
 * Harman target curve, helping engineers achieve balanced spectral content.
 *
 * Uses the master analyser node for real-time FFT data.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { type ProofAnalyserStatus } from '../hooks/useProofAnalyser';

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_DB = -50;
const MAX_DB = 10;

const freqToX = (freq: number, w: number): number =>
    (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * w;

const dbToY = (db: number, h: number): number => ((db - MAX_DB) / (MIN_DB - MAX_DB)) * h;

/** Harman target curve key points (simplified, relative to 1kHz). */
const HARMAN_CURVE: Array<{ freq: number; db: number }> = [
    { freq: 20, db: -8 },
    { freq: 50, db: -5 },
    { freq: 100, db: -3 },
    { freq: 200, db: -1 },
    { freq: 500, db: 0 },
    { freq: 1000, db: 0 },
    { freq: 2000, db: 1 },
    { freq: 3000, db: 2 },
    { freq: 4000, db: 1 },
    { freq: 6000, db: -2 },
    { freq: 8000, db: -3 },
    { freq: 10000, db: -5 },
    { freq: 12000, db: -7 },
    { freq: 16000, db: -10 },
    { freq: 20000, db: -15 },
];

/** Genre target adjustments. */
const GENRE_ADJUSTMENTS: Record<string, Array<{ freq: number; db: number }>> = {
    edm: [
        { freq: 30, db: 5 },
        { freq: 60, db: 4 },
        { freq: 80, db: 3 },
        { freq: 3000, db: 2 },
        { freq: 5000, db: 2 },
    ],
    hiphop: [
        { freq: 30, db: 4 },
        { freq: 50, db: 3.5 },
        { freq: 60, db: 3 },
        { freq: 3000, db: 1.5 },
        { freq: 5000, db: 1 },
    ],
    classical: [], // close to Harman neutral
};

type Props = {
    /**
     * Whether the spectrum tap is connected at all. Required, because a null
     * `fftData` alone cannot tell "the master is silent" from "there is no
     * analyser", and the display would report both as a flat, empty spectrum.
     */
    status: ProofAnalyserStatus;
    /** Float32Array of FFT magnitude data from analyser node. */
    fftData: Float32Array<ArrayBuffer> | null;
    /**
     * Monotonic counter bumped each time \`fftData\` is refreshed (§174.1).
     * Needed because the underlying array is mutated in place, so its
     * reference is stable — without a version tag the redraw \`useEffect\`
     * would only fire once at mount and the display would freeze.
     */
    fftVersion: number;
    sampleRate: number;
    fftSize: number;
    genre?: string;
    width: number;
    height: number;
};

export const TonalBalance = ({
    status,
    fftData,
    fftVersion,
    sampleRate,
    fftSize,
    genre,
    width,
    height,
}: Props): ReactElement => {
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

        const w = width;
        const h = height;

        // Background — deep gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#0e0d13');
        bgGrad.addColorStop(0.5, '#09080d');
        bgGrad.addColorStop(1, '#060509');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Grid — subtle
        ctx.lineWidth = 0.5;
        for (const freq of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
            const x = freqToX(freq, w);
            ctx.strokeStyle = freq === 1000 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (const db of [-40, -30, -20, -10, 0]) {
            const y = dbToY(db, h);
            ctx.strokeStyle = db === -20 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Frequency labels
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.font = '7px system-ui';
        ctx.textAlign = 'center';
        for (const freq of [100, 1000, 10000]) {
            const x = freqToX(freq, w);
            ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x, h - 3);
        }

        // Draw Harman target curve (with genre adjustment)
        const adjustments = genre && GENRE_ADJUSTMENTS[genre] ? GENRE_ADJUSTMENTS[genre] : [];
        ctx.beginPath();
        for (let i = 0; i < HARMAN_CURVE.length; i++) {
            const pt = HARMAN_CURVE[i]!;
            let db = pt.db;
            // Apply genre adjustment
            for (const adj of adjustments) {
                if (Math.abs(pt.freq - adj.freq) < pt.freq * 0.3) {
                    db += adj.db * (1 - Math.abs(pt.freq - adj.freq) / (pt.freq * 0.3));
                }
            }
            const x = freqToX(pt.freq, w);
            const y = dbToY(db - 20, h); // offset to match typical spectrum level
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.save();
        ctx.shadowColor = 'rgba(76,200,200,0.3)';
        ctx.shadowBlur = 6;
        ctx.strokeStyle = 'rgba(76, 200, 200, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
        ctx.setLineDash([]);

        // Draw target band (+-3dB tolerance)
        ctx.beginPath();
        for (let i = 0; i < HARMAN_CURVE.length; i++) {
            const pt = HARMAN_CURVE[i]!;
            const x = freqToX(pt.freq, w);
            const y = dbToY(pt.db - 20 + 3, h);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        for (let i = HARMAN_CURVE.length - 1; i >= 0; i--) {
            const pt = HARMAN_CURVE[i]!;
            const x = freqToX(pt.freq, w);
            const y = dbToY(pt.db - 20 - 3, h);
            ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(76, 200, 200, 0.06)';
        ctx.fill();

        // Draw current spectrum from FFT data
        if (fftData && fftData.length > 0) {
            ctx.beginPath();
            const binWidth = sampleRate / fftSize;
            let started = false;
            for (let i = 1; i < fftData.length; i++) {
                const freq = i * binWidth;
                if (freq < MIN_FREQ || freq > MAX_FREQ) {
                    continue;
                }
                const x = freqToX(freq, w);
                const db = Math.max(MIN_DB, fftData[i]!);
                const y = dbToY(db, h);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            // Filled area
            if (started) {
                const lastFreq = Math.min((fftData.length - 1) * binWidth, MAX_FREQ);
                ctx.lineTo(freqToX(lastFreq, w), h);
                ctx.lineTo(freqToX(MIN_FREQ, w), h);
                ctx.closePath();
                const gradient = ctx.createLinearGradient(0, 0, 0, h);
                gradient.addColorStop(0, 'rgba(178, 140, 255, 0.45)');
                gradient.addColorStop(0.5, 'rgba(168, 130, 255, 0.15)');
                gradient.addColorStop(1, 'rgba(168, 130, 255, 0.01)');
                ctx.fillStyle = gradient;
                ctx.fill();
            }

            // Stroke the spectrum line
            ctx.beginPath();
            started = false;
            for (let i = 1; i < fftData.length; i++) {
                const freq = i * binWidth;
                if (freq < MIN_FREQ || freq > MAX_FREQ) {
                    continue;
                }
                const x = freqToX(freq, w);
                const db = Math.max(MIN_DB, fftData[i]!);
                const y = dbToY(db, h);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.save();
            ctx.shadowColor = 'rgba(178,140,255,0.4)';
            ctx.shadowBlur = 6;
            ctx.strokeStyle = 'rgba(178, 140, 255, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
        }

        // Label
        ctx.fillStyle = 'rgba(76, 200, 200, 0.55)';
        ctx.font = '7px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText('Harman Target', 4, 10);
    }, [fftData, fftVersion, sampleRate, fftSize, genre, width, height]);

    return (
        <div className="relative" style={{ width, height }}>
            <canvas
                ref={canvasRef}
                style={{ width, height }}
                className="rounded border border-border/20"
                aria-label="Tonal balance display with Harman target curve"
            />
            {status === 'unavailable' ? (
                <span
                    role="status"
                    className="absolute inset-0 flex items-center justify-center rounded bg-surface-base/70 text-center text-[8px] text-[var(--color-accent-peach)]"
                >
                    Spectrum analyser unavailable — showing the target curve only
                </span>
            ) : null}
        </div>
    );
};
