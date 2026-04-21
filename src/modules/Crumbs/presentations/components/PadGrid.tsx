/**
 * Velocity-sensitive pad grid for Drum mode.
 * 4x4 grid with drag-and-drop reordering, mini-waveform thumbnails,
 * and velocity-sensitive flash animations on trigger.
 */

import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { PadConfig } from '../../models/CrumbsTypes';

type PadGridProps = {
    pads: PadConfig[];
    selectedIndex: number;
    /** Optional per-pad waveform peaks for mini thumbnails (flattened min/max pairs). */
    padPeaks?: (number[] | null)[];
    onSelectPad: (index: number) => void;
    onTriggerPad: (index: number) => void;
    onReorderPad?: (fromIndex: number, toIndex: number) => void;
};

export const PadGrid = ({
    pads,
    selectedIndex,
    padPeaks,
    onSelectPad,
    onTriggerPad,
    onReorderPad,
}: PadGridProps): ReactElement => {
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dragOver, setDragOver] = useState<number | null>(null);
    const [flashingPads, setFlashingPads] = useState<Record<number, number>>({});
    const flashTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

    useEffect(() => {
        return () => {
            for (const timer of Object.values(flashTimers.current)) {
                clearTimeout(timer);
            }
        };
    }, []);

    function handleTrigger(index: number): void {
        onTriggerPad(index);

        // Velocity-sensitive flash animation
        const flashId = Date.now();
        setFlashingPads((prev) => ({ ...prev, [index]: flashId }));

        // Clear previous timer for this pad
        if (flashTimers.current[index]) {
            clearTimeout(flashTimers.current[index]);
        }

        flashTimers.current[index] = setTimeout(() => {
            setFlashingPads((prev) => {
                if (prev[index] === flashId) {
                    const next = { ...prev };
                    delete next[index];
                    return next;
                }
                return prev;
            });
        }, 150);
    }

    return (
        <div className="grid grid-cols-4 gap-1.5">
            {pads.map((pad, index) => {
                const isSelected = index === selectedIndex;
                const hasSample = pad.sampleId !== null;
                const isFlashing = flashingPads[index] !== undefined;
                const isDragTarget = dragOver === index && dragFrom !== null && dragFrom !== index;
                const peaks = padPeaks?.[index] ?? null;

                return (
                    <button
                        key={pad.id}
                        type="button"
                        draggable={onReorderPad !== undefined}
                        className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border transition-all ${(() => {
                            if (isDragTarget) {
                                return 'border-white/40 bg-white/[0.1]';
                            }
                            if (isSelected) {
                                return 'border-white/25 bg-white/[0.06]';
                            }
                            return 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]';
                        })()}`}
                        style={{
                            boxShadow: (() => {
                                if (isFlashing) {
                                    return `0 0 20px ${pad.color}88, inset 0 0 12px ${pad.color}44`;
                                }
                                if (isSelected) {
                                    return `0 0 12px ${pad.color}33`;
                                }
                                return undefined;
                            })(),
                        }}
                        onClick={() => onSelectPad(index)}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            handleTrigger(index);
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
                    </button>
                );
            })}
        </div>
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
        const min = peaks[i * 2]!;
        const max = peaks[i * 2 + 1]!;
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
