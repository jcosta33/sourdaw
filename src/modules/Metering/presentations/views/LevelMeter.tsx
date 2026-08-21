import { type ReactElement, useEffect, useRef, useState } from 'react';

import { DawMeterFrame } from '#/components/daw/DawMeterFrame';
import { Stack } from '#/components/layout';
import { getTrackPeakLevel, getMasterPeakLevel, VUMeter } from '#/modules/AudioEngine/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';
import { cn } from '#/utils/Styles/cn';
import { resolveToken } from '#/utils/UI/resolveToken';

type LevelMeterProps = {
    trackId: string | null;
    height?: string;
    width?: string;
};

const DB_MARKS = [0, -6, -12, -24, -48] as const;
const MIN_DB = -60;
const PEAK_HOLD_DURATION_MS = 1500;
const PEAK_HOLD_FALL_RATE = 0.02;

const linearToDb = (linear: number): number => {
    if (linear <= 0) {
        return MIN_DB;
    }
    return Math.max(MIN_DB, 20 * Math.log10(linear));
};

const dbToPercent = (db: number): number => Math.max(0, Math.min(100, ((db - MIN_DB) / (0 - MIN_DB)) * 100));

export const LevelMeter = ({ trackId, height = 'h-full', width = 'w-2' }: LevelMeterProps): ReactElement => {
    const [schedulerId] = useState(() => `meter-${crypto.randomUUID()}`);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    /** The `role="meter"` element, updated imperatively alongside the canvas. */
    const meterRef = useRef<HTMLDivElement>(null);
    /** Last announced string, so the tick only touches the DOM when it changes. */
    const lastValueTextRef = useRef<string>('');
    const vuMeterRef = useRef(new VUMeter());
    const vuSampleRef = useRef<Float32Array>(new Float32Array(1));
    const peakHoldRef = useRef(0);
    const peakHoldTimeRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return () => {};
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return () => {};
        }

        let w = container.clientWidth;
        let h = container.clientHeight;

        const safe = resolveToken('--color-meter-safe', '#00CC44');
        const hot = resolveToken('--color-meter-hot', '#CCCC00');
        const clip = resolveToken('--color-meter-clip', '#FF3300');

        // §184.x — rebuild the meter gradient only when dimensions change,
        // not on every rAF tick. The stops are derived from fixed dB
        // thresholds and a fixed color palette.
        let meterGradient: CanvasGradient | null = null;
        const rebuildGradient = (): void => {
            meterGradient = ctx.createLinearGradient(0, h, 0, 0);
            meterGradient.addColorStop(0, safe);
            meterGradient.addColorStop(Math.min(1, dbToPercent(-12) / 100), safe);
            meterGradient.addColorStop(Math.min(1, dbToPercent(-12) / 100 + 0.001), hot);
            meterGradient.addColorStop(Math.min(1, dbToPercent(-3) / 100), hot);
            meterGradient.addColorStop(Math.min(1, dbToPercent(-3) / 100 + 0.001), clip);
            meterGradient.addColorStop(1, clip);
        };
        rebuildGradient();

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                w = entry.contentRect.width;
                h = entry.contentRect.height;
                const dpr = window.devicePixelRatio || 1;
                canvas.width = w * dpr;
                canvas.height = h * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                rebuildGradient();
            }
        });
        resizeObserver.observe(container);

        const getMeterColor = (db: number): string => {
            if (db > -3) {
                return clip;
            }
            if (db > -12) {
                return hot;
            }
            return safe;
        };

        vuMeterRef.current.reset();
        vuSampleRef.current[0] = 0;
        peakHoldRef.current = 0;
        peakHoldTimeRef.current = 0;

        /**
         * Keep the assistive-technology surface in step with the canvas. When
         * `aria-valuetext` is present it is what a screen reader announces in
         * place of `aria-valuenow`, so "unavailable" can be said without leaving
         * `role="meter"` non-conformant or asserting a level nobody measured.
         */
        const announceMeterValue = (valueText: string, valueNow: number): void => {
            if (lastValueTextRef.current === valueText) {
                return;
            }
            lastValueTextRef.current = valueText;
            const meter = meterRef.current;
            if (!meter) {
                return;
            }
            meter.setAttribute('aria-valuetext', valueText);
            meter.setAttribute('aria-valuenow', valueNow.toFixed(1));
        };

        const tick = (currentTime: DOMHighResTimeStamp, deltaMs: number) => {
            const rawPeak = trackId ? getTrackPeakLevel(trackId) : getMasterPeakLevel();
            if (rawPeak === null) {
                // Master bus with no meter tap wired: there is no level to paint.
                // The -∞ frame (black bed, LED gaps, no fill) is the picture a
                // genuinely silent mix draws, so painting it here would tell a
                // user whose audio is playing that the master bus is dead. Leave
                // the canvas clear, and drop the carried state — the held peak and
                // the VU ballistics both describe a bus nobody is measuring any
                // more, and a retained VU charge would paint a partial RMS fill on
                // the first recovered frame.
                peakHoldRef.current = 0;
                peakHoldTimeRef.current = 0;
                vuMeterRef.current.reset();
                ctx.clearRect(0, 0, w, h);
                // Without this the visual and audible surfaces disagree: a sighted
                // user sees a blank meter while a screen reader is told a number.
                announceMeterValue('unavailable', MIN_DB);
                return;
            }
            const peakDb = linearToDb(rawPeak);
            announceMeterValue(`${peakDb.toFixed(1)} dB`, peakDb);
            vuSampleRef.current[0] = rawPeak;
            const rawRms = vuMeterRef.current.update(vuSampleRef.current, Math.max(0, deltaMs) / 1000);
            if (rawPeak >= peakHoldRef.current) {
                peakHoldRef.current = rawPeak;
                peakHoldTimeRef.current = currentTime;
            } else if (currentTime - peakHoldTimeRef.current > PEAK_HOLD_DURATION_MS) {
                peakHoldRef.current = Math.max(0, peakHoldRef.current - PEAK_HOLD_FALL_RATE);
            }

            const holdDb = linearToDb(peakHoldRef.current);
            const peakPct = dbToPercent(linearToDb(rawPeak));
            const rmsPct = dbToPercent(linearToDb(rawRms));
            const holdPct = dbToPercent(holdDb);

            ctx.clearRect(0, 0, w, h);

            if (h > 0 && w > 0) {
                // Deep black background
                ctx.fillStyle = '#050508';
                ctx.fillRect(0, 0, w, h);

                // §184.x — use cached gradient (rebuilt only on resize).
                // RMS — dimmer background fill
                const rmsY = h - (h * rmsPct) / 100;
                ctx.globalAlpha = 0.35;
                ctx.fillStyle = meterGradient!;
                ctx.fillRect(0, rmsY, w, h - rmsY);

                // Peak — bright fill
                const peakY = h - (h * peakPct) / 100;
                ctx.globalAlpha = 1.0;
                ctx.fillRect(0, peakY, w, h - peakY);

                // Segmented LED look — dark gaps every 2px
                ctx.globalAlpha = 1.0;
                ctx.fillStyle = '#050508';
                for (let sy = 0; sy < h; sy += 4) {
                    ctx.fillRect(0, sy, w, 1);
                }

                // Peak hold indicator with glow
                if (holdPct > 0) {
                    const holdY = Math.max(0, h - (h * holdPct) / 100 - 1.5);
                    ctx.fillStyle = getMeterColor(holdDb);
                    ctx.shadowColor = getMeterColor(holdDb);
                    ctx.shadowBlur = 6;
                    ctx.fillRect(0, holdY, w, 1.5);
                    ctx.shadowBlur = 0;
                }
            }
        };

        animationScheduler.register(schedulerId, tick);

        return () => {
            animationScheduler.unregister(schedulerId);
            resizeObserver.disconnect();
        };
    }, [schedulerId, trackId]);

    return (
        <div
            ref={meterRef}
            className={cn('flex gap-px', height)}
            role="meter"
            aria-label="Level meter"
            aria-valuemin={MIN_DB}
            aria-valuemax={0}
            // Pre-tick state: nothing has been measured, so the announced value is
            // "unavailable". The tick replaces both attributes from the first frame
            // that has a real level; `aria-valuenow` keeps `role="meter"`
            // conformant while `aria-valuetext` carries what is actually said.
            aria-valuenow={MIN_DB}
            aria-valuetext="unavailable"
        >
            <Stack justify="between" shrink={false} className="py-0.5 pr-px">
                {DB_MARKS.map((db) => (
                    <span
                        key={db}
                        className="text-[6px] leading-none text-muted-foreground/50 text-right tabular-nums block"
                        style={{ marginTop: db === 0 ? 0 : undefined }}
                    >
                        {db}
                    </span>
                ))}
            </Stack>

            <DawMeterFrame overlay="vertical" ref={containerRef} className={cn('rounded-sm', width)}>
                <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
            </DawMeterFrame>
        </div>
    );
};
