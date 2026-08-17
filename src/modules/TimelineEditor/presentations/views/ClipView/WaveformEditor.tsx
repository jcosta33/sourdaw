import {
    type ReactElement,
    type MouseEvent,
    type DragEvent,
    type PointerEvent,
    useRef,
    useEffect,
    useState,
} from 'react';

import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { Button } from '#/components/ui/button';
import { DisabledFeatureWrapper } from '#/components/ui/disabled-feature-wrapper';
import { Slider } from '#/components/ui/slider';
import { useStore } from '#/infra/store/useStore';
import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';
import { defaultTrackState, trackStore, getWarpState } from '#/modules/Arrangement/stores';
import {
    replaceClipAudioBuffer,
    normalizeClip,
    reverseClip,
    enableWarp,
    disableWarp,
    setStretchMode,
    getStretchModeInfo,
    STRETCH_MODES,
    removeWarpMarker,
    moveWarpMarker,
    commitWarpMarkerBeatDrag,
    addManualWarpMarker,
} from '#/modules/Arrangement/useCases';
import { audioToMidi } from '#/modules/AudioAnalysis/useCases';
import {
    decodeAudioFile,
    getCachedAudioBuffer,
    getCachedAudioBufferWaveformPeaks,
} from '#/modules/AudioEngine/useCases';
import { verifyAudioBufferReferences } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { cn } from '#/utils/Styles/cn';
import { isTauri } from '#/utils/tauriRuntime';
import { menuBtnClass, menuSepClass } from '#/utils/UI/contextMenuStyles';
import { resolveToken } from '#/utils/UI/resolveToken';

// Consumer-local duplicate of Arrangement's WarpState shape (AGENTS.md §95 — model isolation).
// Structurally compatible with the value returned by `getWarpState`.
type WarpMarkerView = { id: string; originalBeat: number; warpedBeat: number };
type WarpState = {
    enabled: boolean;
    markers: WarpMarkerView[];
    stretchMode: 'repitch' | 'complex' | 'texture' | 'beats';
    originalTempo: number | null;
};

// Stretch modes selectable today: only those with a live executor. `complex`,
// `texture` and `beats` name behaviours nothing in the product performs, so the
// strip does not offer them.
const AVAILABLE_STRETCH_MODES: WarpState['stretchMode'][] = STRETCH_MODES.filter(
    (mode) => getStretchModeInfo(mode).available
);

type WaveformMenu = { x: number; y: number } | null;

type WaveformEditorProps = {
    clipId: string;
    audioBufferId?: string;
};

type DrawWaveformInput = {
    canvas: HTMLCanvasElement;
    container: HTMLDivElement;
    bufferId: string;
    zoom: number;
    warpState: WarpState;
    beatWidth: number;
};

