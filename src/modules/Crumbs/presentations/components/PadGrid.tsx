/**
 * Pad grid for Drum mode.
 * 4x4 grid with drag-and-drop reordering, mini-waveform thumbnails,
 * and a flash animation on trigger. Triggers fire at a fixed velocity today;
 * the flash intensity is driven by the pad color, not by velocity.
 */

import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Grid } from '#/components/layout';
import { Button } from '#/components/ui/button';

import type { PadConfig } from '../../models/CrumbsTypes';

type PadGridProps = {
    pads: PadConfig[];
    selectedIndex: number;
    /** Optional per-pad waveform peaks for mini thumbnails (flattened min/max pairs). */
    padPeaks?: (number[] | null)[];
    onSelectPad: (index: number) => void;
    onTriggerPad: (index: number) => void;
    /**
     * Release the pad's note. Called on pointer/key up and on pointer leave so a
     * non-one-shot or long-release voice is stopped when the user lets go, rather
     * than sustaining until the engine envelope decides on its own.
     */
    onTriggerPadOff?: (index: number) => void;
    onReorderPad?: (fromIndex: number, toIndex: number) => void;
};

export const PadGrid = ({
    pads,
    selectedIndex,
    padPeaks,
    onSelectPad,
    onTriggerPad,
    onTriggerPadOff,
    onReorderPad,
}: PadGridProps): ReactElement => {
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dragOver, setDragOver] = useState<number | null>(null);
    // Flash state is keyed by stable pad.id, not grid index: a reorder mid-flash
    // must keep the flash on the pad that was struck, not on whatever pad now sits
    // at that index.
    const [flashingPads, setFlashingPads] = useState<Record<number, number>>({});
    const flashTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
    // Pads currently held down (keyed by stable pad.id). A note-off must fire once
    // per press: mouseUp and mouseLeave can both follow a single mouseDown, so the
    // held set gates the release to exactly the first one that lands.
    const heldPads = useRef<Set<number>>(new Set());

    useEffect(() => {
        const timers = flashTimers.current;
        return () => {
            for (const timer of Object.values(timers)) {
                clearTimeout(timer);
            }
        };
    }, []);

    // Cancel timers for pads that no longer exist (e.g. an instance swap drops a
    // pad.id), so a pending flash timer can never resolve against a removed pad.
    // Any flash key left over from a removed pad is inert — rendering keys by
    // pad.id, so a vanished pad is simply not drawn.
    useEffect(() => {
        const liveIds = new Set(pads.map((pad) => pad.id));
        for (const key of Object.keys(flashTimers.current)) {
            const id = Number(key);
            if (!liveIds.has(id)) {
                clearTimeout(flashTimers.current[id]);
                delete flashTimers.current[id];
            }
        }
    }, [pads]);

    function handleTrigger(index: number, padId: number): void {
        onTriggerPad(index);
        heldPads.current.add(padId);

        const flashId = Date.now();
        setFlashingPads((prev) => ({ ...prev, [padId]: flashId }));

        // Clear previous timer for this pad
        if (flashTimers.current[padId]) {
            clearTimeout(flashTimers.current[padId]);
        }

        flashTimers.current[padId] = setTimeout(() => {
            setFlashingPads((prev) => {
                if (prev[padId] === flashId) {
                    const next = { ...prev };
                    delete next[padId];
                    return next;
                }
                return prev;
            });
        }, 150);
    }

    function handleRelease(index: number, padId: number): void {
        // Only release a pad we actually triggered, and only once: drop it from the
        // held set first so a trailing mouseLeave after mouseUp is a no-op.
        if (!heldPads.current.delete(padId)) {
            return;
        }
        onTriggerPadOff?.(index);
    }

    return (
        <Grid cols={4} gap={1.5}>
            {pads.map((pad, index) => {
                const isSelected = index === selectedIndex;
                const hasSample = pad.sampleId !== null;
                const isFlashing = flashingPads[pad.id] !== undefined;
                const isDragTarget = dragOver === index && dragFrom !== null && dragFrom !== index;
                const peaks = padPeaks?.[index] ?? null;

                let padClassName = 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]';
                if (isDragTarget) {
                    padClassName = 'border-white/40 bg-white/[0.1]';
                } else if (isSelected) {
                    padClassName = 'border-white/25 bg-white/[0.06]';
                }

                let padBoxShadow: string | undefined = undefined;
                if (isFlashing) {
                    padBoxShadow = `0 0 20px ${pad.color}88, inset 0 0 12px ${pad.color}44`;
                } else if (isSelected) {
                    padBoxShadow = `0 0 12px ${pad.color}33`;
                }

                return (
                    <Button
                        variant="bare"
                        size="bare"
                        key={pad.id}
                        type="button"
                        draggable={onReorderPad !== undefined}
                        aria-pressed={isSelected}
                        aria-label={`${pad.name}${hasSample ? '' : ' (empty)'}`}
                        className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border transition-all ${padClassName}`}
                        style={{
                            boxShadow: padBoxShadow,
                        }}
                        onClick={() => onSelectPad(index)}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            handleTrigger(index, pad.id);
                        }}
                        onMouseUp={() => handleRelease(index, pad.id)}
                        onMouseLeave={() => handleRelease(index, pad.id)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectPad(index);
                                handleTrigger(index, pad.id);
                            }
                        }}
                        onKeyUp={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleRelease(index, pad.id);
                            }
                        }}
                        onDragStart={() => setDragFrom(index)}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragOver(index);
                        }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={(e) => {
                            e.preventDefault();
                            if (dragFrom !== null && dragFrom !== index && onReorderPad) {
                                onReorderPad(dragFrom, index);
                            }
                            setDragFrom(null);
                            setDragOver(null);
                        }}
                        onDragEnd={() => {
                            setDragFrom(null);
                            setDragOver(null);
                        }}
                    >
                        {/* Flash overlay */}
                        {isFlashing ? (
                            <div
                                className="pointer-events-none absolute inset-0 rounded-xl opacity-40 transition-opacity duration-150"
                                style={{ backgroundColor: pad.color }}
                            />
                        ) : null}

                        {/* Mini waveform thumbnail */}
                        {peaks !== null && peaks.length > 0 ? (
                            <MiniWaveform peaks={peaks} color={pad.color} />
                        ) : (
                            <div
                                className="mb-1 size-2 rounded-full"
                                style={{
                                    backgroundColor: hasSample ? pad.color : 'rgba(255,255,255,0.1)',
                                }}
                            />
                        )}

                        <span className="relative text-[9px] font-medium text-foreground/70">{pad.name}</span>
                    </Button>
                );
            })}
        </Grid>
    );
};

/** Tiny inline waveform rendered as CSS background for each pad. */
const MiniWaveform = ({ peaks, color }: { peaks: number[]; color: string }): ReactElement => {
    const numBins = Math.floor(peaks.length / 2);
    if (numBins === 0) {
        return <div className="mb-1 size-2 rounded-full" />;
    }

    // Build a tiny SVG path for the waveform
    const w = 36;
    const h = 16;
    const mid = h / 2;
    const binWidth = w / numBins;

    let pathD = '';
    for (let i = 0; i < numBins; i++) {
        const min = peaks[i * 2] ?? 0;
        const max = peaks[i * 2 + 1] ?? 0;
        const x = i * binWidth + binWidth / 2;
        const yTop = mid - max * mid;
        const yBot = mid - min * mid;
        pathD += `M${x.toFixed(1)},${yTop.toFixed(1)}L${x.toFixed(1)},${yBot.toFixed(1)}`;
    }

    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mb-0.5 opacity-60">
            <path d={pathD} stroke={color} strokeWidth="1" fill="none" />
        </svg>
    );
};
