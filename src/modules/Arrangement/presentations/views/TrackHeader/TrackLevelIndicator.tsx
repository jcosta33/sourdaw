/**
 * TrackLevelIndicator — tiny per-track dB meter bar.
 *
 * A 3px-wide vertical bar rendered on Canvas that reads from the track's
 * AnalyserNode via `getTrackStripAnalyser()`. Color gradient goes from
 * transparent (silent) → blue (quiet) → green (normal) → yellow (warm) → red (hot).
 * Uses requestAnimationFrame with no React state updates for zero re-render cost.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { getTrackAnalyser } from '#/modules/AudioEngine/useCases';

type TrackLevelIndicatorProps = {
    trackId: string;
    height: number;
};

const BAR_WIDTH = 3;

// dB thresholds for color gradient
const DB_FLOOR = -60;
const DB_CEILING = 0;

const lerp = (a: number, b: number, t: number): string => {
    const r = Math.round(a + (b - a) * t);
    return r.toString();
};

const dbToColor = (db: number): string => {
    if (db <= DB_FLOOR) {
        return 'transparent';
    }
    const norm = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEILING - DB_FLOOR)));

    if (norm < 0.3) {
        // Silent → green (fade in)
        const t = norm / 0.3;
        return `rgba(0, ${lerp(120, 204, t)}, ${lerp(40, 68, t)}, ${(t * 0.85).toFixed(2)})`;
    }
    if (norm < 0.65) {
        // Green → yellow
        const t = (norm - 0.3) / 0.35;
        return `rgb(${lerp(0, 204, t)}, ${lerp(204, 204, t)}, ${lerp(68, 0, t)})`;
    }
    if (norm < 0.85) {
        // Yellow → orange-red
        const t = (norm - 0.65) / 0.2;
        return `rgb(${lerp(204, 255, t)}, ${lerp(204, 51, t)}, 0)`;
    }
    // Hot red zone (above -3dB)
    const t = (norm - 0.85) / 0.15;
    return `rgb(255, ${lerp(51, 20, t)}, ${lerp(0, 10, t)})`;
};

export const TrackLevelIndicator = ({ trackId, height }: TrackLevelIndicatorProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        const dpr = window.devicePixelRatio || 1;
        canvas.width = BAR_WIDTH * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        let rafId = 0;
        let smoothedDb = DB_FLOOR;
        // §185.x — reuse a single Float32Array across frames. The analyser's
        // fftSize can change over a node's lifetime, so reallocate only when
        // it actually does.
        let analyserData: Float32Array<ArrayBuffer> | null = null;

        const draw = (): void => {
            const analyser = getTrackAnalyser(trackId);
            let currentDb = DB_FLOOR;

            if (analyser) {
                if (!analyserData || analyserData.length !== analyser.fftSize) {
                    analyserData = new Float32Array(analyser.fftSize);
                }
                analyser.getFloatTimeDomainData(analyserData);

                // Compute RMS
                let sum = 0;
                for (let i = 0; i < analyserData.length; i++) {
                    sum += analyserData[i]! * analyserData[i]!;
                }
                const rms = Math.sqrt(sum / analyserData.length);
                currentDb = rms > 0 ? 20 * Math.log10(rms) : DB_FLOOR;
            }

            // Smooth: fast attack, slow release
            if (currentDb > smoothedDb) {
                smoothedDb = currentDb; // instant attack
            } else {
                smoothedDb += (currentDb - smoothedDb) * 0.08; // slow release
            }

            ctx.clearRect(0, 0, BAR_WIDTH, height);

            if (smoothedDb > DB_FLOOR + 1) {
                const norm = Math.max(0, Math.min(1, (smoothedDb - DB_FLOOR) / (DB_CEILING - DB_FLOOR)));
                const barH = norm * height;
                const y = height - barH;

                ctx.fillStyle = dbToColor(smoothedDb);
                ctx.beginPath();
                ctx.roundRect(0, y, BAR_WIDTH, barH, 1);
                ctx.fill();
            }

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [trackId, height]);

    return (
        <canvas
            ref={canvasRef}
            width={BAR_WIDTH}
            height={height}
            className="shrink-0 rounded-full"
            style={{ width: BAR_WIDTH, height }}
            aria-hidden="true"
        />
    );
};