const drawWaveform = ({ canvas, container, bufferId, zoom, warpState, beatWidth }: DrawWaveformInput): void => {
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) {
        return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = container.clientWidth * zoom;
    const height = container.clientHeight;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvasContext.scale(devicePixelRatio, devicePixelRatio);

    canvasContext.fillStyle = resolveToken('--color-bg-overlay', '#151515');
    canvasContext.fillRect(0, 0, width, height);

    const middleY = height / 2;
    canvasContext.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    canvasContext.beginPath();
    canvasContext.moveTo(0, middleY);
    canvasContext.lineTo(width, middleY);
    canvasContext.stroke();

    const peaks = getCachedAudioBufferWaveformPeaks({ bufferId, numBins: Math.floor(width) });

    // Peak amplitude cannot tell "no audio loaded" from "audio loaded, and silent":
    // the cache answers a miss with a zero-filled array of exactly the requested
    // length, which is also what a digitally silent buffer measures. Deciding on
    // the peaks alone therefore painted the fake sine placeholder and the "drop an
    // audio file" hint over a clip that really does hold audio — a silent take, a
    // muted stem, a lead-in — telling the user their recording never loaded.
    // Ask the cache who is there; let the peaks decide only what to draw.
    const hasBuffer = getCachedAudioBuffer({ bufferId }) !== null;

    if (hasBuffer && peaks.length > 0) {
        canvasContext.fillStyle = 'rgba(90, 150, 115, 0.5)';
        canvasContext.beginPath();
        canvasContext.moveTo(0, middleY);
        for (let peakIndex = 0; peakIndex < peaks.length; peakIndex++) {
            canvasContext.lineTo(peakIndex, middleY - peaks[peakIndex]! * middleY * 0.9);
        }
        canvasContext.lineTo(peaks.length - 1, middleY);
        for (let peakIndex = peaks.length - 1; peakIndex >= 0; peakIndex--) {
            canvasContext.lineTo(peakIndex, middleY + peaks[peakIndex]! * middleY * 0.9);
        }
        canvasContext.closePath();
        canvasContext.fill();
    } else {
        canvasContext.fillStyle = 'rgba(255, 255, 255, 0.04)';
        const numberOfBars = Math.floor(width / 3);
        for (let barIndex = 0; barIndex < numberOfBars; barIndex++) {
            const normalizedTime = barIndex / numberOfBars;
            const amplitude =
                Math.abs(Math.sin(normalizedTime * Math.PI * 8) * Math.cos(normalizedTime * Math.PI * 3)) * 0.6 + 0.05;
            const barHeight = amplitude * height * 0.4;
            canvasContext.fillRect(barIndex * 3, middleY - barHeight, 2, barHeight * 2);
        }
        canvasContext.fillStyle = 'rgba(255, 255, 255, 0.15)';
        canvasContext.font = '11px system-ui, sans-serif';
        canvasContext.textAlign = 'center';
        canvasContext.fillText('Audio clip — drop an audio file to load waveform', width / 2, middleY - height * 0.35);
    }

    for (let beatIndex = 0; beatIndex < width / beatWidth; beatIndex++) {
        const beatX = beatIndex * beatWidth;
        canvasContext.strokeStyle = beatIndex % 4 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)';
        canvasContext.beginPath();
        canvasContext.moveTo(beatX, 0);
        canvasContext.lineTo(beatX, height);
        canvasContext.stroke();
    }

    if (warpState.enabled) {
        for (const marker of warpState.markers) {
            const markerX = marker.warpedBeat * beatWidth;
            if (markerX < 0 || markerX > width) {
                continue;
            }
            canvasContext.strokeStyle = 'rgba(176, 128, 48, 0.75)';
            canvasContext.lineWidth = 2;
            canvasContext.setLineDash([4, 3]);
            canvasContext.beginPath();
            canvasContext.moveTo(markerX, 0);
            canvasContext.lineTo(markerX, height);
            canvasContext.stroke();
            canvasContext.setLineDash([]);
            canvasContext.lineWidth = 1;

            canvasContext.fillStyle = 'rgba(176, 128, 48, 0.85)';
            canvasContext.beginPath();
            canvasContext.moveTo(markerX - 5, 0);
            canvasContext.lineTo(markerX + 5, 0);
            canvasContext.lineTo(markerX, 8);
            canvasContext.closePath();
            canvasContext.fill();

            canvasContext.font = '9px system-ui';
            canvasContext.fillStyle = 'rgba(176, 128, 48, 0.7)';
            canvasContext.textAlign = 'center';
            canvasContext.fillText(marker.originalBeat.toFixed(1), markerX, height - 4);
        }
    }
};

