/**
 * CrossoverDisplay — interactive frequency spectrum with draggable crossover boundaries.
 *
 * Shows band regions with color coding and crossover frequency handles.
 */
import { type ReactElement, useLayoutEffect, useRef, useState } from 'react';

import { type BacteriaCrossoverMode } from '../../models/BacteriaPatch';

type CrossoverDisplayProps = {
    bandCount: number;
    crossoverFreqs: number[];
    crossoverMode: BacteriaCrossoverMode;
    activeBand: number;
    onBandSelect: (index: number) => void;
    onCrossoverChange: (index: number, freq: number) => void;
};

const BAND_COLORS = [
    'rgba(244,63,94,0.15)', // rose
    'rgba(251,146,60,0.15)', // orange
    'rgba(250,204,21,0.15)', // yellow
    'rgba(74,222,128,0.15)', // green
    'rgba(96,165,250,0.15)', // blue
    'rgba(167,139,250,0.15)', // violet
];

const BAND_BORDER_COLORS = [
    'rgba(244,63,94,0.6)',
    'rgba(251,146,60,0.6)',
    'rgba(250,204,21,0.6)',
    'rgba(74,222,128,0.6)',
    'rgba(96,165,250,0.6)',
    'rgba(167,139,250,0.6)',
];

function freqToX(freq: number, width: number): number {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    return ((Math.log10(freq) - minLog) / (maxLog - minLog)) * width;
}

function xToFreq(x: number, width: number): number {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    const log = minLog + (x / width) * (maxLog - minLog);
    return Math.round(10 ** log);
}

const DISPLAY_HEIGHT = 80;

export const CrossoverDisplay = ({
    bandCount,
    crossoverFreqs,
    crossoverMode,
    activeBand,
    onBandSelect,
    onCrossoverChange,
}: CrossoverDisplayProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const dragIndex = useRef<number | null>(null);
    // Track the container width so layout x-positions are computed from the real
    // measured width instead of reading clientWidth during render (which is 0 on
    // first paint before layout, leaving every band/handle mispositioned).
    const [containerWidth, setContainerWidth] = useState(0);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) {
            return undefined;
        }
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        setContainerWidth(el.clientWidth);
        return () => observer.disconnect();
    }, []);

    // Until the container is measured, fall back to a nominal width so the first
    // render still produces finite positions.
    const layoutWidth = containerWidth > 0 ? containerWidth : 800;

    const handlePointerDown = (e: React.PointerEvent, index: number): void => {
        e.stopPropagation();
        dragIndex.current = index;
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent): void => {
        if (dragIndex.current === null) {
            return;
        }
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const x = e.clientX - rect.left;
        const freq = Math.max(20, Math.min(20000, xToFreq(x, rect.width)));
        onCrossoverChange(dragIndex.current, freq);
    };

    const handlePointerUp = (): void => {
        dragIndex.current = null;
    };

    const handlePointerCancel = (): void => {
        dragIndex.current = null;
    };

    const handleBandClick = (e: React.PointerEvent): void => {
        if (dragIndex.current !== null) {
            return;
        }
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const x = e.clientX - rect.left;
        const freq = xToFreq(x, rect.width);

        // Determine which band was clicked
        for (let i = 0; i < bandCount; i++) {
            const lo = i === 0 ? 20 : crossoverFreqs[i - 1]!;
            const hi = i === bandCount - 1 ? 20000 : crossoverFreqs[i]!;
            if (freq >= lo && freq <= hi) {
                onBandSelect(i);
                break;
            }
        }
    };

    return (
        <div
            ref={containerRef}
            className="relative w-full shrink-0 cursor-pointer select-none"
            style={{
                height: DISPLAY_HEIGHT,
                background: 'linear-gradient(180deg, var(--surface-base) 0%, var(--surface-default) 100%)',
                borderBottom: '1px solid rgba(255,249,242,0.05)',
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerDown={handleBandClick}
        >
            {/* Frequency grid */}
            {[100, 1000, 10000].map((freq) => {
                const x = freqToX(freq, layoutWidth);
                return (
                    <div
                        key={freq}
                        className="absolute top-0 pointer-events-none"
                        style={{ left: x, width: 1, height: DISPLAY_HEIGHT, background: 'rgba(255,249,242,0.04)' }}
                    >
                        <span className="absolute bottom-0.5 left-1 text-[6px] text-muted-foreground/30 font-mono">
                            {freq >= 1000 ? `${freq / 1000}k` : freq}
                        </span>
                    </div>
                );
            })}

            {/* Band regions */}
            {Array.from({ length: bandCount }, (_, i) => {
                const lo = freqToX(i === 0 ? 20 : crossoverFreqs[i - 1]!, layoutWidth);
                const hi = freqToX(i === bandCount - 1 ? 20000 : crossoverFreqs[i]!, layoutWidth);
                return (
                    <div
                        key={i}
                        className="absolute top-0 pointer-events-none"
                        style={{
                            left: lo,
                            width: Math.max(0, hi - lo),
                            height: DISPLAY_HEIGHT,
                            background: BAND_COLORS[i % BAND_COLORS.length],
                            borderLeft:
                                i > 0 ? `1px solid ${BAND_BORDER_COLORS[i % BAND_BORDER_COLORS.length]}` : undefined,
                            opacity: activeBand === i ? 1 : 0.5,
                        }}
                    >
                        <span
                            className="absolute top-1 left-1 text-[7px] font-bold pointer-events-none"
                            style={{ color: BAND_BORDER_COLORS[i % BAND_BORDER_COLORS.length] }}
                        >
                            {i + 1}
                        </span>
                    </div>
                );
            })}

            {/* Crossover handles */}
            {Array.from({ length: Math.max(0, bandCount - 1) }, (_, i) => {
                const x = freqToX(crossoverFreqs[i]!, layoutWidth);
                return (
                    <div
                        key={`handle-${i}`}
                        className="absolute top-0 cursor-ew-resize"
                        style={{ left: x - 4, width: 8, height: DISPLAY_HEIGHT }}
                        onPointerDown={(e) => handlePointerDown(e, i)}
                    >
                        <div
                            className="absolute left-[3px] top-0 w-0.5 rounded-full"
                            style={{
                                height: DISPLAY_HEIGHT,
                                background: BAND_BORDER_COLORS[(i + 1) % BAND_BORDER_COLORS.length],
                            }}
                        />
                    </div>
                );
            })}

            {/* Mode indicator */}
            <span className="absolute top-1 right-1 text-[6px] text-muted-foreground/30 font-mono uppercase">
                {crossoverMode}
            </span>
        </div>
    );
};
