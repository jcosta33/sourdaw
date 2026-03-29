/**
 * ProofEqCurve — 8-band interactive mastering EQ frequency response.
 *
 * Log frequency axis (20 Hz – 20 kHz), linear dB axis (±18 dB).
 * Drag band dots: horizontal = frequency, vertical = gain.
 * Band type and M/S mode shown as color coding.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { type ProofPatch } from '../../models/ProofPatch';
import { updateProofPatch } from '../../stores/proofStore';
import { setProofParam } from '../../useCases/proofParamBridge';

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_RANGE = 18;
const BAND_COLORS = ['#6BAACE', '#52BA46', '#E0AA2A', '#FF5F80', '#4CB8B8', '#954EB2', '#6BAACE', '#52BA46'];
const CHANNEL_INDICATORS: Record<number, string> = { 0: '', 1: 'M', 2: 'S' };

const freqToX = (freq: number, w: number): number =>
    (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * w;

const xToFreq = (x: number, w: number): number =>
    MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, x / w);

const gainToY = (gain: number, h: number): number =>
    h / 2 - (gain / DB_RANGE) * (h / 2);

const yToGain = (y: number, h: number): number =>
    -(y - h / 2) / (h / 2) * DB_RANGE;

/** Peaking EQ magnitude response at frequency f for a band at fc with gain and Q. */
const peakingMag = (f: number, fc: number, gainDb: number, Q: number): number => {
    if (Math.abs(gainDb) < 0.01) return 0;
    const w = f / fc;
    const w2 = w * w;
    const bw = w / Q;
    const A = Math.pow(10, gainDb / 40);
    const num = (1 - w2) ** 2 + (bw * A) ** 2;
    const den = (1 - w2) ** 2 + (bw / A) ** 2;
    return 10 * Math.log10(num / den);
};

type Props = {
    patch: ProofPatch;
    width: number;
    height: number;
};

export const ProofEqCurve = ({ patch, width, height }: Props): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragBandRef = useRef<number | null>(null);

    useEffect(() => {
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

        // Background
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        // Frequency grid
        for (const freq of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
            const x = freqToX(freq, w);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        // dB grid
        for (const db of [-12, -6, 0, 6, 12]) {
            const y = gainToY(db, h);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        // Zero line
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        const zeroY = gainToY(0, h);
        ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(w, zeroY); ctx.stroke();

        // Frequency labels
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '7px system-ui';
        ctx.textAlign = 'center';
        for (const freq of [100, 1000, 10000]) {
            const x = freqToX(freq, w);
            ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x, h - 3);
        }

        // Compute combined curve
        const NUM_POINTS = 200;
        const freqs = Array.from({ length: NUM_POINTS }, (_, i) =>
            MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / (NUM_POINTS - 1))
        );

        // Per-band curves + sum
        const bandMags: number[][] = patch.eqBands.map(() => new Array(NUM_POINTS).fill(0));
        const sumMag = new Array(NUM_POINTS).fill(0);

        for (let b = 0; b < patch.eqBands.length; b++) {
            const band = patch.eqBands[b]!;
            if (!band.enabled) continue;
            // Only handle peak/shelf types for display (HP/LP would need different formula)
            if (band.type <= 2) {
                for (let i = 0; i < NUM_POINTS; i++) {
                    const mag = peakingMag(freqs[i]!, band.freq, band.gain, band.q);
                    bandMags[b]![i] = mag;
                    sumMag[i]! += mag;
                }
            }
        }

        // Draw per-band filled curves (subtle)
        for (let b = 0; b < patch.eqBands.length; b++) {
            const band = patch.eqBands[b]!;
            if (!band.enabled || Math.abs(band.gain) < 0.01) continue;

            ctx.beginPath();
            ctx.moveTo(freqToX(freqs[0]!, w), zeroY);
            for (let i = 0; i < NUM_POINTS; i++) {
                ctx.lineTo(freqToX(freqs[i]!, w), gainToY(bandMags[b]![i]!, h));
            }
            ctx.lineTo(freqToX(freqs[NUM_POINTS - 1]!, w), zeroY);
            ctx.closePath();
            ctx.fillStyle = BAND_COLORS[b]! + '15';
            ctx.fill();
        }

        // Draw combined curve
        ctx.beginPath();
        for (let i = 0; i < NUM_POINTS; i++) {
            const x = freqToX(freqs[i]!, w);
            const y = gainToY(sumMag[i]!, h);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw band dots
        for (let b = 0; b < patch.eqBands.length; b++) {
            const band = patch.eqBands[b]!;
            const x = freqToX(band.freq, w);
            const y = gainToY(band.gain, h);
            const color = BAND_COLORS[b]!;

            // Dot
            ctx.beginPath();
            ctx.arc(x, y, band.enabled ? 5 : 3, 0, Math.PI * 2);
            ctx.fillStyle = band.enabled ? color : color + '40';
            ctx.fill();
            ctx.strokeStyle = band.enabled ? '#fff' : 'transparent';
            ctx.lineWidth = 1;
            ctx.stroke();

            // M/S indicator
            const chLabel = CHANNEL_INDICATORS[band.channel];
            if (chLabel) {
                ctx.fillStyle = color;
                ctx.font = 'bold 6px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText(chLabel, x, y - 8);
            }
        }
    }, [patch, width, height]);

    // Drag handling
    const handlePointerDown = (e: React.PointerEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Find closest band dot
        let closestIdx = -1;
        let closestDist = 15; // max pick distance
        for (let b = 0; b < patch.eqBands.length; b++) {
            const band = patch.eqBands[b]!;
            const bx = freqToX(band.freq, width);
            const by = gainToY(band.gain, height);
            const dist = Math.sqrt((mx - bx) ** 2 + (my - by) ** 2);
            if (dist < closestDist) {
                closestDist = dist;
                closestIdx = b;
            }
        }

        if (closestIdx >= 0) {
            dragBandRef.current = closestIdx;
            canvas.setPointerCapture(e.pointerId);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const idx = dragBandRef.current;
        if (idx === null) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const newFreq = Math.round(Math.max(20, Math.min(20000, xToFreq(mx, width))));
        const newGain = Math.round(Math.max(-DB_RANGE, Math.min(DB_RANGE, yToGain(my, height))) * 2) / 2;

        const bands = patch.eqBands.map((b, i) =>
            i === idx ? { ...b, freq: newFreq, gain: newGain } : b
        );
        updateProofPatch({ eqBands: bands });
        setProofParam(`eq_band${idx}_freq`, newFreq);
        setProofParam(`eq_band${idx}_gain`, newGain);
    };

    const handlePointerUp = () => {
        dragBandRef.current = null;
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: 'crosshair' }}
            className="rounded border border-border/20"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            aria-label="8-band parametric EQ frequency response"
        />
    );
};
