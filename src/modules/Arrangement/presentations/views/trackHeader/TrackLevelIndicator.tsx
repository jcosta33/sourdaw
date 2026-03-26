/**
 * TrackLevelIndicator — tiny per-track dB meter bar.
 *
 * A 3px-wide vertical bar rendered on Canvas that reads from the track's
 * AnalyserNode via `getTrackStripAnalyser()`. Color gradient goes from
 * transparent (silent) → blue (quiet) → green (normal) → yellow (warm) → red (hot).
 * Uses requestAnimationFrame with no React state updates for zero re-render cost.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { getTrackStripAnalyser } from '#/modules/AudioEngine/useCases/engineAccess';

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
    if (db <= DB_FLOOR) return 'transparent';
    const norm = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEILING - DB_FLOOR)));

    if (norm < 0.25) {
        // Silent → blue
        const t = norm / 0.25;
        return `rgba(60, 100, ${lerp(180, 200, t)}, ${(t * 0.8).toFixed(2)})`;
    }
    if (norm < 0.5) {
        // Blue → green
        const t = (norm - 0.25) / 0.25;
        return `rgb(${lerp(60, 50, t)}, ${lerp(100, 180, t)}, ${lerp(200, 80, t)})`;
    }
    if (norm < 0.75) {
        // Green → yellow
        const t = (norm - 0.5) / 0.25;
        return `rgb(${lerp(50, 210, t)}, ${lerp(180, 180, t)}, ${lerp(80, 40, t)})`;
    }
    // Yellow → red
    const t = (norm - 0.75) / 0.25;
    return `rgb(${lerp(210, 220, t)}, ${lerp(180, 60, t)}, ${lerp(40, 50, t)})`;
};

export const TrackLevelIndicator = ({ trackId, height }: TrackLevelIndicatorProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = BAR_WIDTH * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        let rafId = 0;
        let smoothedDb = DB_FLOOR;

        const draw = (): void => {
            const analyser = getTrackStripAnalyser(trackId);
            let currentDb = DB_FLOOR;

            if (analyser) {
                const data = new Float32Array(analyser.fftSize);
                analyser.getFloatTimeDomainData(data);

                // Compute RMS
                let sum = 0;
                for (let i = 0; i < data.length; i++) {
                    sum += data[i]! * data[i]!;
                }
                const rms = Math.sqrt(sum / data.length);
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
