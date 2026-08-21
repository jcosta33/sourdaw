import { type ReactElement, type PointerEvent, type MouseEvent, useEffect, useRef, useState } from 'react';

import { DawControlStrip } from '#/components/daw/DawControlStrip';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { useStore } from '#/infra/store/useStore';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultTrackState,
    trackStore,
    getWarpState,
} from '#/modules/Arrangement/stores';
import {
    commitWarpMarkerBeatDrag,
    getStretchModeInfo,
    setStretchMode,
    STRETCH_MODES,
    updateWarpMarkerBeat,
} from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { resolveToken } from '#/utils/UI/resolveToken';

import { audioWarpStore, WARP_ALGORITHMS, type WarpAlgorithm } from '../../stores/audioWarp';
import { defaultElasticAudioState, elasticAudioStore, type ElasticEditorTool } from '../../stores/elasticAudio';
import { getAlgorithmInfo } from '../../useCases/audioWarping/getAlgorithmInfo';
import { setDefaultAlgorithm } from '../../useCases/audioWarping/setDefaultAlgorithm';
import { addManualMarker } from '../../useCases/elasticAudio/addManualMarker';
import { detectTransientsForClip } from '../../useCases/elasticAudio/detectTransientsForClip';
import { markElasticDetectionComplete } from '../../useCases/elasticAudio/markElasticDetectionComplete';
import { quantizeTransients } from '../../useCases/elasticAudio/quantizeTransients';
import { removeMarker } from '../../useCases/elasticAudio/removeMarker';
import { selectElasticMarkers } from '../../useCases/elasticAudio/selectElasticMarkers';
import { setElasticSensitivity } from '../../useCases/elasticAudio/setElasticSensitivity';
import { setElasticTool } from '../../useCases/elasticAudio/setElasticTool';
import { toggleMarkerLock } from '../../useCases/elasticAudio/toggleMarkerLock';

type StretchMode = 'repitch' | 'complex' | 'texture' | 'beats';

// Stretch modes selectable today. Same treatment as the Algorithm selector
// below: only modes with a live executor are offered, so the toolbar never
// presents a choice the product cannot perform. `complex`, `texture` and
// `beats` name behaviours nothing in the tree implements.
const AVAILABLE_STRETCH_MODES: StretchMode[] = STRETCH_MODES.filter((mode) => getStretchModeInfo(mode).available);

// Warp algorithms selectable today. Only executors that actually run are offered
// (SPEC-time-stretch-engine AC-002 / AC-015). Repitch is the sole available mode;
// phase-vocoder and wsola stay hidden until the in-house engine lands, so the
// toolbar never presents a fake or third-party-branded choice.
const AVAILABLE_ALGORITHMS: WarpAlgorithm[] = WARP_ALGORITHMS.filter(
    (algorithm) => getAlgorithmInfo(algorithm).available
);

type WarpMarkerView = {
    id: string;
    originalBeat: number;
    warpedBeat: number;
    origin?: 'user' | 'transient-auto' | 'grid-snap';
    confidence?: number;
    locked?: boolean;
};

type WarpStateView = {
    enabled: boolean;
    markers: WarpMarkerView[];
    stretchMode: StretchMode;
    originalTempo: number | null;
};

type DragState = {
    markerId: string;
    pointerId: number;
    altKey: boolean;
    ctrlKey: boolean;
    startOriginalBeat: number;
    startWarpedBeat: number;
};

const TOOL_BUTTONS: Array<{ id: ElasticEditorTool; label: string }> = [
    { id: 'select', label: 'Select' },
    { id: 'add-marker', label: 'Add' },
    { id: 'remove-marker', label: 'Remove' },
    { id: 'lock-marker', label: 'Lock' },
];

const VIRTUALIZE_THRESHOLD = 200;

