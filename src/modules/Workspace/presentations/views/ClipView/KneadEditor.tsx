import { type ReactElement, useRef, useEffect, useLayoutEffect, useState, type PointerEvent } from 'react';
import { kneadStore, updateClipKneadState } from '#/modules/Knead';
import { analyzePitchForClip } from '#/modules/AudioEngine/useCases';
import { useStore } from '#/infra/store/useStore';
import { useTracks } from '../../hooks/useTracks';
import { addDevice } from '#/modules/Arrangement/useCases';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';
import { Mic } from 'lucide-react';
import { logger } from '#/infra/logger/appLogger';

export const KneadEditor = ({ trackId, clipId }: { trackId: string; clipId: string }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { tracks } = useTracks();
    const [zoom, setZoom] = useState(1.0);
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef<{ x: number; y: number; blobId: string; startCents: number } | null>(null);

    const track = tracks.find((t) => t.id === trackId);
    const hasKnead = track?.devices.some((d) => d.type.toLowerCase() === 'knead') ?? false;

    const kneadStoreState = useStore(kneadStore, {
        activeClipId: null,
        clips: {},
        isAnalyzing: false,
        analysisProgress: 0,
    });
    const transportState = useStore(transportStore, defaultTransportState);
    const kneadState = kneadStoreState.clips[clipId];

    // Refs for animation loop to avoid dependency-triggered re-runs of the loop itself
    const stateRef = useRef({ kneadState, zoom, transportState, isDragging });
    
    useEffect(() => {
        stateRef.current = { kneadState, zoom, transportState, isDragging };
    }, [kneadState, zoom, transportState, isDragging]);

    // Trigger real DSP pitch-analysis pipeline (WASM pitch detection)
    useEffect(() => {
        if (hasKnead && (!kneadState || kneadState.blobs.length === 0)) {
            analyzePitchForClip(clipId).catch((err) => {
                logger.error(err);
            });
        }
    }, [hasKnead, kneadState, clipId]);

    const pixelsPerSecond = 300 * zoom;
    const rowHeight = 24;

    // Render loop for the Canvas-based Blob Editor
    useEffect(() => {
        if (!hasKnead) {return;}
        const canvas = canvasRef.current;
        if (!canvas) {return;}
        const ctx = canvas.getContext('2d');
        if (!ctx) {return;}

        const style = getComputedStyle(document.documentElement);
        const bgCol = `hsl(${style.getPropertyValue('--color-surface-sunken') || '0, 0%, 8%'})`;
        const accentCol = `hsl(${style.getPropertyValue('--color-accent-orange') || '24, 100%, 50%'})`;

        let animationFrameId: number;

        const render = () => {
            const { kneadState: currentKnead, zoom: currentZoom, transportState: currentTransport } = stateRef.current;
            const currentPPS = 300 * currentZoom;
            
            const width = canvas.width;
            const height = canvas.height;

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

            // Draw Knead Blobs
            if (currentKnead && currentKnead.blobs.length > 0) {
                const avgCents =
                    currentKnead.blobs.reduce((a, b) => a + (b.pitchCenterCents || 6000), 0) / currentKnead.blobs.length;

                for (const blob of currentKnead.blobs) {
                    if (!blob.pitchCenterCents) {continue;}

                    // Map time to X
                    const x = blob.startTime * currentPPS;
                    const w = (blob.endTime - blob.startTime) * currentPPS;

                    // Map cents to Y
                    const y = height / 2 - ((blob.pitchCenterCents - avgCents) / 100) * rowHeight;

                    // Draw outer blob shape
                    ctx.fillStyle = dragStart.current?.blobId === blob.id ? '#ffffff' : accentCol;
                    ctx.globalAlpha = blob.voicedConfidence > 0.5 ? 0.8 : 0.3;
                    ctx.beginPath();
                    ctx.roundRect(x, y - rowHeight / 2 + 2, w, rowHeight - 4, 4);
                    ctx.fill();

                    // Draw internal pitch curve
                    if (blob.pitchCurveCents.length > 0) {
                        ctx.strokeStyle = dragStart.current?.blobId === blob.id ? accentCol : '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.globalAlpha = 1.0;
                        ctx.beginPath();
                        const step = w / blob.pitchCurveCents.length;
                        for (let i = 0; i < blob.pitchCurveCents.length; i++) {
                            const px = x + i * step;
                            const py = y - ((blob.pitchCurveCents[i] || 0) / 100) * rowHeight;
                            if (i === 0) {ctx.moveTo(px, py);}
                            else {ctx.lineTo(px, py);}
                        }
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
        };
    }, [hasKnead]); // Only re-run if hasKnead changes. Internal changes handled by refs.

    useLayoutEffect(() => {
        const resizeCanvas = () => {
            if (canvasRef.current) {
                const parent = canvasRef.current.parentElement;
                if (parent) {
                    canvasRef.current.width = Math.max(800, parent.clientWidth * zoom);
                    canvasRef.current.height = parent.clientHeight;
                }
            }
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, [zoom]);

    const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
        if (!kneadState) {return;}
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const avgCents =
            kneadState.blobs.reduce((a, b) => a + (b.pitchCenterCents || 6000), 0) / kneadState.blobs.length;

        const hit = kneadState.blobs.find((blob) => {
            const bx = blob.startTime * pixelsPerSecond;
            const bw = (blob.endTime - blob.startTime) * pixelsPerSecond;
            const by = canvasRef.current!.height / 2 - ((blob.pitchCenterCents - avgCents) / 100) * rowHeight;
            return x >= bx && x <= bx + bw && y >= by - rowHeight / 2 && y <= by + rowHeight / 2;
        });

        if (hit) {
            dragStart.current = { x, y, blobId: hit.id, startCents: hit.pitchCenterCents };
            setIsDragging(true);
            canvasRef.current!.setPointerCapture(e.pointerId);
        }
    };

    const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
        if (!isDragging || !dragStart.current || !kneadState) {return;}

        const rect = canvasRef.current!.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const dy = y - dragStart.current.y;

        const centsOffset = Math.round((-dy / rowHeight) * 100);
        const snappedOffset = Math.round(centsOffset / 100) * 100;

        if (snappedOffset !== 0) {
            updateClipKneadState(clipId, (state) => ({
                ...state,
                blobs: state.blobs.map((b) =>
                    b.id === dragStart.current!.blobId
                        ? { ...b, pitchCenterCents: dragStart.current!.startCents + snappedOffset }
                        : b
                ),
            }));
        }
    };

    const handlePointerUp = () => {
        dragStart.current = null;
        setIsDragging(false);
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
                                step={1}
                                onValueChange={([val]) =>
                                    updateClipKneadState(clipId, (s) => ({ ...s, retuneSpeedMs: val ?? 25 }))
                                }
                            />
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
                                    updateClipKneadState(clipId, (s) => ({ ...s, humanizePercent: val ?? 40 }))
                                }
                            />
                        </div>
                        <div className="flex items-center gap-2 px-3 border-l border-border">
                            <DawCompactCheckbox
                                checked={kneadState.formantPreserve ?? true}
                                onChange={(e) =>
                                    updateClipKneadState(clipId, (s) => ({ ...s, formantPreserve: e.target.checked }))
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

            {!hasKnead ? (
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
            ) : !kneadState || kneadState.blobs.length === 0 ? (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface-base/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="flex flex-col items-center gap-2 mb-4">
                        <div className="size-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                        <p className="text-xs text-muted-foreground font-medium">Analyzing pitch tracking data...</p>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
