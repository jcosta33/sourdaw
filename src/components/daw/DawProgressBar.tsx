import { type ReactElement } from 'react';

type DawProgressBarProps = {
    /** Progress value 0–1 */
    progress: number;
    /** Label shown above the bar */
    label?: string;
    /** Accent color CSS variable name (without var()) */
    color?: string;
};

export const DawProgressBar = ({
    progress,
    label,
    color = '--color-accent-peach',
}: DawProgressBarProps): ReactElement => {
    const percent = Math.round(progress * 100);
    return (
        <div className="space-y-1.5">
            {label ? <p className="text-[9px] text-muted-foreground">{label}</p> : null}
            <div
                className="w-full h-1 bg-border/40 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div
                    className="h-full transition-all"
                    style={{ width: `${String(percent)}%`, backgroundColor: `var(${color})` }}
                />
            </div>
            <p className="text-[9px] text-muted-foreground/60 tabular-nums">{percent}%</p>
        </div>
    );
};
