import { type ReactElement, useRef, useEffect, useLayoutEffect, useState, type PointerEvent } from 'react';

import { Mic } from 'lucide-react';

import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { addDevice } from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { kneadStore } from '#/modules/Knead/stores';
import { analyzeClipPitch, updateClipKneadState } from '#/modules/Knead/useCases';
import { projectStore } from '#/modules/Project/stores';
import { setProjectKeyRoot, setProjectScaleName } from '#/modules/Project/useCases';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';
import { quantizeCentsToScale, SCALE_NAMES, KEY_NAMES } from '#/utils/Music/MusicalScale';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { useTracks } from '../../hooks/useTracks';

type KneadHotspot = 'BODY' | 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT' | 'CENTER_UPPER' | 'CENTER_LOWER';

export const KneadEditor = ({ trackId, clipId }: { trackId: string; clipId: string }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { tracks } = useTracks();
    const [zoom, setZoom] = useState(1.0);
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredBlobId, setHoveredBlobId] = useState<string | null>(null);

    const dragStart = useRef<{
        x: number;
        y: number;
        blobId: string;
        hotspot: KneadHotspot;
        startCents: number;
        startTime: number;
        endTime: number;
    } | null>(null);

    const track = tracks.find((time) => time.id === trackId);
    const hasKnead = track?.devices.some((data) => data.type.toLowerCase() === 'knead') ?? false;

    const kneadStoreState = useStore(kneadStore, {
        activeClipId: null,
        clips: {},
        contours: {},
        isAnalyzing: false,
        analysisProgress: 0,
    });
    const transportState = useStore(transportStore, defaultTransportState);
    const { keyRoot, scaleName } = useStore(projectStore);
    const kneadState = kneadStoreState.clips[clipId];
    const contour = kneadStoreState.contours[clipId];

    const handleCorrectPitch = () => {
        if (!clipId) {
            return;
        }
        updateClipKneadState(clipId, (state) => ({
            ...state,
            blobs: state.blobs.map((blob) => ({
                ...blob,
                pitchCenterCents: quantizeCentsToScale(blob.pitchCenterCents, keyRoot, scaleName),
            })),
        }));
        notifyUser('Pitch corrected to scale.', 'success');
    };

    // Knead is a non-destructive edit until it is baked. `commitPitchEdit` renders
    // the blob pitch offsets into a new audio file and repoints the clip at it,
    // which is the only path in the product that makes a pitch edit permanent —
    // so the control for it belongs to the pitch mode that owns the edit, the way
    // Flex Pitch, VariAudio and Live all keep pitch editing an exclusive mode.
    //
    // Gated on the contour rather than on the blobs: the commit clears the stored
    // contour, and only a fresh analysis restores it — and that analysis rebuilds
    // every blob with `originalPitchCenterCents` rebased onto the rendered audio.
    // So the gate is what stops a second commit from baking the same shift twice.
    const canCommitPitchEdit = (contour?.points.length ?? 0) > 0 && (kneadState?.blobs.length ?? 0) > 0;

    const handleCommitPitchEdit = () => {
        if (!contour || !kneadState || !canCommitPitchEdit) {
            return;
        }
        // Each blob carries the pitch the analysis found and the pitch the user
        // dragged it to; their difference is the shift to render over that span.
        const segments = kneadState.blobs.map((blob) => ({
            start_time_ms: blob.startTime * 1000,
            end_time_ms: blob.endTime * 1000,
            shift_semitones: (blob.pitchCenterCents - blob.originalPitchCenterCents) / 100,
        }));
        // Dispatch through the action layer so the commit gets a real undo entry
        // (`handleCommitPitchEdit` describes `restoreClipFileId` as its inverse).
        // The handler notifies the user on render failure and rethrows, so swallow
        // the rejection here rather than leaving it unhandled.
        void executeAppAction({ type: 'commitPitchEdit', payload: { clipId, segments, contour } }).catch(() => {});
    };

    const handleKeyChange = (root: number) => {
        setProjectKeyRoot(root);
    };

    const handleScaleChange = (name: string) => {
        setProjectScaleName(name);
    };

    // Refs for the animation loop, to avoid dependency-triggered re-runs of the
    // loop itself. Only values the draw actually reads belong here: the loop's
    // dirty check derives its repaint decision from exactly this set, so a field
    // nobody draws with would be a misleading repaint trigger. (`isDragging` is
    // deliberately absent — the draw reads `dragStart.current`, not the flag.)
    const stateRef = useRef({ kneadState, zoom, transportState, contour, hoveredBlobId });

    useEffect(() => {
        stateRef.current = { kneadState, zoom, transportState, contour, hoveredBlobId };
    }, [kneadState, zoom, transportState, contour, hoveredBlobId]);

    // Trigger real DSP pitch-analysis pipeline (WASM pitch detection).
    // Gate on the absence of a contour, not on `blobs.length === 0`: a clip that
    // analyses successfully but yields no qualifying voiced run (percussion,
    // near-silence, a very short clip) legitimately produces zero blobs. Once a
    // contour exists, analysis has run; re-triggering on empty blobs would loop
    // forever because `kneadState` is in this effect's deps.
    useEffect(() => {
        const needsAnalysis = (!kneadState || kneadState.blobs.length === 0) && !contour;
        if (hasKnead && needsAnalysis) {
            analyzeClipPitch(clipId)
                .then((outcome) => {
                    // Surface the "buffer unresolved" path so users get feedback
                    // instead of staring at an empty editor that looks like a stub.
                    if (outcome.status === 'no-buffer') {
                        notifyUser(
                            'Pitch analysis skipped: this clip has no audio buffer. Record or import audio into the track first.',
                            'info'
                        );
                    }
                    return null;
                })
                .catch((error: unknown) => {
                    logger.error(error instanceof Error ? error : new Error(String(error)));
                    notifyUser('Pitch analysis failed. See logs for details.', 'error');
                    return null;
                });
        }
    }, [hasKnead, kneadState, contour, clipId]);

    const pixelsPerSecond = 300 * zoom;
    const rowHeight = 24;

    const getHotspot = (x: number, y: number, bx: number, by: number, bw: number, bh: number): KneadHotspot => {
        const padding = 8;
        if (x < bx + padding) {
            return 'LEFT';
        }
        if (x > bx + bw - padding) {
            return 'RIGHT';
        }
        if (y < by - bh / 2 + padding) {
            return 'TOP';
        }
        if (y > by + bh / 2 - padding) {
            return 'BOTTOM';
        }
        if (y < by) {
            return 'CENTER_UPPER';
        }
        return 'CENTER_LOWER';
    };

    // Render loop for the Canvas-based Blob Editor
    useEffect(() => {
        if (!hasKnead) {
            return undefined;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        const style = getComputedStyle(document.documentElement);
        const bgCol = `hsl(${style.getPropertyValue('--color-surface-sunken') || '0, 0%, 8%'})`;
        const accentCol = `hsl(${style.getPropertyValue('--color-accent-orange') || '24, 100%, 50%'})`;

        let animationFrameId: number;

        // Dirty check (audit M-246). This loop used to repaint the background,
        // every grid lane, the whole pitch contour and every blob on every
        // animation frame, unconditionally — including while the editor sat
        // idle with the transport stopped, where each of those ~60 repaints a
        // second produced a pixel-identical canvas.
        //
        // The draw below is a pure function of the inputs listed here, so when
        // none of them changed since the last painted frame there is nothing
        // new to show and the frame is skipped. Anything the draw starts
        // reading must be added to this signature, or it will not reach the
        // screen. Two deliberate exclusions, both stale by the same amount as
        // before this change:
        //  - `bgCol` / `accentCol` are resolved once per effect run, and this
        //    effect only re-runs when `hasKnead` flips, so a live theme swap
        //    already failed to reach the canvas (pre-existing).
        //  - `playheadPositionRef`, Transport's ~100 Hz playhead channel, is
        //    NOT read here. The playhead below is drawn from the transport
        //    *store* field, which Transport writes only on discrete events
        //    (stop, seek, loop wrap). Wiring the live ref in means adding it
        //    to this signature, or the playhead will freeze mid-transport.
        type PaintedSignature = {
            kneadState: (typeof stateRef.current)['kneadState'];
            contour: (typeof stateRef.current)['contour'];
            zoom: number;
            draggedBlobId: string | null;
            hoveredBlobId: string | null;
            width: number;
            height: number;
            isPlaying: boolean;
            playheadPosition: number;
            tempo: number;
        };
        let lastPainted: PaintedSignature | null = null;

        // A 2D context can lose its backing store (GPU reset, memory pressure).
        // The UA restores it with a cleared bitmap and fires `contextrestored`,
        // leaving the redraw to the page. None of the signature legs move when
        // that happens, so the dirty check would sit on a still-matching memo
        // and leave the editor blank until some unrelated input changed.
        // Dropping the memo makes the next frame a full repaint.
        //
        // The unconditional loop this replaced self-healed within one frame, so
        // unlike the resize case this is an exposure the dirty check introduces
        // and therefore has to answer for.
        const handleContextRestored = () => {
            lastPainted = null;
        };
        canvas.addEventListener('contextrestored', handleContextRestored);

        const render = () => {
            const {
                kneadState: currentKnead,
                zoom: currentZoom,
                transportState: currentTransport,
                contour: currentContour,
                hoveredBlobId: currentHovered,
            } = stateRef.current;
            const currentPPS = 300 * currentZoom;

            const width = canvas.width;
            const height = canvas.height;
            // Read live from the ref rather than from the `isDragging` flag:
            // this is the value the blob draw actually branches on, and it is
            // set synchronously on pointer-down, one React commit earlier than
            // the flag would reach `stateRef`.
            const draggedBlobId = dragStart.current?.blobId ?? null;

            const unchangedSinceLastPaint =
                lastPainted !== null &&
                lastPainted.kneadState === currentKnead &&
                lastPainted.contour === currentContour &&
                lastPainted.zoom === currentZoom &&
                lastPainted.draggedBlobId === draggedBlobId &&
                lastPainted.hoveredBlobId === currentHovered &&
                lastPainted.width === width &&
                lastPainted.height === height &&
                lastPainted.isPlaying === currentTransport.isPlaying &&
                lastPainted.playheadPosition === currentTransport.playheadPosition &&
                lastPainted.tempo === currentTransport.tempo;
            if (unchangedSinceLastPaint) {
                animationFrameId = requestAnimationFrame(render);
                return;
            }
            lastPainted = {
                kneadState: currentKnead,
                contour: currentContour,
                zoom: currentZoom,
                draggedBlobId,
                hoveredBlobId: currentHovered,
                width,
                height,
                isPlaying: currentTransport.isPlaying,
                playheadPosition: currentTransport.playheadPosition,
                tempo: currentTransport.tempo,
            };

            // Clear background
            ctx.fillStyle = bgCol;
            ctx.fillRect(0, 0, width, height);

            // Draw Piano Roll horizontal grid lanes
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            for (let y = 0; y < height; y += rowHeight) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // Draw Raw Pitch Contour (faint background)
            if (currentContour && currentContour.points.length > 0) {
                const avgCents =
                    (currentKnead?.blobs?.reduce((alpha, b) => alpha + (b.pitchCenterCents || 6000), 0) ?? 6000) /
                        (currentKnead?.blobs?.length || 1) || 6000;

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                let first = true;
                for (const pt of currentContour.points) {
                    if (!pt.voiced || pt.confidence < 0.3) {
                        first = true;
                        continue;
                    }
                    const px = (pt.time_ms / 1000) * currentPPS;
                    const midiNote = 69 + 12 * Math.log2(pt.frequency_hz / 440);
                    const cents = midiNote * 100;
                    const py = height / 2 - ((cents - avgCents) / 100) * rowHeight;

                    if (first) {
                        ctx.moveTo(px, py);
                        first = false;
                    } else {
                        ctx.lineTo(px, py);
                    }
                }
                ctx.stroke();
            }

            // Draw Knead Blobs
            if (currentKnead && currentKnead.blobs.length > 0) {
                const avgCents =
                    currentKnead.blobs.reduce((alpha, b) => alpha + (b.pitchCenterCents || 6000), 0) /
                    currentKnead.blobs.length;

                for (const blob of currentKnead.blobs) {
                    if (!blob.pitchCenterCents) {
                        continue;
                    }

                    // Map time to X
                    const x = blob.startTime * currentPPS;
                    const w = (blob.endTime - blob.startTime) * currentPPS;

                    // Map cents to Y
                    const y = height / 2 - ((blob.pitchCenterCents - avgCents) / 100) * rowHeight;
                    // Read hover through stateRef: this closure only re-runs when
                    // `hasKnead` flips, so reading the `hoveredBlobId` state
                    // variable directly froze it at its mount value (always
                    // null) and the hover highlight and edit handles never
                    // appeared at all.
                    const isHovered = currentHovered === blob.id;
                    const isDragged = draggedBlobId === blob.id;

                    // Draw outer blob shape
                    ctx.fillStyle = isDragged || isHovered ? '#ffffff' : accentCol;
                    ctx.globalAlpha = blob.voicedConfidence > 0.5 ? 0.8 : 0.3;
                    ctx.beginPath();
                    ctx.roundRect(x, y - rowHeight / 2 + 2, w, rowHeight - 4, 6);
                    ctx.fill();

                    // Draw internal pitch curve
                    if (blob.pitchCurveCents.length > 0) {
                        ctx.strokeStyle = isDragged || isHovered ? accentCol : '#ffffff';
                        ctx.lineWidth = 1.5;
                        ctx.globalAlpha = 1.0;
                        ctx.beginPath();
                        const step = w / blob.pitchCurveCents.length;
                        for (let index = 0; index < blob.pitchCurveCents.length; index++) {
                            const px = x + index * step;
                            const py = y - ((blob.pitchCurveCents[index] || 0) / 100) * rowHeight;
                            if (index === 0) {
                                ctx.moveTo(px, py);
                            } else {
                                ctx.lineTo(px, py);
                            }
                        }
                        ctx.stroke();
                    }

                    // Draw Handles if hovered or dragged
                    if (isHovered || isDragged) {
                        ctx.globalAlpha = 1.0;
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1;

                        // Top/Bottom pitch drift handles
                        ctx.beginPath();
                        ctx.arc(x + w / 2, y - rowHeight / 2 + 2, 3, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.arc(x + w / 2, y + rowHeight / 2 - 2, 3, 0, Math.PI * 2);
                        ctx.stroke();

                        // Left/Right timing handles
                        ctx.beginPath();
                        ctx.moveTo(x + 2, y - 4);
                        ctx.lineTo(x + 2, y + 4);
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.moveTo(x + w - 2, y - 4);
                        ctx.lineTo(x + w - 2, y + 4);
                        ctx.stroke();
                    }
                }
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = '12px var(--font-sans)';
                ctx.textAlign = 'center';
                ctx.fillText('No pitch data analyzed.', width / 2, height / 2);
            }

            // Draw Playhead
            if (currentTransport.isPlaying || currentTransport.playheadPosition > 0) {
                const playheadSec = (currentTransport.playheadPosition * 60) / currentTransport.tempo;
                const px = playheadSec * currentPPS;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(px, 0);
                ctx.lineTo(px, height);
                ctx.stroke();
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
            canvas.removeEventListener('contextrestored', handleContextRestored);
        };
    }, [hasKnead]); // Only re-run if hasKnead changes. Internal changes handled by refs.

    useLayoutEffect(() => {
        const resizeCanvas = () => {
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }
            const parent = canvas.parentElement;
            if (!parent) {
                return;
            }
            // Floor the width before comparing: the zoom multiply makes it
            // fractional (the slider steps in 0.1), `canvas.width` is an unsigned
            // long that truncates on assignment, and an un-floored comparison
            // would therefore never settle — every resize event would re-assign
            // and reset the bitmap. `clientHeight` is already integral per CSSOM
            // View, so the height needs no such treatment.
            const nextWidth = Math.floor(Math.max(800, parent.clientWidth * zoom));
            const nextHeight = parent.clientHeight;

            // Assign only on a real change. The HTML spec resets the canvas
            // bitmap whenever width/height are "set, removed, changed, or
            // redundantly set to the value they already have" — so assigning
            // unconditionally on every `resize` event would blank the canvas
            // without moving anything the render loop's dirty check compares,
            // and the editor would stay blank until some unrelated input
            // happened to change. A `resize` that leaves the clamped width and
            // the height alone must leave the bitmap alone too.
            if (canvas.width !== nextWidth) {
                canvas.width = nextWidth;
            }
            if (canvas.height !== nextHeight) {
                canvas.height = nextHeight;
            }
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, [zoom]);

    const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!kneadState) {
            return;
        }
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const avgCents =
            kneadState.blobs.reduce((alpha, b) => alpha + (b.pitchCenterCents || 6000), 0) /
            (kneadState.blobs.length || 1);

        const hit = kneadState.blobs.find((blob) => {
            const bx = blob.startTime * pixelsPerSecond;
            const bw = (blob.endTime - blob.startTime) * pixelsPerSecond;
            const by = canvasRef.current!.height / 2 - ((blob.pitchCenterCents - avgCents) / 100) * rowHeight;
            return x >= bx && x <= bx + bw && y >= by - rowHeight / 2 && y <= by + rowHeight / 2;
        });

        if (hit) {
            const bx = hit.startTime * pixelsPerSecond;
            const bw = (hit.endTime - hit.startTime) * pixelsPerSecond;
            const by = canvasRef.current!.height / 2 - ((hit.pitchCenterCents - avgCents) / 100) * rowHeight;
            const hotspot = getHotspot(x, y, bx, by, bw, rowHeight);

            dragStart.current = {
                x,
                y,
                blobId: hit.id,
                hotspot,
                startCents: hit.pitchCenterCents,
                startTime: hit.startTime,
                endTime: hit.endTime,
            };
            setIsDragging(true);
            canvasRef.current!.setPointerCapture(event.pointerId);
        }
    };

    const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (!isDragging) {
            // Hover detection
            const avgCents =
                (kneadState?.blobs?.reduce((alpha, b) => alpha + (b.pitchCenterCents || 6000), 0) ?? 6000) /
                (kneadState?.blobs?.length || 1);

            const hit = kneadState?.blobs.find((blob) => {
                const bx = blob.startTime * pixelsPerSecond;
                const bw = (blob.endTime - blob.startTime) * pixelsPerSecond;
                const by = canvasRef.current!.height / 2 - ((blob.pitchCenterCents - avgCents) / 100) * rowHeight;
                return x >= bx && x <= bx + bw && y >= by - rowHeight / 2 && y <= by + rowHeight / 2;
            });

            if (hit) {
                setHoveredBlobId(hit.id);
                const bx = hit.startTime * pixelsPerSecond;
                const bw = (hit.endTime - hit.startTime) * pixelsPerSecond;
                const by = canvasRef.current!.height / 2 - ((hit.pitchCenterCents - avgCents) / 100) * rowHeight;
                const hotspot = getHotspot(x, y, bx, by, bw, rowHeight);

                // Cursor feedback
                if (hotspot === 'LEFT' || hotspot === 'RIGHT') {
                    canvasRef.current!.style.cursor = 'ew-resize';
                } else if (hotspot === 'TOP' || hotspot === 'BOTTOM') {
                    canvasRef.current!.style.cursor = 'ns-resize';
                } else if (hotspot === 'CENTER_UPPER') {
                    canvasRef.current!.style.cursor = 'pointer';
                } else {
                    canvasRef.current!.style.cursor = 'move';
                }
            } else {
                setHoveredBlobId(null);
                canvasRef.current!.style.cursor = 'crosshair';
            }
            return;
        }

        if (!dragStart.current || !kneadState) {
            return;
        }

        const dx = x - dragStart.current.x;
        const dy = y - dragStart.current.y;
        const hotspot = dragStart.current.hotspot;

        if (hotspot === 'CENTER_UPPER' || hotspot === 'CENTER_LOWER') {
            const centsOffset = Math.round((-dy / rowHeight) * 100);
            // Upper center is quantized to semitones, lower center is free drag
            const finalOffset = hotspot === 'CENTER_UPPER' ? Math.round(centsOffset / 100) * 100 : centsOffset;

            if (finalOffset !== 0) {
                updateClipKneadState(clipId, (state) => ({
                    ...state,
                    blobs: state.blobs.map((b) =>
                        b.id === dragStart.current!.blobId
                            ? { ...b, pitchCenterCents: dragStart.current!.startCents + finalOffset }
                            : b
                    ),
                }));
            }
        } else if (hotspot === 'LEFT') {
            const timeOffset = dx / pixelsPerSecond;
            updateClipKneadState(clipId, (state) => ({
                ...state,
                blobs: state.blobs.map((b) =>
                    b.id === dragStart.current!.blobId
                        ? { ...b, startTime: Math.min(b.endTime - 0.05, dragStart.current!.startTime + timeOffset) }
                        : b
                ),
            }));
        } else if (hotspot === 'RIGHT') {
            const timeOffset = dx / pixelsPerSecond;
            updateClipKneadState(clipId, (state) => ({
                ...state,
                blobs: state.blobs.map((b) =>
                    b.id === dragStart.current!.blobId
                        ? { ...b, endTime: Math.max(b.startTime + 0.05, dragStart.current!.endTime + timeOffset) }
                        : b
                ),
            }));
        }
    };

    const handlePointerUp = () => {
        dragStart.current = null;
        setIsDragging(false);
    };
    const renderIife_10 = () => {
        if (!hasKnead) {
            return (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface-base/80 backdrop-blur-sm">
                    <Mic className="size-8 text-muted-foreground/50 mb-3" />
                    <p className="text-sm font-medium mb-1">Pitch Correction Disabled</p>
                    <p className="text-xs text-muted-foreground mb-4 max-w-xs text-center">
                        Enable Knead on this track to analyze and edit the pitch of this audio clip in real-time.
                    </p>
                    <Button onClick={() => addDevice(trackId, 'Knead')} variant="default" size="sm">
                        Enable Pitch Editor
                    </Button>
                </div>
            );
        }
        if (!kneadState || kneadState.blobs.length === 0) {
            // A contour means analysis already ran. If it produced no blobs the
            // clip simply has no qualifying voiced pitch — show a terminal
            // message, not the perpetual "analysing" spinner (which would imply
            // a run that never ends; the analysis effect no longer re-fires once
            // a contour exists).
            if (contour) {
                return (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface-base/80 backdrop-blur-sm animate-in fade-in duration-300">
                        <p className="text-xs text-muted-foreground font-medium">No pitch detected in this clip.</p>
                    </div>
                );
            }
            return (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface-base/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="flex flex-col items-center gap-2 mb-4">
                        <div className="size-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                        <p className="text-xs text-muted-foreground font-medium">Analyzing pitch tracking data...</p>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex flex-col flex-1 w-full relative bg-surface-sunken overflow-hidden" ref={containerRef}>
            <div className="absolute top-0 left-0 right-0 h-10 bg-surface-base/90 backdrop-blur-md border-b flex items-center px-4 gap-6 z-20 shadow-sm">
                {hasKnead && kneadState && kneadState.blobs.length > 0 ? (
                    <>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground w-12 text-right">
                                Retune
                            </span>
                            <Slider
                                className="w-24"
                                value={[kneadState.retuneSpeedMs ?? 25]}
                                min={0}
                                max={200}
                                onValueChange={([val]) =>
                                    updateClipKneadState(clipId, (state) => ({ ...state, retuneSpeedMs: val ?? 25 }))
                                }
                            />
                        </div>

                        <div className="h-4 w-[1px] bg-border mx-1" />

                        <div className="flex items-center gap-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Scale
                            </p>
                            <div className="flex items-center gap-1">
                                <select
                                    className="bg-transparent text-[11px] font-medium outline-none cursor-pointer hover:text-accent-primary transition-colors"
                                    value={keyRoot}
                                    onChange={(event) => handleKeyChange(parseInt(event.target.value))}
                                >
                                    {KEY_NAMES.map((name, index) => (
                                        <option
                                            key={name}
                                            value={index}
                                            className="bg-surface-elevated text-foreground"
                                        >
                                            {name}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className="bg-transparent text-[11px] font-medium outline-none cursor-pointer hover:text-accent-primary transition-colors capitalize"
                                    value={scaleName}
                                    onChange={(event) => handleScaleChange(event.target.value)}
                                >
                                    {SCALE_NAMES.map((name) => (
                                        <option key={name} value={name} className="bg-surface-elevated text-foreground">
                                            {name.replaceAll(/([A-Z])/g, ' $1')}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <Button
                                variant="ghost"
                                size="xs"
                                className="h-7 px-2 text-[11px] font-semibold hover:bg-accent-primary/10 hover:text-accent-primary ml-2"
                                onClick={handleCorrectPitch}
                            >
                                Correct All
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground w-12 text-right">
                                Human
                            </span>
                            <Slider
                                className="w-24"
                                value={[kneadState.humanizePercent ?? 40]}
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={([val]) =>
                                    updateClipKneadState(clipId, (state) => ({ ...state, humanizePercent: val ?? 40 }))
                                }
                            />
                        </div>
                        <div className="flex items-center gap-2 px-3 border-l border-border">
                            <DawCompactCheckbox
                                checked={kneadState.formantPreserve ?? true}
                                onChange={(event) =>
                                    updateClipKneadState(clipId, (state) => ({
                                        ...state,
                                        formantPreserve: event.target.checked,
                                    }))
                                }
                                className="cursor-pointer"
                                id="formant-toggle"
                            />
                            <label
                                htmlFor="formant-toggle"
                                className="text-[10px] uppercase font-bold text-muted-foreground cursor-pointer"
                            >
                                Formants
                            </label>
                        </div>
                    </>
                ) : null}
                <div className="flex items-center gap-2 ml-auto">
                    {canCommitPitchEdit ? (
                        <Button
                            variant="secondary"
                            size="xs"
                            className="h-7 px-2 text-[11px] font-semibold"
                            onClick={handleCommitPitchEdit}
                        >
                            Bounce & Commit
                        </Button>
                    ) : null}
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Zoom</span>
                    <Slider
                        className="w-24"
                        value={[zoom * 100]}
                        min={50}
                        max={400}
                        step={10}
                        onValueChange={([val]) => setZoom((val ?? 100) / 100)}
                    />
                </div>
            </div>
            <div className="flex-1 w-full relative overflow-auto pt-10">
                <canvas
                    ref={canvasRef}
                    className="absolute top-0 left-0 cursor-crosshair"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                />
            </div>
            {renderIife_10()}
        </div>
    );
};
