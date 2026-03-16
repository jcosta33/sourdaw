import { type ReactElement } from "react";
import { cn } from "#/helpers/Styles/cn";

type LevelMeterProps = {
    peak: number;
    rms: number;
    peakHold: number;
    height?: string;
    width?: string;
};

const DB_MARKS = [0, -6, -12, -24, -48] as const;
const MIN_DB = -60;

const linearToDb = (linear: number): number => {
    if (linear <= 0) return MIN_DB;
    return Math.max(MIN_DB, 20 * Math.log10(linear));
};

const dbToPercent = (db: number): number =>
    Math.max(0, Math.min(100, ((db - MIN_DB) / (0 - MIN_DB)) * 100));

const getMeterColor = (db: number): string => {
    if (db > -3) return "var(--color-destructive, #ef4444)";
    if (db > -12) return "var(--color-accent-warning, #eab308)";
    return "var(--color-accent-success, #22c55e)";
};

const buildGradient = (): string => {
    const redPct = dbToPercent(-3);
    const yellowPct = dbToPercent(-12);
    return `linear-gradient(to top, #22c55e 0%, #22c55e ${yellowPct}%, #eab308 ${yellowPct}%, #eab308 ${redPct}%, #ef4444 ${redPct}%, #ef4444 100%)`;
};

const METER_GRADIENT = buildGradient();

export const LevelMeter = ({
    peak,
    rms,
    peakHold,
    height = "h-full",
    width = "w-2",
}: LevelMeterProps): ReactElement => {
    const peakDb = linearToDb(peak);
    const rmsDb = linearToDb(rms);
    const holdDb = linearToDb(peakHold);

    const peakPct = dbToPercent(peakDb);
    const rmsPct = dbToPercent(rmsDb);
    const holdPct = dbToPercent(holdDb);

    const holdColor = getMeterColor(holdDb);

    return (
        <div
            className={cn("flex gap-px", height)}
            role="meter"
            aria-label="Level meter"
            aria-valuenow={Math.round(peakDb)}
            aria-valuemin={MIN_DB}
            aria-valuemax={0}
            aria-valuetext={`Peak ${peakDb > MIN_DB ? peakDb.toFixed(1) : "-∞"} dB, RMS ${rmsDb > MIN_DB ? rmsDb.toFixed(1) : "-∞"} dB`}
        >
            <div className="flex flex-col justify-between py-0.5 pr-px shrink-0">
                {DB_MARKS.map((db) => (
                    <span
                        key={db}
                        className="text-[6px] leading-none text-muted-foreground/50 text-right tabular-nums"
                        style={{ marginTop: db === 0 ? 0 : undefined }}
                    >
                        {db}
                    </span>
                ))}
            </div>

            <div className={cn("relative rounded-sm overflow-hidden bg-muted/20", width)}>
                <div
                    className="absolute bottom-0 left-0 w-full transition-[height] duration-75"
                    style={{
                        height: `${peakPct}%`,
                        background: METER_GRADIENT,
                        clipPath: `inset(${100 - peakPct}% 0 0 0)`,
                    }}
                />

                <div
                    className="absolute bottom-0 left-0 w-full transition-[height] duration-75"
                    style={{
                        height: `${rmsPct}%`,
                        background: METER_GRADIENT,
                        clipPath: `inset(${100 - rmsPct}% 0 0 0)`,
                        opacity: 0.45,
                    }}
                />

                {holdPct > 0 && (
                    <div
                        className="absolute left-0 w-full transition-[bottom] duration-150"
                        style={{
                            bottom: `${holdPct}%`,
                            height: "1.5px",
                            backgroundColor: holdColor,
                        }}
                    />
                )}
            </div>
        </div>
    );
};
