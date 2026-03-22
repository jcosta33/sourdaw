import { type ReactElement, useRef, useEffect, useSyncExternalStore } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { type TimeDisplayMode } from '../../../models/WorkspaceState';
import { workspaceStore } from '../../../stores/workspaceStore';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { transportStore } from '#/modules/Transport/stores/transportStore';

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

type PlayheadDisplayProps = {
    tempo: number;
    numerator: number;
    timeDisplayMode: TimeDisplayMode;
};

/**
 * PlayheadDisplay reads playhead position from the non-reactive
 * `playheadPositionRef` via a rAF loop and writes directly to the DOM.
 * This avoids ~100 React re-renders/sec during playback.
 */
export const PlayheadDisplay = ({
    tempo,
    numerator,
    timeDisplayMode,
}: PlayheadDisplayProps): ReactElement => {
    const isMusical = timeDisplayMode === 'musical';
    const isPlaying = useSyncExternalStore(
        (cb) => transportStore.subscribe(cb),
        () => transportStore.value?.isPlaying ?? false
    );

    // Refs for direct DOM updates
    const seg1Ref = useRef<HTMLSpanElement>(null);
    const seg2Ref = useRef<HTMLSpanElement>(null);
    const seg3Ref = useRef<HTMLSpanElement>(null);
    const rafRef = useRef(0);
    const tempoRef = useRef(tempo);
    const numeratorRef = useRef(numerator);
    const isMusicalRef = useRef(isMusical);

    // Keep refs in sync with props (avoids stale closures in rAF loop)
    tempoRef.current = tempo;
    numeratorRef.current = numerator;
    isMusicalRef.current = isMusical;

    // Update segments once from current position (initial + on mode toggle)
    const updateOnce = (): void => {
        const position = playheadPositionRef.current;
        if (isMusicalRef.current) {
            const bar = Math.floor(position / numeratorRef.current) + 1;
            const beat = Math.floor(position % numeratorRef.current) + 1;
            const tick = Math.floor((position % 1) * 480);
            if (seg1Ref.current) {
                seg1Ref.current.textContent = String(bar);
            }
            if (seg2Ref.current) {
                seg2Ref.current.textContent = String(beat);
            }
            if (seg3Ref.current) {
                seg3Ref.current.textContent = String(tick).padStart(3, '0');
            }
        } else {
            const seconds = position / (tempoRef.current / 60);
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            const ms = Math.floor((seconds % 1) * 1000);
            if (seg1Ref.current) {
                seg1Ref.current.textContent = String(mins).padStart(2, '0');
            }
            if (seg2Ref.current) {
                seg2Ref.current.textContent = String(secs).padStart(2, '0');
            }
            if (seg3Ref.current) {
                seg3Ref.current.textContent = String(ms).padStart(3, '0');
            }
        }
    };

    // rAF loop for live updates during playback
    useEffect(() => {
        // Always do an initial update
        updateOnce();

        if (!isPlaying) {
            return;
        }
        const loop = (): void => {
            updateOnce();
            rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying, isMusical]);

    // Compute initial values for SSR / first paint
    const position = playheadPositionRef.current;

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
                        <span className="text-[10px] text-muted-foreground/60 uppercase mr-1 font-sans font-normal">
                            Bars
                        </span>
                        <span ref={seg1Ref} className="text-xl text-foreground min-w-8 text-right">{bar}</span>
                        <span className="text-sm text-muted-foreground mt-1">:</span>
                        <span ref={seg2Ref} className="text-xl text-foreground min-w-6">{beat}</span>
                        <span className="text-sm text-muted-foreground mt-1">:</span>
                        <span ref={seg3Ref} className="text-sm text-muted-foreground min-w-8 mt-1">
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
                    <span className="text-[10px] text-muted-foreground/60 uppercase mr-1 font-sans font-normal">
                        Time
                    </span>
                    <span ref={seg1Ref} className="text-xl text-foreground min-w-8 text-right">{String(mins).padStart(2, '0')}</span>
                    <span className="text-sm text-muted-foreground mt-1">:</span>
                    <span ref={seg2Ref} className="text-xl text-foreground min-w-6">{String(secs).padStart(2, '0')}</span>
                    <span className="text-sm text-muted-foreground mt-1">.</span>
                    <span ref={seg3Ref} className="text-sm text-muted-foreground min-w-8 mt-1">{String(ms).padStart(3, '0')}</span>
                </button>
            </TooltipTrigger>
            <TooltipContent>Click to switch to bars &amp; beats</TooltipContent>
        </Tooltip>
    );
};
