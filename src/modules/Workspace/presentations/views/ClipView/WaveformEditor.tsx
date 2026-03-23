import {
    type ReactElement,
    type MouseEvent,
    type DragEvent,
    type PointerEvent,
    useRef,
    useEffect,
    useState,
} from 'react';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { DisabledFeatureWrapper } from '#/components/ui/disabled-feature-wrapper';
import { cn } from '#/helpers/Styles/cn';
import { resolveToken } from '#/helpers/UI/resolveToken';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { decodeAudioFile } from '../../../useCases/workspaceViewActions';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { normalizeClip, reverseClip } from '../../../useCases/workspaceViewActions';
import { type WarpState } from '../../../useCases/workspaceViewActions';
import {
    getWarpState,
    enableWarp,
    disableWarp,
    setStretchMode,
    addWarpMarker,
    removeWarpMarker,
    moveWarpMarker,
} from '../../../useCases/workspaceViewActions';
import { handleAiDenoiseClip, handleStemSeparationPreview } from '#/modules/AiGeneration/useCases/generativeAiActions';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { audioToMidi } from '#/modules/AudioAnalysis/useCases/audioToMidi';
import { isTauri } from '#/modules/AudioEngine/repositories/nativeAIBridge';

const STRETCH_MODES: WarpState['stretchMode'][] = ['complex', 'repitch', 'texture', 'beats'];

type WaveformMenu = { x: number; y: number } | null;

type WaveformEditorProps = {
    clipId: string;
};