export const ElasticEditorPanel = (): ReactElement => {
    const elasticState = useStore(elasticAudioStore, defaultElasticAudioState);
    const workspaceState = useStore(workspaceStore, defaultWorkspaceState);
    const clipSelection = useStore(clipSelectionStore, defaultClipSelectionState);
    const trackState = useStore(trackStore, defaultTrackState);
    const warpSnapshot = useStore(audioWarpStore, {
        clipSettings: new Map(),
        defaultAlgorithm: 'repitch' as WarpAlgorithm,
        globalPitchShift: 0,
    });

    const clipId = elasticState.openClipId ?? clipSelection.selectedClipId;
    const clip = clipId === null ? null : findClip(trackState.tracks, clipId);
    const isAudioClip = clip !== null && clip.type === 'audio';

    const [warpState, setWarpState] = useState<WarpStateView>(() =>
        clipId === null ? emptyWarpState() : getWarpState(clipId)
    );
    const [zoom, setZoom] = useState(1);
    const [viewScrollLeft, setViewScrollLeft] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const didDragRef = useRef(false);

    const refreshWarp = (): void => {
        if (clipId !== null) {
            setWarpState(getWarpState(clipId));
        }
    };

    useEffect(() => {
        if (clipId !== null) {
            setWarpState(getWarpState(clipId));
        }
    }, [clipId]);

    useEffect(() => {
        if (clipId === null) {
            return undefined;
        }
        const onKeyDown = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
                return;
            }
            if (!elasticState.openClipId) {
                return;
            }
            if (event.key === 't' || event.key === 'T') {
                setElasticTool('add-marker');
                event.preventDefault();
            } else if (event.key === 'g' || event.key === 'G') {
                quantizeTransients(clipId);
                refreshWarp();
                event.preventDefault();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                const selected = elasticState.selectedMarkerIds;
                for (const markerId of selected) {
                    removeMarker(markerId);
                }
                refreshWarp();
                event.preventDefault();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [clipId, elasticState.openClipId, elasticState.selectedMarkerIds]);

    const beatWidth = Math.max(1, 40 * zoom);

    useEffect(() => {
        drawWaveform({
            canvasRef,
            containerRef,
            beatWidth,
            warpState,
            clipAudioBufferId: clip?.audioBufferId ?? null,
            viewScrollLeft,
        });
    }, [clipId, zoom, warpState, beatWidth, viewScrollLeft, clip?.audioBufferId]);

    if (clipId === null || !isAudioClip) {
        return (
            <Row justify="center" className="h-full p-6 text-center">
                <div>
                    <div className="text-sm text-muted-foreground">Select an audio clip to open the Elastic editor</div>
                    <div className="mt-2 text-[11px] text-muted-foreground/70">
                        Detect transients, correct them manually, then quantize to the grid.
                    </div>
                </div>
            </Row>
        );
    }

    const handleDetect = (): void => {
        detectTransientsForClip(clipId, elasticState.sensitivity);
        markElasticDetectionComplete();
        refreshWarp();
    };

    const handleQuantize = (): void => {
        quantizeTransients(clipId);
        refreshWarp();
    };

    const handleToolClick = (tool: ElasticEditorTool): void => {
        setElasticTool(tool);
    };

    const handleSensitivity = (value: number): void => {
        // Fire-and-forget settings dispatch from a slider handler; the new
        // sensitivity is observed reactively via the store, no rejection to await.
        void setElasticSensitivity(value);
    };

    const handleStretchMode = (mode: StretchMode): void => {
        setStretchMode(clipId, mode);
        refreshWarp();
    };

    const handleAlgorithm = (algorithm: WarpAlgorithm): void => {
        setDefaultAlgorithm(algorithm);
    };

    const hitTestMarker = (x: number): WarpMarkerView | null => {
        const markers = visibleMarkers(
            warpState.markers,
            beatWidth,
            viewScrollLeft,
            containerRef.current?.clientWidth ?? 0
        );
        return markers.find((m) => Math.abs(m.warpedBeat * beatWidth - x) < 8) ?? null;
    };

    const getCanvasX = (e: { clientX: number }): number => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return 0;
        }
        const rect = canvas.getBoundingClientRect();
        return e.clientX - rect.left + (containerRef.current?.scrollLeft ?? 0);
    };

    const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
        const x = getCanvasX(event);
        const hit = hitTestMarker(x);
        const tool = elasticState.tool;

        if (tool === 'add-marker') {
            if (!hit) {
                addManualMarker(clipId, x / beatWidth);
                refreshWarp();
            }
            return;
        }
        if (tool === 'remove-marker') {
            if (hit) {
                removeMarker(hit.id);
                refreshWarp();
            }
            return;
        }
        if (tool === 'lock-marker') {
            if (hit) {
                toggleMarkerLock(hit.id);
                refreshWarp();
            }
            return;
        }

        if (hit) {
            dragRef.current = {
                markerId: hit.id,
                pointerId: event.pointerId,
                altKey: event.altKey,
                ctrlKey: event.ctrlKey,
                startOriginalBeat: hit.originalBeat,
                startWarpedBeat: hit.warpedBeat,
            };
            didDragRef.current = false;
            (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
            selectElasticMarkers([hit.id]);
        }
    };

    const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }
        didDragRef.current = true;
        const x = getCanvasX(event);
        const beatRaw = Math.max(0, x / beatWidth);
        const beat = drag.ctrlKey || event.ctrlKey ? snapToGrid(beatRaw, workspaceState.snapValue ?? 1) : beatRaw;
        updateWarpMarkerBeat({
            clipId,
            markerId: drag.markerId,
            field: drag.altKey || event.altKey ? 'originalBeat' : 'warpedBeat',
            beat,
        });
        refreshWarp();
    };

    const finishMarkerDrag = (): void => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }
        commitWarpMarkerBeatDrag({
            clipId,
            markerId: drag.markerId,
            beforeOriginalBeat: drag.startOriginalBeat,
            beforeWarpedBeat: drag.startWarpedBeat,
        });
        dragRef.current = null;
    };

    const onPointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
        const drag = dragRef.current;
        if (drag) {
            (event.target as HTMLCanvasElement).releasePointerCapture(drag.pointerId);
        }
        finishMarkerDrag();
    };

    const onContextMenu = (event: MouseEvent<HTMLCanvasElement>): void => {
        event.preventDefault();
    };

    const counts = countMarkers(warpState.markers);
    const quantizeDisabled = !elasticState.detected || warpState.markers.length === 0;

    return (
        <Stack className="h-full overflow-hidden" data-testid="elastic-editor-panel">
            <DawControlStrip className="px-3 py-1.5 gap-2">
                <Row
                    gap={0.5}
                    className="rounded-md border border-border/40 p-0.5"
                    role="radiogroup"
                    aria-label="Elastic tool"
                >
                    {TOOL_BUTTONS.map((tool) => (
                        <Button
                            key={tool.id}
                            variant={elasticState.tool === tool.id ? 'secondary' : 'ghost'}
                            size="xs"
                            className="h-6 px-2 text-[10px]"
                            aria-pressed={elasticState.tool === tool.id}
                            data-testid={`elastic-tool-${tool.id}`}
                            onClick={() => handleToolClick(tool.id)}
                        >
                            {tool.label}
                        </Button>
                    ))}
                </Row>

                <Row gap={2}>
                    <span className="text-[10px] text-muted-foreground">Sensitivity</span>
                    <Slider
                        value={[elasticState.sensitivity * 100]}
                        onValueChange={([v]) => {
                            if (v !== undefined) {
                                handleSensitivity(v / 100);
                            }
                        }}
                        min={0}
                        max={100}
                        step={1}
                        className="w-24"
                        aria-label="Transient detection sensitivity"
                    />
                    <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
                        {(elasticState.sensitivity * 100).toFixed(0)}
                    </span>
                </Row>

                <Button
                    variant="secondary"
                    size="xs"
                    className="h-6 px-2 text-[10px]"
                    data-testid="elastic-detect-button"
                    onClick={handleDetect}
                >
                    Detect
                </Button>
                <Button
                    variant="secondary"
                    size="xs"
                    className="h-6 px-2 text-[10px]"
                    data-testid="elastic-quantize-button"
                    onClick={handleQuantize}
                    disabled={quantizeDisabled}
                >
                    Quantize
                </Button>

                {AVAILABLE_STRETCH_MODES.length > 1 ? (
                    <Row as="label" gap={1} className="text-[10px] text-muted-foreground">
                        Stretch
                        <select
                            className="daw-inset-surface rounded px-1 py-0.5 text-[10px] text-foreground"
                            value={warpState.stretchMode}
                            onChange={(e) => handleStretchMode(e.target.value as StretchMode)}
                            aria-label="Stretch mode"
                        >
                            {AVAILABLE_STRETCH_MODES.map((mode) => (
                                <option key={mode} value={mode}>
                                    {getStretchModeInfo(mode).name}
                                </option>
                            ))}
                        </select>
                    </Row>
                ) : null}

                {AVAILABLE_ALGORITHMS.length > 1 ? (
                    <Row as="label" gap={1} className="text-[10px] text-muted-foreground">
                        Algorithm
                        <select
                            className="daw-inset-surface rounded px-1 py-0.5 text-[10px] text-foreground"
                            value={warpSnapshot.defaultAlgorithm}
                            onChange={(e) => handleAlgorithm(e.target.value as WarpAlgorithm)}
                            aria-label="Warp algorithm"
                        >
                            {AVAILABLE_ALGORITHMS.map((algo) => (
                                <option key={algo} value={algo}>
                                    {getAlgorithmInfo(algo).name}
                                </option>
                            ))}
                        </select>
                    </Row>
                ) : null}

                <Row gap={2} className="ml-auto text-[10px] text-muted-foreground">
                    <span>Zoom</span>
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
                </Row>
            </DawControlStrip>

            <div
                ref={containerRef}
                className="relative flex-1 overflow-auto"
                onScroll={(e) => setViewScrollLeft((e.target as HTMLDivElement).scrollLeft)}
            >
                <canvas
                    ref={canvasRef}
                    className="cursor-crosshair"
                    aria-label="Elastic waveform canvas"
                    data-testid="elastic-waveform-canvas"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={finishMarkerDrag}
                    onLostPointerCapture={finishMarkerDrag}
                    onContextMenu={onContextMenu}
                />
            </div>

            <Row
                justify="between"
                gap={3}
                className="border-t border-border/40 px-3 py-1 text-[10px] text-muted-foreground"
                data-testid="elastic-detail-strip"
            >
                <span>
                    {counts.transient} transient{plural(counts.transient)}, {counts.user} user, {counts.locked} locked
                </span>
                <span className="text-[9px] opacity-70">T: transient tool · G: quantize · Delete: remove selected</span>
            </Row>
        </Stack>
    );
};

