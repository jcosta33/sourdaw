/**
 * ProofEqCurve — 8-band interactive mastering EQ frequency response.
 *
 * Log frequency axis (20 Hz – 20 kHz), linear dB axis (±18 dB).
 * Drag band dots: horizontal = frequency, vertical = gain for peak/shelf bands.
 * HP/LP (high/low pass) bands have no gain axis — vertical drag is a no-op for
 * them and only frequency moves. Each band draws its true magnitude response
 * (peak, shelf, or rolloff). Band type and M/S mode shown as color coding.
 */
import { type ReactElement, useRef, useEffect, useLayoutEffect } from 'react';

import { type GestureAuthority } from '#/components/daw/RotaryKnob';

import { type ProofPatch, type ProofPatchEdit } from '../../models/ProofPatch';

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_RANGE = 18;
const BAND_COLORS = ['#6BAACE', '#52BA46', '#E0AA2A', '#FF5F80', '#4CB8B8', '#954EB2', '#6BAACE', '#52BA46'];
const CHANNEL_INDICATORS: Record<number, string> = { 0: '', 1: 'M', 2: 'S' };

const freqToX = (freq: number, w: number): number =>
    (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * w;

const xToFreq = (x: number, w: number): number => MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (x / w);

const gainToY = (gain: number, h: number): number => h / 2 - (gain / DB_RANGE) * (h / 2);

const yToGain = (y: number, h: number): number => (-(y - h / 2) / (h / 2)) * DB_RANGE;

/** EQ band type ids (mirror of the engine's filter kinds). */
export const EQ_PEAK = 0;
export const EQ_LOW_SHELF = 1;
export const EQ_HIGH_SHELF = 2;
export const EQ_HIGH_PASS = 3;
export const EQ_LOW_PASS = 4;

/** Gain is meaningful only for peak/shelf bands; HP/LP cutoff filters ignore it. */
export const bandUsesGain = (type: number): boolean =>
    type === EQ_PEAK || type === EQ_LOW_SHELF || type === EQ_HIGH_SHELF;

/**
 * Reference sample rate for coefficient design. The curve is drawn over
 * 20 Hz – 20 kHz, well below Nyquist at this rate, so the analytic response
 * matches what a `BiquadFilterNode` of the same type/freq/gain/Q produces.
 */
const DESIGN_SR = 48000;

/**
 * Analytic magnitude (dB) of an RBJ biquad of the given type, evaluated at
 * frequency `f`. Covers peak, low/high shelf, and high/low pass so shelves
 * draw as shelves and HP/LP draw their real rolloff — matching the engine
 * filters and `BiquadFilterNode.getFrequencyResponse`. Pure, allocation-light
 * (fixed locals, no arrays), safe to call per curve point.
 */
type EqBandMagInput = { type: number; f: number; fc: number; gainDb: number; Q: number };

export const eqBandMag = ({ type, f, fc, gainDb, Q }: EqBandMagInput): number => {
    // Peak/shelf at unity gain are perfectly flat; short-circuit to avoid float noise.
    if (bandUsesGain(type) && Math.abs(gainDb) < 0.01) {
        return 0;
    }

    const w0 = (2 * Math.PI * fc) / DESIGN_SR;
    const cw0 = Math.cos(w0);
    const sw0 = Math.sin(w0);
    const A = 10 ** (gainDb / 40);
    const alpha = sw0 / (2 * Q);

    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;

    switch (type) {
        case EQ_LOW_SHELF: {
            const tsa = 2 * Math.sqrt(A) * alpha;
            b0 = A * (A + 1 - (A - 1) * cw0 + tsa);
            b1 = 2 * A * (A - 1 - (A + 1) * cw0);
            b2 = A * (A + 1 - (A - 1) * cw0 - tsa);
            a0 = A + 1 + (A - 1) * cw0 + tsa;
            a1 = -2 * (A - 1 + (A + 1) * cw0);
            a2 = A + 1 + (A - 1) * cw0 - tsa;
            break;
        }
        case EQ_HIGH_SHELF: {
            const tsa = 2 * Math.sqrt(A) * alpha;
            b0 = A * (A + 1 + (A - 1) * cw0 + tsa);
            b1 = -2 * A * (A - 1 + (A + 1) * cw0);
            b2 = A * (A + 1 + (A - 1) * cw0 - tsa);
            a0 = A + 1 - (A - 1) * cw0 + tsa;
            a1 = 2 * (A - 1 - (A + 1) * cw0);
            a2 = A + 1 - (A - 1) * cw0 - tsa;
            break;
        }
        case EQ_HIGH_PASS:
            b0 = (1 + cw0) / 2;
            b1 = -(1 + cw0);
            b2 = (1 + cw0) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cw0;
            a2 = 1 - alpha;
            break;
        case EQ_LOW_PASS:
            b0 = (1 - cw0) / 2;
            b1 = 1 - cw0;
            b2 = (1 - cw0) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cw0;
            a2 = 1 - alpha;
            break;
        case EQ_PEAK:
        default:
            b0 = 1 + alpha * A;
            b1 = -2 * cw0;
            b2 = 1 - alpha * A;
            a0 = 1 + alpha / A;
            a1 = -2 * cw0;
            a2 = 1 - alpha / A;
            break;
    }

    // |H(e^{jw})| evaluated from the (normalised) coefficients.
    const w = (2 * Math.PI * f) / DESIGN_SR;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const c2w = Math.cos(2 * w);
    const s2w = Math.sin(2 * w);

    const numRe = (b0 + b1 * cw + b2 * c2w) / a0;
    const numIm = -(b1 * sw + b2 * s2w) / a0;
    const denRe = (a0 + a1 * cw + a2 * c2w) / a0;
    const denIm = -(a1 * sw + a2 * s2w) / a0;

    const numMag = Math.hypot(numRe, numIm);
    const denMag = Math.hypot(denRe, denIm);
    if (denMag === 0) {
        return 0;
    }
    return 20 * Math.log10(numMag / denMag);
};

type Props = {
    patch: ProofPatch;
    width: number;
    height: number;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: (edit: ProofPatchEdit) => void;
};

export const ProofEqCurve = ({
    patch,
    width,
    height,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: Props): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const activePointerIdRef = useRef<number | null>(null);
    const dragBandRef = useRef<number | null>(null);
    const dragStartBandRef = useRef<ProofPatch['eqBands'][number] | null>(null);
    const dragValueRef = useRef<{ freq: number; gain: number } | null>(null);
    const gestureOwnerAtStartRef = useRef<string | number | null>(null);
    const gestureAuthorityRef = useRef<GestureAuthority | undefined>(gestureAuthority);
    const onPatchChangeRef = useRef(onPatchChange);
    const finalizeDragRef = useRef<(pointerId?: number) => boolean>(() => false);

    const releasePointerCapture = (pointerId: number | null): void => {
        if (pointerId === null || !canvasRef.current || typeof canvasRef.current.releasePointerCapture !== 'function') {
            return;
        }
        try {
            canvasRef.current.releasePointerCapture(pointerId);
        } catch {
            // The browser may have already released capture before this finalizer runs.
        }
    };

    const clearDragState = (): void => {
        const pointerId = activePointerIdRef.current;
        activePointerIdRef.current = null;
        dragBandRef.current = null;
        dragStartBandRef.current = null;
        dragValueRef.current = null;
        gestureOwnerAtStartRef.current = null;
        releasePointerCapture(pointerId);
    };

    const ownsGesture = (): boolean => {
        const token = gestureOwnerAtStartRef.current;
        const authority = gestureAuthorityRef.current;
        if (authority) {
            return token !== null && authority.isCurrent(token);
        }
        return token !== null && Object.is(token, gestureOwner);
    };

    useLayoutEffect(() => {
        onPatchChangeRef.current = onPatchChange;
        gestureAuthorityRef.current = gestureAuthority;

        if (
            activePointerIdRef.current !== null &&
            gestureOwnerAtStartRef.current !== null &&
            !Object.is(gestureOwnerAtStartRef.current, gestureOwner)
        ) {
            clearDragState();
        }

        finalizeDragRef.current = (pointerId?: number): boolean => {
            if (activePointerIdRef.current === null) {
                return false;
            }
            if (pointerId !== undefined && activePointerIdRef.current !== pointerId) {
                return false;
            }

            const bandIndex = dragBandRef.current;
            const startBand = dragStartBandRef.current;
            const dragValue = dragValueRef.current;
            const ownsCurrentGesture = ownsGesture();
            const changed =
                startBand !== null &&
                dragValue !== null &&
                (startBand.freq !== dragValue.freq ||
                    (bandUsesGain(startBand.type) && startBand.gain !== dragValue.gain));

            clearDragState();

            if (ownsCurrentGesture && bandIndex !== null && startBand !== null && dragValue !== null && changed) {
                const value = patch.eqBands.map((band, index) => {
                    if (index !== bandIndex) {
                        return band;
                    }
                    const nextBand = {
                        ...band,
                        freq: dragValue.freq,
                    };
                    if (bandUsesGain(startBand.type)) {
                        nextBand.gain = dragValue.gain;
                    }
                    return nextBand;
                });
                const changedParams: Array<{
                    bandIndex: number;
                    field: keyof ProofPatch['eqBands'][number];
                }> = [{ bandIndex, field: 'freq' }];
                if (bandUsesGain(startBand.type)) {
                    changedParams.push({ bandIndex, field: 'gain' });
                }
                onPatchChangeRef.current({
                    key: 'eqBands',
                    value,
                    changedParams,
                    isTransient: false,
                });
            }
            return true;
        };
    });

    useEffect(() => {
        return () => {
            finalizeDragRef.current();
        };
    }, []);

    useEffect(() => {
        const handleWindowBlur = (): void => {
            finalizeDragRef.current();
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                finalizeDragRef.current();
            }
        };

        window.addEventListener('blur', handleWindowBlur);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('blur', handleWindowBlur);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

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
        bgGrad.addColorStop(0, '#100f14');
        bgGrad.addColorStop(0.5, '#0a090e');
        bgGrad.addColorStop(1, '#07060a');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Grid — subtle
        ctx.lineWidth = 0.5;
        // Frequency grid
        for (const freq of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
            const x = freqToX(freq, w);
            ctx.strokeStyle = freq === 1000 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        // dB grid
        for (const db of [-12, -6, 0, 6, 12]) {
            const y = gainToY(db, h);
            ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.035)';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        // Zero line
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        const zeroY = gainToY(0, h);
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(w, zeroY);
        ctx.stroke();

        // Frequency labels
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.font = '7px system-ui';
        ctx.textAlign = 'center';
        for (const freq of [100, 1000, 10000]) {
            const x = freqToX(freq, w);
            ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x, h - 3);
        }

        // Compute combined curve
        const NUM_POINTS = 200;
        const freqs = Array.from(
            { length: NUM_POINTS },
            (_, i) => MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (i / (NUM_POINTS - 1))
        );

        // Per-band curves + sum
        const bandMags: number[][] = patch.eqBands.map(() => Array.from({ length: NUM_POINTS }, () => 0));
        const sumMag: number[] = Array.from({ length: NUM_POINTS }, () => 0);

        for (let b = 0; b < patch.eqBands.length; b++) {
            const band = patch.eqBands[b]!;
            if (!band.enabled) {
                continue;
            }
            // Peak/shelf use gain; HP/LP ignore it and draw their rolloff instead.
            for (let i = 0; i < NUM_POINTS; i++) {
                const mag = eqBandMag({ type: band.type, f: freqs[i]!, fc: band.freq, gainDb: band.gain, Q: band.q });
                bandMags[b]![i] = mag;
                sumMag[i]! += mag;
            }
        }

        // Draw per-band filled curves (subtle)
        for (let b = 0; b < patch.eqBands.length; b++) {
            const band = patch.eqBands[b]!;
            // Peak/shelf at unity gain contribute nothing; HP/LP always shape the curve.
            const flat = bandUsesGain(band.type) && Math.abs(band.gain) < 0.01;
            if (!band.enabled || flat) {
                continue;
            }

            ctx.beginPath();
            ctx.moveTo(freqToX(freqs[0]!, w), zeroY);
            for (let i = 0; i < NUM_POINTS; i++) {
                ctx.lineTo(freqToX(freqs[i]!, w), gainToY(bandMags[b]![i]!, h));
            }
            ctx.lineTo(freqToX(freqs[NUM_POINTS - 1]!, w), zeroY);
            ctx.closePath();
            ctx.fillStyle = `${BAND_COLORS[b]!}1a`;
            ctx.fill();
        }

        // Draw combined curve — glow pass
        ctx.beginPath();
        for (let i = 0; i < NUM_POINTS; i++) {
            const x = freqToX(freqs[i]!, w);
            const y = gainToY(sumMag[i]!, h);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.save();
        ctx.shadowColor = 'rgba(200,200,255,0.5)';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = 'rgba(230,230,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Draw combined curve — crisp pass
        ctx.strokeStyle = 'rgba(240,240,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw band dots
        for (let b = 0; b < patch.eqBands.length; b++) {
            const band = patch.eqBands[b]!;
            const x = freqToX(band.freq, w);
            // Peak/shelf dots sit at the band gain; HP/LP have no gain axis, so
            // pin the dot on the curve at the cutoff (its own response there).
            const dotDb = bandUsesGain(band.type)
                ? band.gain
                : eqBandMag({ type: band.type, f: band.freq, fc: band.freq, gainDb: band.gain, Q: band.q });
            const y = gainToY(dotDb, h);
            const color = BAND_COLORS[b]!;

            // Dot — glow
            if (band.enabled) {
                ctx.save();
                ctx.shadowColor = color;
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.restore();
            } else {
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = `${color}40`;
                ctx.fill();
            }
            ctx.strokeStyle = band.enabled ? 'rgba(255,255,255,0.85)' : 'transparent';
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
        if (activePointerIdRef.current !== null || e.button !== 0) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Find closest band dot
        let closestIdx = -1;
        let closestDist = 15; // max pick distance
        for (let b = 0; b < patch.eqBands.length; b++) {
            const band = patch.eqBands[b]!;
            const bx = freqToX(band.freq, width);
            // Hit-test against where the dot is actually drawn (HP/LP sit on the curve).
            const dotDb = bandUsesGain(band.type)
                ? band.gain
                : eqBandMag({ type: band.type, f: band.freq, fc: band.freq, gainDb: band.gain, Q: band.q });
            const by = gainToY(dotDb, height);
            const dist = Math.sqrt((mx - bx) ** 2 + (my - by) ** 2);
            if (dist < closestDist) {
                closestDist = dist;
                closestIdx = b;
            }
        }

        if (closestIdx >= 0) {
            const gestureToken = gestureAuthorityRef.current?.acquire(() => finalizeDragRef.current()) ?? gestureOwner;
            canvas.setPointerCapture(e.pointerId);
            activePointerIdRef.current = e.pointerId;
            dragBandRef.current = closestIdx;
            dragStartBandRef.current = patch.eqBands[closestIdx] ?? null;
            const startBand = dragStartBandRef.current;
            if (!startBand) {
                clearDragState();
                return;
            }
            dragValueRef.current = { freq: startBand.freq, gain: startBand.gain };
            gestureOwnerAtStartRef.current = gestureToken;
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const idx = dragBandRef.current;
        if (idx === null || activePointerIdRef.current !== e.pointerId) {
            return;
        }
        if (!ownsGesture()) {
            clearDragState();
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const startBand = dragStartBandRef.current;
        const currentBand = patch.eqBands[idx];
        const dragValue = dragValueRef.current;
        if (!startBand || !currentBand || !dragValue) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const newFreq = Math.round(Math.max(20, Math.min(20000, xToFreq(mx, width))));

        // HP/LP cutoff bands have no gain axis: the engine ignores `gain` for them,
        // so vertical drag must not write it. Only frequency changes for those bands.
        if (!bandUsesGain(startBand.type)) {
            if (dragValue.freq === newFreq) {
                return;
            }
            const bands = patch.eqBands.map((band, index) => (index === idx ? { ...band, freq: newFreq } : band));
            const edit: ProofPatchEdit = {
                key: 'eqBands',
                value: bands,
                changedParams: [{ bandIndex: idx, field: 'freq' }],
                isTransient: true,
            };
            dragValueRef.current = { ...dragValue, freq: newFreq };
            onPatchChangeRef.current(edit);
            return;
        }

        const newGain = Math.round(Math.max(-DB_RANGE, Math.min(DB_RANGE, yToGain(my, height))) * 2) / 2;
        if (dragValue.freq === newFreq && dragValue.gain === newGain) {
            return;
        }

        const bands = patch.eqBands.map((band, index) =>
            index === idx ? { ...band, freq: newFreq, gain: newGain } : band
        );
        const edit: ProofPatchEdit = {
            key: 'eqBands',
            value: bands,
            changedParams: [
                { bandIndex: idx, field: 'freq' },
                { bandIndex: idx, field: 'gain' },
            ],
            isTransient: true,
        };
        dragValueRef.current = { freq: newFreq, gain: newGain };
        onPatchChangeRef.current(edit);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        finalizeDragRef.current(e.pointerId);
    };

    const handleFocusLoss = (): void => {
        finalizeDragRef.current();
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: 'crosshair' }}
            className="rounded border border-border/20"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onLostPointerCapture={handlePointerUp}
            onBlur={handleFocusLoss}
            aria-label="8-band parametric EQ frequency response"
        />
    );
};