export const WaveformEditor = ({ clipId, audioBufferId }: WaveformEditorProps): ReactElement => {
    // §195.3 — reactive subscription; component used to read trackStore.value
    // during render and show stale data after clip/track mutations.
    const trackState = useStore(trackStore, defaultTrackState);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [bufferVersion, setBufferVersion] = useState(0);
    const [warpState, setWarpState] = useState<WarpState>(() => getWarpState(clipId));
    const [waveCtxMenu, setWaveCtxMenu] = useState<WaveformMenu>(null);
    const waveCtxRef = useRef<HTMLDivElement>(null);
    // Warp marker drag state
    const draggingMarkerRef = useRef<{
        id: string;
        startX: number;
        startOriginalBeat: number;
        startWarpedBeat: number;
    } | null>(null);
    const [isDraggingMarker, setIsDraggingMarker] = useState(false);
    const didDragRef = useRef(false);

    // audit M-249: `warpState` is seeded once by the lazy initializer above, but
    // ClipView renders this editor without a `key`, so switching the selected clip
    // reuses the instance and leaves the previous clip's warp state on screen and
    // in the toggle branch. Re-read it during the render that changes `clipId` —
    // React's previous-props adjustment — so the committed frame and the first
    // click after a switch both describe the clip actually being edited. Held in
    // state rather than a ref because reading or writing a ref during render is
    // impure (`react-hooks/refs`).
    const [renderedClipId, setRenderedClipId] = useState(clipId);
    if (renderedClipId !== clipId) {
        setRenderedClipId(clipId);
        setWarpState(getWarpState(clipId));
    }

    // audit M-249: `didDragRef` latches on a marker drag and is only cleared by a
    // later pointerdown that lands on a marker, so a drag on the previous clip kept
    // `handleDoubleClick` returning early — swallowing the first double-click that
    // adds or removes a warp marker on the new clip. A clip switch abandons the drag
    // context, so clear the latch with it. Done in an effect rather than in the
    // render block above because writing a ref during render is impure
    // (`react-hooks/refs`); double-clicks arrive from user events, long after flush.
    useEffect(() => {
        didDragRef.current = false;
    }, [clipId]);

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

    const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files[0];
        if (!file || !file.type.startsWith('audio/')) {
            return;
        }

        try {
            const { id: bufferId } = await decodeAudioFile(file);
            if (replaceClipAudioBuffer(clipId, bufferId)) {
                // Dropping a file here is the repair the missing-media panel
                // prompts for, and the panel holds a scan rather than a
                // subscription — so a successful relink has to re-scan or it
                // keeps counting a clip the user has already fixed. This sits
                // at the caller because `replaceClipAudioBuffer` cannot import
                // Project's use cases: Project already imports Arrangement's,
                // and the edge closes a dependency cycle (`deps:validate`
                // no-circular).
                verifyAudioBufferReferences();
            }
            setBufferVersion((value) => value + 1);
        } catch {
            notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
        }
    };

    const beatWidth = Math.max(1, 40 * zoom);

    // Buffer-cache reads/writes (peaks, denoise, stem separation) key on the
    // clip's audioBufferId — the cache key audio is stored under (`audio-<uuid>`),
    // generated independently from the clip id (`clip-<uuid>`). clipId keys
    // clip-model operations (normalize, reverse, warp, audio→MIDI).
    const bufferId = audioBufferId ?? clipId;

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }
        drawWaveform({ canvas, container, bufferId, zoom, warpState, beatWidth });
    }, [bufferId, zoom, bufferVersion, warpState, beatWidth]);

    useEffect(() => {
        const drawCurrentWaveform = (): void => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) {
                return;
            }
            drawWaveform({ canvas, container, bufferId, zoom, warpState, beatWidth });
        };

        const observer = new ResizeObserver(drawCurrentWaveform);
        if (containerRef.current) {
            observer.observe(containerRef.current);
        }
        return () => observer.disconnect();
    }, [bufferId, zoom, warpState, beatWidth]);

    const getCanvasX = (event: { clientX: number }): number => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return 0;
        }
        const rect = canvas.getBoundingClientRect();
        return event.clientX - rect.left + (containerRef.current?.scrollLeft ?? 0);
    };

    const hitTestMarker = (x: number) =>
        warpState.markers.find((message) => Math.abs(message.warpedBeat * beatWidth - x) < 8) ?? null;

    const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!warpState.enabled) {
            return;
        }
        const x = getCanvasX(event);
        const hit = hitTestMarker(x);
        if (hit) {
            draggingMarkerRef.current = {
                id: hit.id,
                startX: x,
                startOriginalBeat: hit.originalBeat,
                startWarpedBeat: hit.warpedBeat,
            };
            didDragRef.current = false;
            setIsDraggingMarker(true);
            (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
            event.preventDefault();
        }
    };

    const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!draggingMarkerRef.current) {
            return;
        }
        const x = getCanvasX(event);
        const dx = Math.abs(x - draggingMarkerRef.current.startX);
        if (dx > 4) {
            didDragRef.current = true;
        }
        if (didDragRef.current) {
            const newBeat = Math.max(0, x / beatWidth);
            moveWarpMarker(clipId, draggingMarkerRef.current.id, newBeat);
            refreshWarp();
        }
    };

    const finishMarkerDrag = (): void => {
        const drag = draggingMarkerRef.current;
        if (!drag) {
            return;
        }
        commitWarpMarkerBeatDrag({
            clipId,
            markerId: drag.id,
            beforeOriginalBeat: drag.startOriginalBeat,
            beforeWarpedBeat: drag.startWarpedBeat,
        });
        draggingMarkerRef.current = null;
        setIsDraggingMarker(false);
    };

    const handlePointerUp = () => {
        finishMarkerDrag();
    };

    const handleDoubleClick = (event: MouseEvent<HTMLCanvasElement>) => {
        if (!warpState.enabled || didDragRef.current) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const x = getCanvasX(event);
        const beat = x / beatWidth;
        const hitMarker = hitTestMarker(x);
        if (hitMarker) {
            removeWarpMarker(clipId, hitMarker.id);
        } else {
            addManualWarpMarker({ clipId, beat });
        }
        refreshWarp();
    };

    const handleWaveContextMenu = (event: MouseEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        setWaveCtxMenu({ x: event.clientX, y: event.clientY });
    };

    useEffect(() => {
        if (!waveCtxMenu) {
            return undefined;
        }
        const dismiss = (event: globalThis.MouseEvent) => {
            if (waveCtxRef.current && !waveCtxRef.current.contains(event.target as Node)) {
                setWaveCtxMenu(null);
            }
        };
        const esc = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
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

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <DawControlStrip>
                <span className="text-[10px] text-muted-foreground">Zoom:</span>
                <Slider
                    value={[zoom * 100]}
                    onValueChange={([value]) => {
                        if (value !== undefined) {
                            setZoom(value / 100);
                        }
                    }}
                    min={25}
                    max={400}
                    step={25}
                    className="w-20"
                    aria-label="Waveform zoom"
                />

                <div
                    className="w-px h-4 mx-1"
                    style={{
                        background:
                            'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)',
                    }}
                />

                <Button
                    variant={warpState.enabled ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={handleToggleWarp}
                    className={cn(
                        'text-[10px] px-2',
                        warpState.enabled && 'text-[var(--color-accent-peach)] border-[var(--color-accent-peach)]/30'
                    )}
                    aria-pressed={warpState.enabled}
                    aria-label="Toggle warp mode"
                >
                    Warp
                </Button>

                {warpState.enabled ? (
                    <>
                        {AVAILABLE_STRETCH_MODES.length > 1 ? (
                            <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
                                {AVAILABLE_STRETCH_MODES.map((mode) => (
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
                        ) : null}

                        <span className="text-[10px] text-[var(--color-accent-peach)]/70">
                            {warpState.markers.length} marker{warpState.markers.length !== 1 ? 's' : ''}
                        </span>
                    </>
                ) : null}
            </DawControlStrip>
            <div
                ref={containerRef}
                className={cn('flex-1 overflow-auto relative', isDragging && 'ring-2 ring-primary ring-inset')}
                onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
            >
                <canvas
                    ref={canvasRef}
                    className={isDraggingMarker ? 'cursor-ew-resize' : 'cursor-crosshair'}
                    aria-label="Waveform editor"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={finishMarkerDrag}
                    onLostPointerCapture={finishMarkerDrag}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleWaveContextMenu}
                />
                {isDragging ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/10 pointer-events-none">
                        <span className="text-sm font-medium text-primary">Drop audio file here</span>
                    </div>
                ) : null}
            </div>
            {waveCtxMenu ? (
                <div
                    ref={waveCtxRef}
                    className="daw-floating-surface fixed z-50 min-w-[160px] rounded-md py-1"
                    style={{ left: waveCtxMenu.x, top: waveCtxMenu.y }}
                    role="menu"
                >
                    <button
                        type="button"
                        className={cn(menuBtnClass, 'hover:bg-accent')}
                        role="menuitem"
                        onClick={waveAct(() => normalizeClip(clipId))}
                    >
                        Normalize
                    </button>
                    <button
                        type="button"
                        className={cn(menuBtnClass, 'hover:bg-accent')}
                        role="menuitem"
                        onClick={waveAct(() => reverseClip(clipId))}
                    >
                        Reverse
                    </button>
                    <DisabledFeatureWrapper
                        disabled={!isTauri()}
                        reason="AI Denoise requires the Tauri Desktop version of Sourdaw to run."
                        className="w-full flex"
                    >
                        <button
                            type="button"
                            className={cn(
                                menuBtnClass,
                                'justify-between text-[var(--color-accent-lavender)] hover:bg-accent'
                            )}
                            role="menuitem"
                            onClick={waveAct(() => {
                                if (!audioBufferId) {
                                    notifyUser('Denoise unavailable — clip has no audio buffer', 'error');
                                    return;
                                }
                                void handleAiDenoiseClip(audioBufferId);
                            })}
                        >
                            <span>AI Denoise</span>
                            <span className="text-[9px] opacity-60 border border-current rounded px-1 ml-2">
                                {isTauri() ? 'Desktop' : 'Web'}
                            </span>
                        </button>
                    </DisabledFeatureWrapper>
                    <button
                        type="button"
                        className={cn(
                            menuBtnClass,
                            'justify-between text-[var(--color-accent-lavender)] hover:bg-accent'
                        )}
                        role="menuitem"
                        onClick={waveAct(() => {
                            const track = trackState.tracks.find((time) =>
                                time.clips.some((context) => context.id === clipId)
                            );
                            if (track) {
                                audioToMidi({ clipId, trackId: track.id });
                            }
                        })}
                    >
                        <span>AI Audio → MIDI</span>
                        <span className="text-[9px] opacity-60 border border-current rounded px-1 ml-2">DSP</span>
                    </button>
                    <div className={menuSepClass} />
                    <button
                        type="button"
                        className={cn(menuBtnClass, 'hover:bg-accent')}
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
            ) : null}
        </div>
    );
};
