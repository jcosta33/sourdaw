import { type ReactElement, useEffect, useRef, useState, type PointerEvent } from 'react';

import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { analyzePitchForClip } from '#/modules/AudioEngine/useCases';
import { commitPitchEditCommand } from '#/modules/Command/useCases';
import { kneadStore, defaultKneadState } from '#/modules/Knead/stores';
import { resolveToken } from '#/utils/UI/resolveToken';

type PitchEditorProps = {
    clipId: string;
};

export const PitchEditor = ({ clipId }: PitchEditorProps): ReactElement => {
    const kneadState = useStore(kneadStore, defaultKneadState);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom] = useState(1);

    // We store the manual shifts array in React state for immediate interactive feedback.
    // In a real application, this might live in the store or be synchronized.
    const [shifts, setShifts] = useState<{ start_time_ms: number; end_time_ms: number; shift_semitones: number }[]>([]);

    const dragRef = useRef<{ startY: number; initialShift: number; segmentIndex: number } | null>(null);

    // Any contour data available for this clip?
    // We cast to any because the store type hasn't been strictly updated yet.
    const contour = (kneadState as any).pitchContour;

    // Generate segments from contour if none exist yet.
    useEffect(() => {
        if (contour && shifts.length === 0) {
            // Simplistic segmentation: one segment per 100ms
            const newShifts = [];
            const duration = contour.points[contour.points.length - 1]?.time_ms || 0;
            for (let index = 0; index < duration; index += 100) {
                newShifts.push({ start_time_ms: index, end_time_ms: index + 100, shift_semitones: 0 });
            }
            setShifts(newShifts);
        }
    }, [contour]);

    const draw = () => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !contour) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const width = container.clientWidth * zoom;
        const height = container.clientHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        if (!contour.points || contour.points.length === 0) {
            return;
        }

        // Determine min/max frequency to scale the Y axis
        let minHz = 20000;
        let maxHz = 0;
        for (const pt of contour.points) {
            if (pt.voiced && pt.frequency_hz > 20) {
                if (pt.frequency_hz < minHz) {
                    minHz = pt.frequency_hz;
                }
                if (pt.frequency_hz > maxHz) {
                    maxHz = pt.frequency_hz;
                }
            }
        }

        // Add some padding
        minHz = Math.max(20, minHz * 0.8);
        maxHz = maxHz * 1.2;

        const hzToY = (hz: number, semitoneShift = 0) => {
            // Apply shift
            const shiftedHz = hz * 2 ** (semitoneShift / 12);
            // Log scale for pitch
            const logMin = Math.log2(minHz);
            const logMax = Math.log2(maxHz);
            const logHz = Math.log2(shiftedHz);
            const norm = (logHz - logMin) / (logMax - logMin);
            return height - norm * height;
        };

        const totalTimeMs = contour.points[contour.points.length - 1].time_ms;
        const msToX = (ms: number) => (ms / totalTimeMs) * width;

        // Draw the pitch contour as connected segments
        ctx.strokeStyle = resolveToken('--color-accent-peach', '#ffb86c');
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        let isDrawing = false;

        const getShiftAtTime = (ms: number) => {
            const seg = shifts.find((state) => ms >= state.start_time_ms && ms < state.end_time_ms);
            return seg ? seg.shift_semitones : 0;
        };

        for (let index = 0; index < contour.points.length; index++) {
            const pt = contour.points[index];

            if (pt.voiced && pt.confidence > 0.3) {
                const shift = getShiftAtTime(pt.time_ms);
                const x = msToX(pt.time_ms);
                const y = hzToY(pt.frequency_hz, shift);

                if (!isDrawing) {
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    isDrawing = true;
                } else {
                    ctx.lineTo(x, y);
                }

                // Draw a small "blob" for the point
                ctx.fillStyle = resolveToken('--color-accent-peach', '#ffb86c');
                ctx.fillRect(x - 1, y - 2, 3, 4);
            } else {
                if (isDrawing) {
                    ctx.stroke();
                    isDrawing = false;
                }
            }
        }

        if (isDrawing) {
            ctx.stroke();
        }
    };

    useEffect(() => {
        draw();
    }, [contour, zoom, shifts]);

    useEffect(() => {
        const observer = new ResizeObserver(() => draw());
        if (containerRef.current) {
            observer.observe(containerRef.current);
        }
        return () => observer.disconnect();
    }, [draw]);

    const handleAnalyze = () => {
        analyzePitchForClip(clipId).catch(console.error);
    };

    const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!contour) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;

        const totalTimeMs = contour.points[contour.points.length - 1]?.time_ms || 0;
        const clickedTimeMs = (x / rect.width) * totalTimeMs;

        const segIdx = shifts.findIndex(
            (state) => clickedTimeMs >= state.start_time_ms && clickedTimeMs < state.end_time_ms
        );
        if (segIdx !== -1) {
            const shiftVal = shifts[segIdx]?.shift_semitones ?? 0;
            dragRef.current = {
                startY: event.clientY,
                initialShift: shiftVal,
                segmentIndex: segIdx,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
        }
    };

    const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!dragRef.current) {
            return;
        }

        // 10 pixels roughly equals 1 semitone
        const dy = dragRef.current.startY - event.clientY;
        const dSemitones = Math.round(dy / 10);

        setShifts((prev) => {
            const next = [...prev];
            const currentDrag = dragRef.current;
            if (currentDrag && next[currentDrag.segmentIndex]) {
                next[currentDrag.segmentIndex]!.shift_semitones = currentDrag.initialShift + dSemitones;
            }
            return next;
        });
    };

    const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
        if (dragRef.current) {
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleCommit = () => {
        if (!contour || shifts.length === 0) {
            return;
        }
        void commitPitchEditCommand(clipId, shifts, contour);
    };

    return (
        <div className="absolute inset-0 pointer-events-none flex flex-col z-10">
            {!contour && !kneadState.isAnalyzing && (
                <div className="absolute top-2 right-2 pointer-events-auto flex gap-2">
                    <Button
                        size="xs"
                        variant="secondary"
                        onClick={handleAnalyze}
                        className="text-[10px] h-6 bg-[var(--color-bg-base)] border-border/50 text-[var(--color-accent-peach)]"
                    >
                        Analyze Pitch
                    </Button>
                </div>
            )}

            {contour && (
                <div className="absolute top-2 right-2 pointer-events-auto flex gap-2">
                    <Button
                        size="xs"
                        variant="secondary"
                        onClick={handleCommit}
                        className="text-[10px] h-6 bg-[var(--color-bg-base)] border-border/50 text-white"
                    >
                        Bounce & Commit
                    </Button>
                </div>
            )}

            {kneadState.isAnalyzing && (
                <div className="absolute top-2 right-2 flex items-center gap-2 bg-[var(--color-bg-base)] border border-border/50 rounded px-2 py-1 pointer-events-auto">
                    <div className="w-16 h-1.5 bg-black rounded overflow-hidden">
                        <div
                            className="h-full bg-[var(--color-accent-peach)] transition-all duration-100"
                            style={{ width: `${Math.max(5, kneadState.analysisProgress * 100)}%` }}
                        />
                    </div>
                    <span className="text-[9px] font-mono text-[var(--color-accent-peach)]">
                        {Math.round(kneadState.analysisProgress * 100)}%
                    </span>
                </div>
            )}

            <div ref={containerRef} className="flex-1 w-full h-full relative">
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-auto cursor-ns-resize"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                />
            </div>
        </div>
    );
};