export const WaveformEditor = ({ clipId }: WaveformEditorProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [bufferVersion, setBufferVersion] = useState(0);
    const [warpState, setWarpState] = useState<WarpState>(() => getWarpState(clipId));
    const [waveCtxMenu, setWaveCtxMenu] = useState<WaveformMenu>(null);
    const waveCtxRef = useRef<HTMLDivElement>(null);
    // Warp marker drag state
    const draggingMarker = useRef<{ id: string; startX: number; startBeat: number } | null>(null);
    const didDrag = useRef(false);

    const refreshWarp = () => setWarpState(getWarpState(clipId));

    const handleToggleWarp = () => {
        if (warpState.enabled) {
            disableWarp(clipId);
        } else {
            enableWarp(clipId);
        }
        refreshWarp();
    };

    const handleStretchMode = (mode: WarpState['stretchMode']) => {
        setStretchMode(clipId, mode);
        refreshWarp();
    };

    const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (!file || !file.type.startsWith('audio/')) {
            return;
        }

        try {
            const { id: bufferId } = await decodeAudioFile(file);

            const state = trackStore.value;
            if (!state) {
                return;
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => ({
                    ...t,
                    clips: t.clips.map((c) =>
                        c.id === clipId || c.audioBufferId === clipId ? { ...c, audioBufferId: bufferId } : c
                    ),
                })),
            });
            setBufferVersion((v) => v + 1);
        } catch {
            notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
        }
    };

    const beatWidth = Math.max(1, 40 * zoom);

    const draw = () => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
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

        ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
        ctx.fillRect(0, 0, width, height);

        const midY = height / 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(width, midY);
        ctx.stroke();

        const peaks = audioBufferCache.getWaveformPeaks(clipId, Math.floor(width));

        const hasRealData = peaks.some((v) => v > 0);

        if (hasRealData) {
            ctx.fillStyle = 'rgba(90, 150, 115, 0.5)';
            ctx.beginPath();
            ctx.moveTo(0, midY);
            for (let i = 0; i < peaks.length; i++) {
                ctx.lineTo(i, midY - peaks[i]! * midY * 0.9);
            }
            ctx.lineTo(peaks.length - 1, midY);
            for (let i = peaks.length - 1; i >= 0; i--) {
                ctx.lineTo(i, midY + peaks[i]! * midY * 0.9);
            }
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            const numBars = Math.floor(width / 3);
            for (let i = 0; i < numBars; i++) {
                const t = i / numBars;
                const amp = Math.abs(Math.sin(t * Math.PI * 8) * Math.cos(t * Math.PI * 3)) * 0.6 + 0.05;
                const barH = amp * height * 0.4;
                ctx.fillRect(i * 3, midY - barH, 2, barH * 2);
            }
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.font = '11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Audio clip — drop an audio file to load waveform', width / 2, midY - height * 0.35);
        }

        for (let beat = 0; beat < width / beatWidth; beat++) {
            const x = beat * beatWidth;
            ctx.strokeStyle = beat % 4 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        if (warpState.enabled) {
            for (const marker of warpState.markers) {
                const x = marker.warpedBeat * beatWidth;
                if (x < 0 || x > width) {
                    continue;
                }
                ctx.strokeStyle = 'rgba(176, 128, 48, 0.75)';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.lineWidth = 1;

                ctx.fillStyle = 'rgba(176, 128, 48, 0.85)';
                ctx.beginPath();
                ctx.moveTo(x - 5, 0);
                ctx.lineTo(x + 5, 0);
                ctx.lineTo(x, 8);
                ctx.closePath();
                ctx.fill();

                ctx.font = '9px system-ui';
                ctx.fillStyle = 'rgba(176, 128, 48, 0.7)';
                ctx.textAlign = 'center';
                ctx.fillText(marker.originalBeat.toFixed(1), x, height - 4);
            }
        }
    };

    useEffect(() => {
        draw();
    }, [clipId, zoom, bufferVersion, warpState, beatWidth]);

    useEffect(() => {
        const observer = new ResizeObserver(() => draw());
        if (containerRef.current) {
            observer.observe(containerRef.current);
        }
        return () => observer.disconnect();
    }, [draw]);

    const getCanvasX = (e: { clientX: number }): number => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return 0;
        }
        const rect = canvas.getBoundingClientRect();
        return e.clientX - rect.left + (containerRef.current?.scrollLeft ?? 0);
    };

    const hitTestMarker = (x: number) =>
        warpState.markers.find((m) => Math.abs(m.warpedBeat * beatWidth - x) < 8) ?? null;

    const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!warpState.enabled) {
            return;
        }
        const x = getCanvasX(event);
        const hit = hitTestMarker(x);
        if (hit) {
            draggingMarker.current = { id: hit.id, startX: x, startBeat: hit.warpedBeat };
            didDrag.current = false;
            (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
            event.preventDefault();
        }
    };

    const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!draggingMarker.current) {
            return;
        }
        const x = getCanvasX(event);
        const dx = Math.abs(x - draggingMarker.current.startX);
        if (dx > 4) {
            didDrag.current = true;
        }
        if (didDrag.current) {
            const newBeat = Math.max(0, x / beatWidth);
            moveWarpMarker(clipId, draggingMarker.current.id, newBeat);
            refreshWarp();
        }
    };

    const handlePointerUp = () => {
        draggingMarker.current = null;
    };

    const handleDoubleClick = (e: MouseEvent<HTMLCanvasElement>) => {
        if (!warpState.enabled || didDrag.current) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const x = getCanvasX(e);
        const beat = x / beatWidth;
        const hitMarker = hitTestMarker(x);
        if (hitMarker) {
            removeWarpMarker(clipId, hitMarker.id);
        } else {
            addWarpMarker(clipId, beat, beat);
        }
        refreshWarp();
    };

    const handleWaveContextMenu = (e: MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        setWaveCtxMenu({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        if (!waveCtxMenu) {
            return;
        }
        const dismiss = (e: globalThis.MouseEvent) => {
            if (waveCtxRef.current && !waveCtxRef.current.contains(e.target as Node)) {
                setWaveCtxMenu(null);
            }
        };
        const esc = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                setWaveCtxMenu(null);
            }
        };
        document.addEventListener('mousedown', dismiss);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('mousedown', dismiss);
            document.removeEventListener('keydown', esc);
        };
    }, [waveCtxMenu]);

    const waveAct = (fn: () => void) => () => {
        fn();
        setWaveCtxMenu(null);
    };

    const realClipId =
        trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.audioBufferId === clipId || c.id === clipId)
            ?.id ?? clipId;

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-border/30 bg-surface-raised">
                <span className="text-[10px] text-muted-foreground">Zoom:</span>
                <Slider
                    value={[zoom * 100]}
                    onValueChange={([v]) => {
                        if (v !== undefined) {
                            setZoom(v / 100);
                        }
                    }}
                    min={25}
                    max={400}
                    step={25}
                    className="w-20"
                    aria-label="Waveform zoom"
                />

                <div className="w-px h-4 bg-border/40 mx-1" />

                <Button
                    variant={warpState.enabled ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={handleToggleWarp}
                    className={cn('text-[10px] px-2', warpState.enabled && 'text-[var(--color-accent-peach)] border-[var(--color-accent-peach)]/30')}
                    aria-pressed={warpState.enabled}
                    aria-label="Toggle warp mode"
                >
                    Warp
                </Button>

                {warpState.enabled && (
                    <>
                        <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
                            {STRETCH_MODES.map((mode) => (
                                <Button
                                    key={mode}
                                    variant={warpState.stretchMode === mode ? 'secondary' : 'ghost'}
                                    size="icon-xs"
                                    onClick={() => handleStretchMode(mode)}
                                    className="text-[9px] w-auto px-1.5 h-5 capitalize"
                                    aria-pressed={warpState.stretchMode === mode}
                                >
                                    {mode}
                                </Button>
                            ))}
                        </div>

                        <span className="text-[10px] text-[var(--color-accent-peach)]/70">
                            {warpState.markers.length} marker{warpState.markers.length !== 1 ? 's' : ''}
                        </span>
                    </>
                )}
            </div>
            <div
                ref={containerRef}
                className={cn('flex-1 overflow-auto relative', isDragging && 'ring-2 ring-primary ring-inset')}
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
            >
                <canvas
                    ref={canvasRef}
                    className={draggingMarker.current ? 'cursor-ew-resize' : 'cursor-crosshair'}
                    aria-label="Waveform editor"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleWaveContextMenu}
                />
                {isDragging && (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/10 pointer-events-none">
                        <span className="text-sm font-medium text-primary">Drop audio file here</span>
                    </div>
                )}
            </div>

            {waveCtxMenu && (
                <div
                    ref={waveCtxRef}
                    className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-lg"
                    style={{ left: waveCtxMenu.x, top: waveCtxMenu.y }}
                    role="menu"
                >
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                        role="menuitem"
                        onClick={waveAct(() => normalizeClip(realClipId))}
                    >
                        Normalize
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                        role="menuitem"
                        onClick={waveAct(() => reverseClip(realClipId))}
                    >
                        Reverse
                    </button>
                    <DisabledFeatureWrapper
                        disabled={!isTauri()}
                        reason="AI Denoise requires the Tauri Desktop version of WebDAW to run."
                        className="w-full flex"
                    >
                        <button
                            type="button"
                            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-[var(--color-accent-lavender)] hover:bg-accent"
                            role="menuitem"
                            onClick={waveAct(() => handleAiDenoiseClip(clipId))}
                        >
                            <span>AI Denoise</span>
                            <span className="text-[9px] opacity-60 border border-current rounded px-1 ml-2">
                                {isTauri() ? 'Desktop' : 'Web'}
                            </span>
                        </button>
                    </DisabledFeatureWrapper>
                    <DisabledFeatureWrapper
                        disabled={!isTauri()}
                        reason="AI Stem Separation requires the Tauri Desktop version of WebDAW."
                        className="w-full flex"
                    >
                        <button
                            type="button"
                            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-[var(--color-accent-lavender)] hover:bg-accent"
                            role="menuitem"
                            onClick={waveAct(() => handleStemSeparationPreview(clipId))}
                        >
                            <span>AI Stem Separation</span>
                            <span className="text-[9px] opacity-60 border border-current rounded px-1 ml-2">
                                {isTauri() ? 'Desktop' : 'Web'}
                            </span>
                        </button>
                    </DisabledFeatureWrapper>
                    <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-[var(--color-accent-lavender)] hover:bg-accent"
                        role="menuitem"
                        onClick={waveAct(() => {
                            const track = trackStore.value?.tracks.find((t) => t.clips.some((c) => c.id === clipId));
                            if (track) {
                                audioToMidi({ clipId, trackId: track.id });
                            }
                        })}
                    >
                        <span>AI Audio → MIDI</span>
                        <span className="text-[9px] opacity-60 border border-current rounded px-1 ml-2">DSP</span>
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <button
                        type="button"
                        className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent"
                        role="menuitem"
                        onClick={waveAct(() => {
                            if (warpState.enabled) {
                                disableWarp(clipId);
                            } else {
                                enableWarp(clipId);
                            }
                            refreshWarp();
                        })}
                    >
                        {warpState.enabled ? 'Disable Warp' : 'Enable Warp'}
                    </button>
                </div>
            )}
        </div>
    );
};
