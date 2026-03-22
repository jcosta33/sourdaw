import { type ReactElement, useEffect, useRef } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { resolveToken } from '#/helpers/UI/resolveToken';
import { getTrackPeakLevel, getMasterPeakLevel } from '../../useCases/workspaceViewActions';
import { animationScheduler } from '#/helpers/DOM/AnimationScheduler';

type LevelMeterProps = {
    trackId: string | null;
    height?: string;
    width?: string;
};

const DB_MARKS = [0, -6, -12, -24, -48] as const;
const MIN_DB = -60;
const RMS_BUFFER_SIZE = 30;
const PEAK_HOLD_DURATION_MS = 1500;
const PEAK_HOLD_FALL_RATE = 0.02;

const linearToDb = (linear: number): number => {
    if (linear <= 0) {
        return MIN_DB;
    }
    return Math.max(MIN_DB, 20 * Math.log10(linear));
};

const dbToPercent = (db: number): number => Math.max(0, Math.min(100, ((db - MIN_DB) / (0 - MIN_DB)) * 100));

export const LevelMeter = ({
    trackId,
    height = 'h-full',
    width = 'w-2',
}: LevelMeterProps): ReactElement => {
    const id = crypto.randomUUID();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rmsBufferRef = useRef<number[]>([]);
    const peakHoldRef = useRef(0);
    const peakHoldTimeRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        let w = container.clientWidth;
        let h = container.clientHeight;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                w = entry.contentRect.width;
                h = entry.contentRect.height;
                const dpr = window.devicePixelRatio || 1;
                canvas.width = w * dpr;
                canvas.height = h * dpr;
                ctx.scale(dpr, dpr);
            }
        });
        resizeObserver.observe(container);

        const safe = resolveToken('--color-meter-safe', '#4a9060');
        const hot = resolveToken('--color-meter-hot', '#b09040');
        const clip = resolveToken('--color-meter-clip', '#b05050');

        const getMeterColor = (db: number): string => {
            if (db > -3) {
                return clip;
            }
            if (db > -12) {
                return hot;
            }
            return safe;
        };

        rmsBufferRef.current = [];
        peakHoldRef.current = 0;
        peakHoldTimeRef.current = 0;

        const tick = () => {
            const now = performance.now();
            const rawPeak = trackId ? getTrackPeakLevel(trackId) : getMasterPeakLevel();

            const buf = rmsBufferRef.current;
            buf.push(rawPeak * rawPeak);
            if (buf.length > RMS_BUFFER_SIZE) {
                buf.shift();
            }

            let sumSquares = 0;
            for (let i = 0; i < buf.length; i++) {
                sumSquares += buf[i]!;
            }
            const rawRms = Math.sqrt(sumSquares / buf.length);

            if (rawPeak >= peakHoldRef.current) {
                peakHoldRef.current = rawPeak;
                peakHoldTimeRef.current = now;
            } else if (now - peakHoldTimeRef.current > PEAK_HOLD_DURATION_MS) {
                peakHoldRef.current = Math.max(0, peakHoldRef.current - PEAK_HOLD_FALL_RATE);
            }

            const holdDb = linearToDb(peakHoldRef.current);
            const peakPct = dbToPercent(linearToDb(rawPeak));
            const rmsPct = dbToPercent(linearToDb(rawRms));
            const holdPct = dbToPercent(holdDb);

            ctx.clearRect(0, 0, w, h);

            if (h > 0 && w > 0) {
                const grad = ctx.createLinearGradient(0, h, 0, 0);
                grad.addColorStop(0, safe);
                grad.addColorStop(Math.min(1, dbToPercent(-12) / 100), safe);
                grad.addColorStop(Math.min(1, dbToPercent(-12) / 100 + 0.001), hot);
                grad.addColorStop(Math.min(1, dbToPercent(-3) / 100), hot);
                grad.addColorStop(Math.min(1, dbToPercent(-3) / 100 + 0.001), clip);
                grad.addColorStop(1, clip);

                const rmsY = h - (h * rmsPct) / 100;
                ctx.globalAlpha = 0.45;
                ctx.fillStyle = grad;
                ctx.fillRect(0, rmsY, w, h - rmsY);

                const peakY = h - (h * peakPct) / 100;
                ctx.globalAlpha = 1.0;
                ctx.fillRect(0, peakY, w, h - peakY);

                if (holdPct > 0) {
                    const holdY = Math.max(0, h - (h * holdPct) / 100 - 1.5);
                    ctx.fillStyle = getMeterColor(holdDb);
                    ctx.fillRect(0, holdY, w, 1.5);
                }
            }
        };

        animationScheduler.register(`meter-${id}`, tick);

        return () => {
            animationScheduler.unregister(`meter-${id}`);
            resizeObserver.disconnect();
        };
    }, [trackId]);

    return (
        <div
            className={cn('flex gap-px', height)}
            role="meter"
            aria-label="Level meter"
            aria-valuemin={MIN_DB}
            aria-valuemax={0}
        >
            <div className="flex flex-col justify-between py-0.5 pr-px shrink-0">
                {DB_MARKS.map((db) => (
                    <span
                        key={db}
                        className="text-[6px] leading-none text-muted-foreground/50 text-right tabular-nums block"
                        style={{ marginTop: db === 0 ? 0 : undefined }}
                    >
                        {db}
                    </span>
                ))}
            </div>

            <div ref={containerRef} className={cn('relative rounded-sm overflow-hidden bg-muted/20', width)}>
                <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
            </div>
        </div>
    );
};
