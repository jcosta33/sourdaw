import { useRef, useCallback, useEffect, type MouseEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { animationScheduler } from '#/helpers/DOM/AnimationScheduler';
import { seekPlayhead } from '#/modules/Transport/useCases/transportControls';
import { setLoopRegion } from '#/modules/Transport/useCases/transportControls';
import { disableLooping } from '#/modules/Transport/useCases/setLooping';

const HEIGHT = 18;

export const BeatRulerBar = (): React.ReactElement => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const loopDragRef = useRef<{ startBeat: number } | null>(null);

    const viewState = useSyncExternalStore(
        (cb) => timelineViewStore.subscribe(cb),
        () => timelineViewStore.value
    );
    const transport = useSyncExternalStore(
        (cb) => transportStore.subscribe(cb),
        () => transportStore.value
    );

    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;
    const loopStart = transport?.loopStart ?? 0;
    const loopEnd = transport?.loopEnd ?? 0;
    const isLooping = transport?.isLooping ?? false;
    const isPlaying = transport?.isPlaying ?? false;
    const timeSigNum = transport?.timeSignatureNumerator ?? 4;

    // Draw the ruler via canvas
    const drawRuler = useCallback(
        (canvas: HTMLCanvasElement, playhead: number = playheadPositionRef.current) => {
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.offsetWidth;
            const h = HEIGHT;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.scale(dpr, dpr);

            // Background
            ctx.fillStyle = 'hsl(220 14% 9%)';
            ctx.fillRect(0, 0, w, h);

            // Loop region
            if (isLooping && loopEnd > loopStart) {
                const lx = loopStart * pixelsPerBeat - scrollX;
                const lw = (loopEnd - loopStart) * pixelsPerBeat;
                ctx.fillStyle = 'rgba(80, 88, 136, 0.25)';
                ctx.fillRect(lx, 0, lw, h);
                // Loop region handles
                ctx.fillStyle = 'rgba(80, 88, 136, 0.75)';
                ctx.fillRect(lx, 0, 2, h);
                ctx.fillRect(lx + lw - 2, 0, 2, h);
            }

            // Bar numbers & beat ticks
            const viewportStartBeat = scrollX / pixelsPerBeat;
            const beatsVisible = w / pixelsPerBeat;
            const beatsPerBar = timeSigNum;

            // Determine label interval based on zoom
            const barPixels = beatsPerBar * pixelsPerBeat;
            const labelEvery = barPixels < 40 ? Math.ceil(40 / barPixels) : 1;

            ctx.font = '9px system-ui, sans-serif';

            const firstBar = Math.floor(viewportStartBeat / beatsPerBar);
            const lastBar = Math.ceil((viewportStartBeat + beatsVisible) / beatsPerBar) + 1;

            for (let bar = firstBar; bar < lastBar; bar++) {
                const barBeat = bar * beatsPerBar;
                const barX = (barBeat - viewportStartBeat) * pixelsPerBeat;

                // Alternating bar background — Logic Pro-style visual grouping
                if (bar % 2 === 1) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
                    ctx.fillRect(barX, 0, barPixels, h);
                }

                // 4-bar group emphasis: brighter line at every 4th bar
                const is4BarBoundary = bar % 4 === 0;
                const is8BarBoundary = bar % 8 === 0;

                if (is8BarBoundary) {
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)';
                    ctx.lineWidth = 1.5;
                } else if (is4BarBoundary) {
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
                    ctx.lineWidth = 1;
                } else {
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
                    ctx.lineWidth = 1;
                }
                ctx.beginPath();
                ctx.moveTo(barX, 0);
                ctx.lineTo(barX, h);
                ctx.stroke();

                // Bar number label — brighter at 4-bar boundaries
                if (bar % labelEvery === 0 && bar >= 0) {
                    ctx.fillStyle = is4BarBoundary
                        ? 'rgba(255, 255, 255, 0.55)'
                        : 'rgba(255, 255, 255, 0.35)';
                    ctx.fillText(String(bar + 1), barX + 3, 11);
                }

                // Beat subdivisions — graduated tick heights
                if (barPixels > 25) {
                    for (let beat = 1; beat < beatsPerBar; beat++) {
                        const beatX = barX + beat * pixelsPerBeat;
                        // Beat 2 (halfway through bar) gets a taller tick
                        const isHalf = beat === Math.floor(beatsPerBar / 2);
                        const tickH = isHalf ? 6 : 4;
                        ctx.strokeStyle = isHalf
                            ? 'rgba(255, 255, 255, 0.10)'
                            : 'rgba(255, 255, 255, 0.06)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(beatX, h - tickH);
                        ctx.lineTo(beatX, h);
                        ctx.stroke();
                    }
                }
            }

            // Playhead marker
            const phX = (playhead - viewportStartBeat) * pixelsPerBeat;
            if (phX >= 0 && phX <= w) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.beginPath();
                ctx.moveTo(phX - 4, 0);
                ctx.lineTo(phX + 4, 0);
                ctx.lineTo(phX, 7);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(phX, 7);
                ctx.lineTo(phX, h);
                ctx.stroke();
            }

            // Bottom border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, h - 0.5);
            ctx.lineTo(w, h - 0.5);
            ctx.stroke();

            // Hint text on first load (only if no loop region)
            if (!isLooping && w > 200) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.font = '8px system-ui, sans-serif';
                ctx.fillText('Drag to set loop region · Click to move playhead', w / 2 - 90, h - 4);
            }
        },
        [pixelsPerBeat, scrollX, loopStart, loopEnd, isLooping, timeSigNum]
    );

    // Continuous playhead redraw via rAF — reads from the non-reactive ref
    useEffect(() => {
        if (!isPlaying) {
            return;
        }
        const id = crypto.randomUUID();
        const loop = () => {
            if (canvasRef.current) {
                drawRuler(canvasRef.current, playheadPositionRef.current);
            }
        };
        animationScheduler.register(`beat-ruler-${id}`, loop);
        return () => animationScheduler.unregister(`beat-ruler-${id}`);
    }, [isPlaying, drawRuler]);

    const setCanvas = useCallback(
        (el: HTMLCanvasElement | null) => {
            canvasRef.current = el;
            if (el) {
                drawRuler(el);
            }
        },
        [drawRuler]
    );

    // Redraw on discrete state change (non-playhead)
    if (canvasRef.current) {
        drawRuler(canvasRef.current, playheadPositionRef.current);
    }

    const getBeat = (clientX: number): number => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
            return 0;
        }
        const x = clientX - rect.left;
        return x / pixelsPerBeat + scrollX / pixelsPerBeat;
    };

    const handleMouseDown = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (e.button !== 0) {
                return;
            }
            const beat = getBeat(e.clientX);

            // Set playhead immediately on click
            seekPlayhead(beat);

            // But also prepare for a drag to create a loop region
            loopDragRef.current = { startBeat: beat };
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pixelsPerBeat, scrollX]
    );

    const handleMouseMove = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (!loopDragRef.current) {
                return;
            }
            // Only consider it a drag if mouse is actually down (buttons === 1)
            if (e.buttons !== 1) {
                loopDragRef.current = null;
                return;
            }
            const beat = getBeat(e.clientX);
            const start = loopDragRef.current.startBeat;
            const lo = Math.min(start, beat);
            const hi = Math.max(start, beat);

            // Require at least a 0.25 beat drag to establish a loop region
            if (hi - lo >= 0.25) {
                setLoopRegion(Math.floor(lo), Math.ceil(hi));
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pixelsPerBeat, scrollX]
    );

    const handleMouseUp = useCallback(() => {
        if (loopDragRef.current) {
            loopDragRef.current = null;
        }
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative w-full shrink-0 select-none cursor-col-resize"
            style={{
                height: HEIGHT,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.3)',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={() => {
                disableLooping();
            }}
            title="Drag to set loop region · Shift+drag to extend · Click to move playhead"
        >
            <canvas ref={setCanvas} className="block w-full" style={{ height: HEIGHT, imageRendering: 'pixelated' }} />
        </div>
    );
};