function findClip(
    tracks: ReadonlyArray<{ clips: ReadonlyArray<{ id: string; type: string; audioBufferId?: string }> }>,
    clipId: string
): { id: string; type: string; audioBufferId?: string } | null {
    for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return null;
}

// Placeholder state for "no clip selected". Mirrors Arrangement's
// `defaultWarpState`, which cannot be imported here — models are not
// re-exported across modules, which is why `WarpStateView` is a local
// duplicate too. Keep `stretchMode` in step with that default: it must always
// name a mode with a live executor (see `getStretchModeInfo`).
function emptyWarpState(): WarpStateView {
    return { enabled: false, markers: [], stretchMode: 'repitch', originalTempo: null };
}

function countMarkers(markers: ReadonlyArray<WarpMarkerView>): {
    transient: number;
    user: number;
    locked: number;
} {
    let transient = 0;
    let user = 0;
    let locked = 0;
    for (const marker of markers) {
        const origin = marker.origin ?? 'user';
        if (origin === 'transient-auto') {
            transient++;
        } else if (origin === 'user') {
            user++;
        }
        if (marker.locked) {
            locked++;
        }
    }
    return { transient, user, locked };
}

function plural(count: number): string {
    return count === 1 ? '' : 's';
}

function snapToGrid(beat: number, snap: number): number {
    if (snap <= 0) {
        return beat;
    }
    return Math.round(beat / snap) * snap;
}

