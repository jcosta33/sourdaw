import { useRef, useEffect, type MouseEvent } from 'react';

import { useStore } from '#/infra/store/useStore';
import { transportStore, playheadPositionRef } from '#/modules/Transport/stores';
import { defaultTransportState, seekPlayhead, setLoopRegion, disableLooping } from '#/modules/Transport/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { timelineViewStore, type TimelineViewState } from '../../stores/timelineViewStore';
import { registerTimelineGestureCanceler } from '../../useCases/timelineInteractions/registerTimelineGestureCanceler';

import { TimelineChromeSurface } from './TimelineChromeSurface';

export const BEAT_RULER_HEIGHT = 18;

export const BeatRulerBar = (): React.ReactElement => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const loopDragRef = useRef<{ startBeat: number } | null>(null);
    /** Ephemeral loop preview during shift+drag — avoids flooding transportStore with 60Hz writes. */
    const loopPreviewRef = useRef<{ start: number; end: number } | null>(null);
    /** Active scrub drag (R-B6): normal drag scrubs the playhead without setting a loop. */
    const scrubDragRef = useRef<boolean>(false);
    /**
     * §182.1 — per-canvas cache of last-seen dimensions + the background
     * gradient for that height, so the rAF draw loop doesn't
     * re-instantiate the same LinearGradient every frame and doesn't
     * reset the canvas backing store + DPR scale when nothing changed.
     */
    const canvasCacheRef = useRef<{
        cssWidth: number;
        cssHeight: number;
        dpr: number;
        bgGradient: CanvasGradient;
    } | null>(null);

    const defaultTimelineView: TimelineViewState = {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    };
    const defaultTransport = defaultTransportState;
    const viewState = useStore(timelineViewStore, defaultTimelineView);
    const transport = useStore(transportStore, defaultTransport);

    const pixelsPerBeat = viewState.pixelsPerBeat;
    const scrollX = viewState.scrollX;
    const loopStart = transport.loopStart;
    const loopEnd = transport.loopEnd;
    const isLooping = transport.isLooping;
    const isPlaying = transport.isPlaying;
    const timeSigNum = transport.timeSignatureNumerator;

    // Draw the ruler via canvas
    const drawRuler = (canvas: HTMLCanvasElement, playhead: number = playheadPositionRef.current) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.offsetWidth;
        const h = BEAT_RULER_HEIGHT;

        // §182.1 — only resize the backing store + recompute the DPR
        // scale + rebuild the background gradient when the dimensions
        // actually change. Per-frame this is a cache hit.
        const cache = canvasCacheRef.current;
        let bgGrad: CanvasGradient;
        if (!cache || cache.cssWidth !== w || cache.cssHeight !== h || cache.dpr !== dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            bgGrad = ctx.createLinearGradient(0, 0, 0, h);
            bgGrad.addColorStop(0, '#151518');
            bgGrad.addColorStop(1, '#111114');
            canvasCacheRef.current = { cssWidth: w, cssHeight: h, dpr, bgGradient: bgGrad };
        } else {
            bgGrad = cache.bgGradient;
        }

        // Background — subtle gradient for depth
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Loop region — during drag, use ephemeral preview ref to avoid flooding transportStore
        const effectiveLoopStart = loopPreviewRef.current?.start ?? loopStart;
        const effectiveLoopEnd = loopPreviewRef.current?.end ?? loopEnd;
        const effectiveIsLooping = isLooping || loopPreviewRef.current !== null;
        if (effectiveIsLooping && effectiveLoopEnd > effectiveLoopStart) {
            const lx = effectiveLoopStart * pixelsPerBeat - scrollX;
            const lw = (effectiveLoopEnd - effectiveLoopStart) * pixelsPerBeat;
            ctx.fillStyle = 'rgba(74, 144, 217, 0.15)';
            ctx.fillRect(lx, 0, lw, h);
            // Loop region handles — accent blue
            ctx.fillStyle = 'rgba(74, 144, 217, 0.65)';
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

        ctx.font = '500 9px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

        const firstBar = Math.floor(viewportStartBeat / beatsPerBar);
        const lastBar = Math.ceil((viewportStartBeat + beatsVisible) / beatsPerBar) + 1;

        for (let bar = firstBar; bar < lastBar; bar++) {
            const barBeat = bar * beatsPerBar;
            const barX = (barBeat - viewportStartBeat) * pixelsPerBeat;

            // Alternating bar background — Logic Pro-style visual grouping
            if (bar % 2 === 1) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
                ctx.fillRect(barX, 0, barPixels, h);
            }

            // 4-bar group emphasis: brighter line at every 4th bar
            const is4BarBoundary = bar % 4 === 0;
            const is8BarBoundary = bar % 8 === 0;

            if (is8BarBoundary) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                ctx.lineWidth = 1;
            } else if (is4BarBoundary) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth = 1;
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
                ctx.lineWidth = 1;
            }
            ctx.beginPath();
            ctx.moveTo(barX, 0);
            ctx.lineTo(barX, h);
            ctx.stroke();

            // Bar number label — brighter at 4-bar boundaries, clearer text
            if (bar % labelEvery === 0 && bar >= 0) {
                ctx.fillStyle = (() => {
                    if (is8BarBoundary) {
                        return 'rgba(224, 224, 224, 0.7)';
                    }
                    if (is4BarBoundary) {
                        return 'rgba(224, 224, 224, 0.55)';
                    }
                    return 'rgba(224, 224, 224, 0.35)';
                })();
                ctx.fillText(String(bar + 1), barX + 3, 11);
            }

            // Beat subdivisions — graduated tick heights
            if (barPixels > 25) {
                for (let beat = 1; beat < beatsPerBar; beat++) {
                    const beatX = barX + beat * pixelsPerBeat;
                    // Beat 2 (halfway through bar) gets a taller tick
                    const isHalf = beat === Math.floor(beatsPerBar / 2);
                    const tickH = isHalf ? 7 : 4;
                    ctx.strokeStyle = isHalf ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.07)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(beatX, h - tickH);
                    ctx.lineTo(beatX, h);
                    ctx.stroke();
                }
            }
        }

        // Playhead marker — clean triangular indicator
        const phX = (playhead - viewportStartBeat) * pixelsPerBeat;
        if (phX >= 0 && phX <= w) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.beginPath();
            ctx.moveTo(phX - 4, 0);
            ctx.lineTo(phX + 4, 0);
            ctx.lineTo(phX, 7);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(phX, 7);
            ctx.lineTo(phX, h);
            ctx.stroke();
        }

        // Bottom border — crisp separator
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h - 0.5);
        ctx.lineTo(w, h - 0.5);
        ctx.stroke();

        // Hint text on first load (only if no loop region)
        if (!effectiveIsLooping && w > 200) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.font = '8px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
            ctx.fillText('Drag to set loop region · Click to move playhead', w / 2 - 90, h - 4);
        }
    };

    // Continuous playhead redraw via rAF — reads from the non-reactive ref
    useEffect(() => {
        if (!isPlaying) {
            return undefined;
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

    const setCanvas = (el: HTMLCanvasElement | null) => {
        canvasRef.current = el;
        if (el) {
            drawRuler(el);
        }
    };

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

    const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        const beat = getBeat(event.clientX);

        // Always seek playhead on click
        seekPlayhead(beat);

        if (event.shiftKey) {
            // Shift+drag: set/extend loop region (R-B5 predecessor behavior)
            loopDragRef.current = { startBeat: beat };
        } else {
            // Normal drag: scrub (R-B6) — playhead follows the cursor
            scrubDragRef.current = true;
        }
    };

    const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
        // Only process if mouse button is held
        if (event.buttons !== 1) {
            loopDragRef.current = null;
            loopPreviewRef.current = null;
            scrubDragRef.current = false;
            return;
        }

        const beat = getBeat(event.clientX);

        if (scrubDragRef.current) {
            // R-B6: scrub — continuously seek the playhead to follow the cursor
            seekPlayhead(Math.max(0, beat));
            return;
        }

        if (!loopDragRef.current) {
            return;
        }

        const start = loopDragRef.current.startBeat;
        const lo = Math.min(start, beat);
        const hi = Math.max(start, beat);

        // Require at least a 0.25 beat drag to establish a loop region.
        // Update only the ephemeral preview ref and redraw directly — avoids
        // flooding transportStore (and all its React subscribers) at 60 Hz.
        if (hi - lo >= 0.25) {
            loopPreviewRef.current = { start: Math.floor(lo), end: Math.ceil(hi) };
            if (canvasRef.current) {
                drawRuler(canvasRef.current, playheadPositionRef.current);
            }
        }
    };

    const handleMouseUp = () => {
        scrubDragRef.current = false;
        if (loopDragRef.current) {
            loopDragRef.current = null;
            // Commit the final loop region to the store exactly once on mouseup.
            if (loopPreviewRef.current) {
                setLoopRegion(loopPreviewRef.current.start, loopPreviewRef.current.end);
                loopPreviewRef.current = null;
            }
        }
    };

    // ── Gesture cancellation (Escape / window blur / visibility change) ──
    // The loop drag only ever previews through loopPreviewRef and commits at
    // mouse-up, so cancelling discards the preview — the store was never
    // written, there is nothing to restore, and no history entry exists.
    const cancelActiveGesture = (): boolean => {
        const hadGesture = loopDragRef.current !== null || loopPreviewRef.current !== null || scrubDragRef.current;
        if (!hadGesture) {
            return false;
        }
        loopDragRef.current = null;
        loopPreviewRef.current = null;
        scrubDragRef.current = false;
        if (canvasRef.current) {
            drawRuler(canvasRef.current, playheadPositionRef.current);
        }
        return true;
    };

    const cancelGestureRef = useRef<() => boolean>(() => false);
    useEffect(() => {
        cancelGestureRef.current = cancelActiveGesture;
    });

    useEffect(() => {
        const cancel = (): boolean => cancelGestureRef.current();
        const unregister = registerTimelineGestureCanceler(cancel);
        const handleBlur = (): void => {
            cancel();
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                cancel();
            }
        };
        window.addEventListener('blur', handleBlur);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            unregister();
            window.removeEventListener('blur', handleBlur);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    return (
        <TimelineChromeSurface
            ref={containerRef}
            className="cursor-col-resize select-none"
            style={{ height: BEAT_RULER_HEIGHT }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={() => {
                disableLooping();
            }}
            title="Click to seek · Drag to scrub · Shift+drag to set loop region · Double-click to disable loop"
            aria-label="Beat ruler"
        >
            <canvas ref={setCanvas} className="block w-full" style={{ height: BEAT_RULER_HEIGHT }} />
        </TimelineChromeSurface>
    );
};
