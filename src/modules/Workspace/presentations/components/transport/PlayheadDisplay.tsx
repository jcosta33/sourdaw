import { type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { type TimeDisplayMode } from '../../../models/WorkspaceState';
import { workspaceStore } from '../../../stores/workspaceStore';

const toggleTimeDisplayMode = (): void => {
    const current = workspaceStore.value;
    if (!current) {
        return;
    }
    workspaceStore.set({
        ...current,
        timeDisplayMode: current.timeDisplayMode === 'musical' ? 'time' : 'musical',
    });
};

export type PlayheadDisplayProps = {
    position: number;
    tempo: number;
    numerator: number;
    timeDisplayMode: TimeDisplayMode;
};

export const PlayheadDisplay = ({
    position,
    tempo,
    numerator,
    timeDisplayMode,
}: PlayheadDisplayProps): ReactElement => {
    const isMusical = timeDisplayMode === 'musical';

    if (isMusical) {
        const bar = Math.floor(position / numerator) + 1;
        const beat = Math.floor(position % numerator) + 1;
        const tick = Math.floor((position % 1) * 480);

        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className="flex items-center gap-0.5 font-mono tabular-nums rounded px-2 py-0.5 hover:bg-accent transition-colors font-medium"
                        onClick={toggleTimeDisplayMode}
                        aria-label="Playhead position — click to switch to wall-clock time"
                    >
                        <span className="text-[10px] text-muted-foreground/60 uppercase mr-1 font-sans font-normal">Bars</span>
                        <span className="text-xl text-foreground min-w-8 text-right">{bar}</span>
                        <span className="text-sm text-muted-foreground mt-1">:</span>
                        <span className="text-xl text-foreground min-w-6">{beat}</span>
                        <span className="text-sm text-muted-foreground mt-1">:</span>
                        <span className="text-sm text-muted-foreground min-w-8 mt-1">
                            {String(tick).padStart(3, '0')}
                        </span>
                    </button>
                </TooltipTrigger>
                <TooltipContent>Click to switch to wall-clock time</TooltipContent>
            </Tooltip>
        );
    }

    const seconds = position / (tempo / 60);
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-0.5 font-mono tabular-nums rounded px-2 py-0.5 hover:bg-accent transition-colors font-medium"
                    onClick={toggleTimeDisplayMode}
                    aria-label="Playhead position — click to switch to bars and beats"
                >
                    <span className="text-[10px] text-muted-foreground/60 uppercase mr-1 font-sans font-normal">Time</span>
                    <span className="text-xl text-foreground min-w-8 text-right">{String(mins).padStart(2, '0')}</span>
                    <span className="text-sm text-muted-foreground mt-1">:</span>
                    <span className="text-xl text-foreground min-w-6">{String(secs).padStart(2, '0')}</span>
                    <span className="text-sm text-muted-foreground mt-1">.</span>
                    <span className="text-sm text-muted-foreground min-w-8 mt-1">{String(ms).padStart(3, '0')}</span>
                </button>
            </TooltipTrigger>
            <TooltipContent>Click to switch to bars &amp; beats</TooltipContent>
        </Tooltip>
    );
};