function visibleMarkers(
    markers: ReadonlyArray<WarpMarkerView>,
    beatWidth: number,
    scrollLeft: number,
    containerWidth: number
): WarpMarkerView[] {
    if (markers.length <= VIRTUALIZE_THRESHOLD || containerWidth <= 0) {
        return [...markers];
    }
    const minX = scrollLeft - 16;
    const maxX = scrollLeft + containerWidth + 16;
    return markers.filter((m) => {
        const x = m.warpedBeat * beatWidth;
        return x >= minX && x <= maxX;
    });
}

type DrawArgs = {
    canvasRef: { current: HTMLCanvasElement | null };
    containerRef: { current: HTMLDivElement | null };
    beatWidth: number;
    warpState: WarpStateView;
    clipAudioBufferId: string | null;
    viewScrollLeft: number;
};

function drawWaveform(args: DrawArgs): void {
    const { canvasRef, containerRef, beatWidth, warpState, clipAudioBufferId, viewScrollLeft } = args;
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
    const contentBeats = Math.max(
        64,
        warpState.markers.reduce((max, m) => Math.max(max, m.warpedBeat, m.originalBeat), 0) + 8
    );
    const width = Math.max(container.clientWidth, contentBeats * beatWidth);
    const height = Math.max(120, container.clientHeight);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
    ctx.fillRect(0, 0, width, height);

    const midY = height / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    if (clipAudioBufferId) {
        const peaks = audioBufferCache.getWaveformPeaks(clipAudioBufferId, Math.floor(width));
        if (peaks.some((v) => v > 0)) {
            ctx.fillStyle = 'rgba(90,150,115,0.5)';
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
        }
    }

    for (let beat = 0; beat < width / beatWidth; beat++) {
        const x = beat * beatWidth;
        ctx.strokeStyle = beat % 4 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    const markers = visibleMarkers(warpState.markers, beatWidth, viewScrollLeft, container.clientWidth);
    for (const marker of markers) {
        const x = marker.warpedBeat * beatWidth;
        if (x < -16 || x > width + 16) {
            continue;
        }
        const color = markerColor(marker);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.lineWidth = 1;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x, 8);
        ctx.closePath();
        ctx.fill();

        if (marker.locked) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillRect(x - 2, 10, 4, 4);
        }
    }
}

function markerColor(marker: WarpMarkerView): string {
    const origin = marker.origin ?? 'user';
    if (origin === 'transient-auto') {
        const confidence = marker.confidence ?? 1;
        const alpha = 0.35 + 0.55 * Math.max(0, Math.min(1, confidence));
        return `rgba(99, 160, 214, ${alpha.toFixed(2)})`;
    }
    if (origin === 'grid-snap') {
        return 'rgba(120, 190, 130, 0.85)';
    }
    return 'rgba(220, 150, 60, 0.9)';
}
