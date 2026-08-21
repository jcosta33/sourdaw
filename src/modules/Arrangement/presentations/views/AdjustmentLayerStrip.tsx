import {
    type ReactElement,
    type MouseEvent as ReactMouseEvent,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

import { Layers, Plus, Power, Settings2, Trash2, X } from 'lucide-react';

import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Row, Stack } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { cn } from '#/utils/Styles/cn';

import {
    adjustmentLayerStore,
    EFFECT_PRESETS,
    type AdjustmentEffectType,
    type AdjustmentLayer,
    type AdjustmentLayerState,
    type AdjustmentRegion,
} from '../../stores/adjustmentLayer';
import { trackStore, defaultTrackState } from '../../stores/trackStore';

import { TimelineChromeSurface } from './TimelineChromeSurface';

type AdjustmentLayerStripProps = {
    pixelsPerBeat: number;
    scrollX: number;
};

type LayerContextMenu =
    | { kind: 'none' }
    | { kind: 'layer'; x: number; y: number; layer: AdjustmentLayer }
    | { kind: 'region'; x: number; y: number; layer: AdjustmentLayer; region: AdjustmentRegion };

type InspectorState = { layerId: string } | null;

type DragState =
    | { kind: 'move'; regionId: string; layerId: string; startClientX: number; origStart: number; origEnd: number }
    | {
          kind: 'resizeStart';
          regionId: string;
          layerId: string;
          startClientX: number;
          origStart: number;
          origEnd: number;
      }
    | { kind: 'resizeEnd'; regionId: string; layerId: string; startClientX: number; origStart: number; origEnd: number }
    | {
          kind: 'fadeIn';
          regionId: string;
          layerId: string;
          startClientX: number;
          origFadeIn: number;
          origFadeOut: number;
          regionWidthBeats: number;
      }
    | {
          kind: 'fadeOut';
          regionId: string;
          layerId: string;
          startClientX: number;
          origFadeIn: number;
          origFadeOut: number;
          regionWidthBeats: number;
      }
    | null;

type FadePreview = { regionId: string; fadeInBeats: number; fadeOutBeats: number };

const ROW_HEIGHT = 20;
const MIN_DRAG_PX = 3;

export const getAdjustmentLayerStripHeight = (layerCount: number): number =>
    Math.max(ROW_HEIGHT, layerCount * ROW_HEIGHT) + ROW_HEIGHT;

const ALL_EFFECT_TYPES: AdjustmentEffectType[] = [
    'eq',
    'compressor',
    'reverb',
    'delay',
    'saturation',
    'filter',
    'stereo-width',
    'volume',
    'pan',
];

const defaultState: AdjustmentLayerState = { layers: [] };

export const AdjustmentLayerStrip = ({ pixelsPerBeat, scrollX }: AdjustmentLayerStripProps): ReactElement => {
    const state = useStore(adjustmentLayerStore, defaultState);
    const trackState = useStore(trackStore, defaultTrackState);
    const layers = state.layers;

    const [contextMenu, setContextMenu] = useState<LayerContextMenu>({ kind: 'none' });
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [inspector, setInspector] = useState<InspectorState>(null);
    const [tracksPicker, setTracksPicker] = useState<{ layerId: string } | null>(null);
    const [dragPreview, setDragPreview] = useState<{ regionId: string; startBeat: number; endBeat: number } | null>(
        null
    );
    const [fadePreview, setFadePreview] = useState<FadePreview | null>(null);
    const dragStateRef = useRef<DragState>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const addMenuRef = useRef<HTMLDivElement>(null);
    // Holds the teardown for the in-flight drag's global listeners (region or
    // fade) so an unmount mid-drag can detach them; null when no drag is active.
    const dragCleanupRef = useRef<(() => void) | null>(null);
    const stripRef = useRef<HTMLDivElement>(null);
    const [stripWidth, setStripWidth] = useState(0);

    // Detach any global drag listeners still attached when the strip unmounts.
    useEffect(() => {
        return () => {
            dragCleanupRef.current?.();
            dragCleanupRef.current = null;
        };
    }, []);

    useLayoutEffect(() => {
        const strip = stripRef.current;
        if (!strip) {
            return undefined;
        }
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setStripWidth(entry.contentRect.width);
            }
        });
        observer.observe(strip);
        setStripWidth(strip.getBoundingClientRect().width);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (contextMenu.kind === 'none') {
            return undefined;
        }
        const handleClick = (e: globalThis.MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu({ kind: 'none' });
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [contextMenu.kind]);

    useEffect(() => {
        if (!addMenuOpen) {
            return undefined;
        }
        const handleClick = (e: globalThis.MouseEvent) => {
            if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
                setAddMenuOpen(false);
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [addMenuOpen]);

    const rowsHeight = Math.max(ROW_HEIGHT, layers.length * ROW_HEIGHT);

    const startRegionDrag = (
        e: ReactMouseEvent,
        layer: AdjustmentLayer,
        region: AdjustmentRegion,
        kind: 'move' | 'resizeStart' | 'resizeEnd'
    ) => {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const startClientX = e.clientX;
        const origStart = region.startBeat;
        const origEnd = region.endBeat;

        dragStateRef.current = { kind, layerId: layer.id, regionId: region.id, startClientX, origStart, origEnd };

        // Last position computed by handleMove, read synchronously by handleUp.
        // Using a plain closure variable (rather than reading dragPreview state
        // synced through an effect) avoids a one-commit lag when the final
        // mousemove and mouseup coalesce before React flushes the effect.
        let lastPreview: { regionId: string; startBeat: number; endBeat: number } | null = null;

        const handleMove = (moveEvent: globalThis.MouseEvent) => {
            const deltaPx = moveEvent.clientX - startClientX;
            if (Math.abs(deltaPx) < MIN_DRAG_PX) {
                return;
            }
            const deltaBeats = deltaPx / pixelsPerBeat;
            let nextStart = origStart;
            let nextEnd = origEnd;
            if (kind === 'move') {
                nextStart = Math.max(0, origStart + deltaBeats);
                nextEnd = nextStart + (origEnd - origStart);
            } else if (kind === 'resizeStart') {
                nextStart = Math.max(0, Math.min(origStart + deltaBeats, origEnd - 0.25));
            } else {
                nextEnd = Math.max(origStart + 0.25, origEnd + deltaBeats);
            }
            lastPreview = { regionId: region.id, startBeat: nextStart, endBeat: nextEnd };
            setDragPreview(lastPreview);
        };

        const detachListeners = () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };

        const handleUp = () => {
            detachListeners();
            const finalPreview = lastPreview;
            dragStateRef.current = null;
            dragCleanupRef.current = null;
            if (finalPreview) {
                // Fire-and-forget command dispatch from a mouseup handler; the
                // store update is observed reactively, no rejection to await here.
                void executeAppAction({
                    type: 'moveAdjustmentRegion',
                    payload: {
                        regionId: finalPreview.regionId,
                        startBeat: finalPreview.startBeat,
                        endBeat: finalPreview.endBeat,
                    },
                });
            }
            setDragPreview(null);
        };

        dragCleanupRef.current = detachListeners;
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
    };

    const startFadeDrag = (
        e: ReactMouseEvent,
        layer: AdjustmentLayer,
        region: AdjustmentRegion,
        kind: 'fadeIn' | 'fadeOut'
    ) => {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const startClientX = e.clientX;
        const regionWidthBeats = Math.max(0.0001, region.endBeat - region.startBeat);
        const origFadeIn = region.fadeInBeats;
        const origFadeOut = region.fadeOutBeats;

        dragStateRef.current = {
            kind,
            layerId: layer.id,
            regionId: region.id,
            startClientX,
            origFadeIn,
            origFadeOut,
            regionWidthBeats,
        };

        // Last fade computed by handleMove, read synchronously by handleUp.
        // Using a plain closure variable (rather than reading fadePreview state
        // synced through an effect) avoids a one-commit lag when the final
        // mousemove and mouseup coalesce before React flushes the effect.
        let lastFade: FadePreview | null = null;

        const handleMove = (moveEvent: globalThis.MouseEvent) => {
            const deltaPx = moveEvent.clientX - startClientX;
            const deltaBeats = deltaPx / pixelsPerBeat;
            let nextFadeIn = origFadeIn;
            let nextFadeOut = origFadeOut;
            if (kind === 'fadeIn') {
                nextFadeIn = Math.max(0, Math.min(regionWidthBeats - origFadeOut, origFadeIn + deltaBeats));
            } else {
                nextFadeOut = Math.max(0, Math.min(regionWidthBeats - origFadeIn, origFadeOut - deltaBeats));
            }
            lastFade = { regionId: region.id, fadeInBeats: nextFadeIn, fadeOutBeats: nextFadeOut };
            setFadePreview(lastFade);
        };

        const detachListeners = () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };

        const handleUp = () => {
            detachListeners();
            const finalPreview = lastFade;
            dragStateRef.current = null;
            dragCleanupRef.current = null;
            if (finalPreview) {
                // Fire-and-forget command dispatch from a mouseup handler; the
                // store update is observed reactively, no rejection to await here.
                void executeAppAction({
                    type: 'setLayerFades',
                    payload: {
                        regionId: finalPreview.regionId,
                        fadeInBeats: finalPreview.fadeInBeats,
                        fadeOutBeats: finalPreview.fadeOutBeats,
                    },
                });
            }
            setFadePreview(null);
        };

        dragCleanupRef.current = detachListeners;
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
    };

    const openAddMenu = () => setAddMenuOpen((prev) => !prev);

    // These wrappers dispatch commands from UI handlers (click / slider / lane
    // click). The resulting state is observed reactively via the store, so each
    // dispatch is fire-and-forget — no rejection to await at the call site.
    const createLayer = (effectType: AdjustmentEffectType) => {
        const label = `${effectType.charAt(0).toUpperCase()}${effectType.slice(1)} Layer`;
        void executeAppAction({
            type: 'createAdjustmentLayer',
            payload: { name: label, effectType },
        });
        setAddMenuOpen(false);
    };

    const toggleLayer = (layerId: string) => {
        void executeAppAction({ type: 'toggleAdjustmentLayer', payload: { layerId } });
    };

    const removeLayer = (layerId: string) => {
        void executeAppAction({ type: 'removeAdjustmentLayer', payload: { layerId } });
    };

    const removeRegion = (layerId: string, regionId: string) => {
        void executeAppAction({ type: 'removeAdjustmentRegion', payload: { layerId, regionId } });
    };

    const setLayerMix = (layerId: string, mix: number) => {
        void executeAppAction({ type: 'setLayerMix', payload: { layerId, mix } });
    };

    const setLayerParameter = (layerId: string, paramName: string, value: number) => {
        void executeAppAction({ type: 'setLayerParameter', payload: { layerId, paramName, value } });
    };

    const setAffectedTracks = (layerId: string, trackIds: string[]) => {
        void executeAppAction({ type: 'setLayerAffectedTracks', payload: { layerId, trackIds } });
    };

    const addRegionAtBeat = (layerId: string, beat: number) => {
        const start = Math.max(0, Math.floor(beat));
        void executeAppAction({
            type: 'addAdjustmentRegion',
            payload: { layerId, startBeat: start, endBeat: start + 4, blend: 1 },
        });
    };

    const handleLaneClick = (e: ReactMouseEvent<HTMLDivElement>, layer: AdjustmentLayer) => {
        if (e.button !== 0) {
            return;
        }
        if (!e.altKey) {
            return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const clickBeat = (localX + scrollX) / pixelsPerBeat;
        addRegionAtBeat(layer.id, clickBeat);
    };

    const handleLayerContextMenu = (e: ReactMouseEvent, layer: AdjustmentLayer) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ kind: 'layer', x: e.clientX, y: e.clientY, layer });
    };

    const handleRegionContextMenu = (e: ReactMouseEvent, layer: AdjustmentLayer, region: AdjustmentRegion) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ kind: 'region', x: e.clientX, y: e.clientY, layer, region });
    };

    const handleRegionDoubleClick = (e: ReactMouseEvent, layer: AdjustmentLayer) => {
        e.preventDefault();
        e.stopPropagation();
        setInspector({ layerId: layer.id });
    };

    const inspectorLayer = inspector ? (layers.find((l) => l.id === inspector.layerId) ?? null) : null;

    return (
        <TimelineChromeSurface
            ref={stripRef}
            className="select-none"
            style={{ height: rowsHeight + ROW_HEIGHT }}
            role="region"
            aria-label="Adjustment layers"
            data-onboarding="adjustment-layer-strip"
        >
            <Row justify="between" className="border-b border-border/30 px-2" style={{ height: ROW_HEIGHT }}>
                <Row gap={1.5} className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Layers className="size-2.5" />
                    Adjustment Layers
                </Row>
                <button
                    type="button"
                    className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-white/10"
                    onClick={openAddMenu}
                    aria-label="Add adjustment layer"
                >
                    <Plus className="size-3" />
                </button>
            </Row>

            {layers.map((layer, idx) => {
                const yOffset = ROW_HEIGHT + idx * ROW_HEIGHT;
                return (
                    <AdjustmentLayerRow
                        key={layer.id}
                        layer={layer}
                        yOffset={yOffset}
                        pixelsPerBeat={pixelsPerBeat}
                        scrollX={scrollX}
                        laneWidth={stripWidth}
                        dragPreview={dragPreview}
                        fadePreview={fadePreview}
                        onLaneClick={handleLaneClick}
                        onLayerContextMenu={handleLayerContextMenu}
                        onRegionContextMenu={handleRegionContextMenu}
                        onRegionDoubleClick={handleRegionDoubleClick}
                        onRegionDragStart={startRegionDrag}
                        onFadeDragStart={startFadeDrag}
                        onToggleEnabled={() => toggleLayer(layer.id)}
                        onRemoveLayer={() => removeLayer(layer.id)}
                        onOpenAffectedTracks={() => setTracksPicker({ layerId: layer.id })}
                    />
                );
            })}

            {addMenuOpen ? (
                <div
                    ref={addMenuRef}
                    className="daw-floating-surface absolute right-2 top-5 z-50 min-w-[200px] rounded-md p-1"
                >
                    <DawMenuMutedRow className="px-2">New Adjustment Layer</DawMenuMutedRow>
                    {ALL_EFFECT_TYPES.map((effectType) => (
                        <DawMenuButton key={effectType} onClick={() => createLayer(effectType)}>
                            {effectType.charAt(0).toUpperCase() + effectType.slice(1)}
                        </DawMenuButton>
                    ))}
                </div>
            ) : null}

            {contextMenu.kind !== 'none' ? (
                <div
                    ref={menuRef}
                    className="daw-floating-surface fixed z-50 min-w-[180px] rounded-md p-1"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    {contextMenu.kind === 'layer' ? (
                        <>
                            <DawMenuMutedRow className="px-2">{contextMenu.layer.name}</DawMenuMutedRow>
                            <DawMenuButton
                                leadingContent={<Power className="size-2.5" />}
                                onClick={() => {
                                    toggleLayer(contextMenu.layer.id);
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                {contextMenu.layer.enabled ? 'Disable Layer' : 'Enable Layer'}
                            </DawMenuButton>
                            <DawMenuButton
                                onClick={() => {
                                    setInspector({ layerId: contextMenu.layer.id });
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Edit Parameters…
                            </DawMenuButton>
                            <DawMenuButton
                                leadingContent={<Settings2 className="size-2.5" />}
                                onClick={() => {
                                    setTracksPicker({ layerId: contextMenu.layer.id });
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Affected Tracks…
                            </DawMenuButton>
                            <DawMenuSeparator />
                            <DawMenuMutedRow className="px-2">Mix</DawMenuMutedRow>
                            <div className="px-2 pb-1.5">
                                <Slider
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={[contextMenu.layer.mix]}
                                    onValueChange={(values: number[]) => {
                                        const next = values[0] ?? contextMenu.layer.mix;
                                        setLayerMix(contextMenu.layer.id, next);
                                    }}
                                />
                            </div>
                            <DawMenuSeparator />
                            <DawMenuButton
                                tone="danger"
                                leadingContent={<Trash2 className="size-2.5" />}
                                onClick={() => {
                                    removeLayer(contextMenu.layer.id);
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Remove Layer
                            </DawMenuButton>
                        </>
                    ) : null}
                    {contextMenu.kind === 'region' ? (
                        <>
                            <DawMenuMutedRow className="px-2">
                                Region: {contextMenu.region.startBeat.toFixed(1)}–
                                {contextMenu.region.endBeat.toFixed(1)}
                            </DawMenuMutedRow>
                            <DawMenuButton
                                onClick={() => {
                                    setInspector({ layerId: contextMenu.layer.id });
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Edit Layer Parameters…
                            </DawMenuButton>
                            <DawMenuSeparator />
                            <DawMenuButton
                                tone="danger"
                                leadingContent={<Trash2 className="size-2.5" />}
                                onClick={() => {
                                    removeRegion(contextMenu.layer.id, contextMenu.region.id);
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Remove Region
                            </DawMenuButton>
                        </>
                    ) : null}
                </div>
            ) : null}

            {inspectorLayer ? (
                <AdjustmentLayerParamEditor
                    layer={inspectorLayer}
                    onClose={() => setInspector(null)}
                    onSetParameter={(paramName, value) => setLayerParameter(inspectorLayer.id, paramName, value)}
                    onSetMix={(mix) => setLayerMix(inspectorLayer.id, mix)}
                />
            ) : null}

            {tracksPicker ? (
                <AffectedTracksPicker
                    layer={layers.find((l) => l.id === tracksPicker.layerId) ?? null}
                    tracks={trackState.tracks.map((t) => ({ id: t.id, name: t.name }))}
                    onClose={() => setTracksPicker(null)}
                    onChange={(trackIds) => setAffectedTracks(tracksPicker.layerId, trackIds)}
                />
            ) : null}
        </TimelineChromeSurface>
    );
};

type AdjustmentLayerRowProps = {
    layer: AdjustmentLayer;
    yOffset: number;
    pixelsPerBeat: number;
    scrollX: number;
    /** Measured width of the strip, used to cull off-screen regions. */
    laneWidth: number;
    dragPreview: { regionId: string; startBeat: number; endBeat: number } | null;
    fadePreview: FadePreview | null;
    onLaneClick: (e: ReactMouseEvent<HTMLDivElement>, layer: AdjustmentLayer) => void;
    onLayerContextMenu: (e: ReactMouseEvent, layer: AdjustmentLayer) => void;
    onRegionContextMenu: (e: ReactMouseEvent, layer: AdjustmentLayer, region: AdjustmentRegion) => void;
    onRegionDoubleClick: (e: ReactMouseEvent, layer: AdjustmentLayer) => void;
    onRegionDragStart: (
        e: ReactMouseEvent,
        layer: AdjustmentLayer,
        region: AdjustmentRegion,
        kind: 'move' | 'resizeStart' | 'resizeEnd'
    ) => void;
    onFadeDragStart: (
        e: ReactMouseEvent,
        layer: AdjustmentLayer,
        region: AdjustmentRegion,
        kind: 'fadeIn' | 'fadeOut'
    ) => void;
    onToggleEnabled: () => void;
    onRemoveLayer: () => void;
    onOpenAffectedTracks: () => void;
};

const AdjustmentLayerRow = ({
    layer,
    yOffset,
    pixelsPerBeat,
    scrollX,
    laneWidth,
    dragPreview,
    fadePreview,
    onLaneClick,
    onLayerContextMenu,
    onRegionContextMenu,
    onRegionDoubleClick,
    onRegionDragStart,
    onFadeDragStart,
    onToggleEnabled,
    onRemoveLayer,
    onOpenAffectedTracks,
}: AdjustmentLayerRowProps): ReactElement => {
    const regions = layer.regions.length > 0 ? layer.regions : DEFAULT_FULL_RANGE_REGION;

    return (
        <div
            className={cn('absolute left-0 right-0 border-b border-border/20', layer.enabled ? '' : 'opacity-40')}
            style={{ top: yOffset, height: ROW_HEIGHT }}
            onClick={(e) => onLaneClick(e, layer)}
            onContextMenu={(e) => onLayerContextMenu(e, layer)}
        >
            <Row
                gap={1}
                className="absolute left-0 top-0 z-10 border-r border-border/40 px-1 py-0.5"
                style={{ height: ROW_HEIGHT, backgroundColor: 'var(--color-surface-base)' }}
            >
                <button
                    type="button"
                    className="flex size-3 items-center justify-center rounded-sm hover:bg-white/10"
                    title={layer.enabled ? 'Disable' : 'Enable'}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleEnabled();
                    }}
                >
                    <Power className="size-2.5" style={{ color: layer.color }} />
                </button>
                <span
                    className="max-w-[80px] truncate text-[9px] font-medium"
                    style={{ color: layer.color }}
                    title={layer.name}
                >
                    {layer.name}
                </span>
                <button
                    type="button"
                    className="flex size-3 items-center justify-center rounded-sm hover:bg-white/10"
                    title="Affected tracks"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenAffectedTracks();
                    }}
                >
                    <Settings2 className="size-2.5" />
                </button>
                <button
                    type="button"
                    className="flex size-3 items-center justify-center rounded-sm hover:bg-white/10"
                    title="Remove layer"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemoveLayer();
                    }}
                >
                    <X className="size-2.5" />
                </button>
            </Row>
            {regions.map((region) => {
                const liveRegion =
                    dragPreview && dragPreview.regionId === region.id && region !== EMPTY_RANGE_SENTINEL
                        ? { startBeat: dragPreview.startBeat, endBeat: dragPreview.endBeat }
                        : { startBeat: region.startBeat, endBeat: region.endBeat };
                const left = liveRegion.startBeat * pixelsPerBeat - scrollX;
                const width = (liveRegion.endBeat - liveRegion.startBeat) * pixelsPerBeat;
                // Cull regions outside the strip's actual width; fall back to a
                // permissive bound until the strip has been measured. The 100px
                // left margin is reserved for the in-row layer controls.
                const rightBound = laneWidth > 0 ? laneWidth : Infinity;
                if (left + width < 100 || left > rightBound) {
                    return null;
                }
                const isSentinel = region === EMPTY_RANGE_SENTINEL;
                return (
                    <div
                        key={isSentinel ? `${layer.id}-full` : region.id}
                        className={cn(
                            'absolute top-0 bottom-0 rounded-sm border',
                            isSentinel ? 'pointer-events-none opacity-50' : 'cursor-grab active:cursor-grabbing'
                        )}
                        style={{
                            left: Math.max(110, left),
                            width: Math.max(4, width),
                            backgroundColor: `${layer.color}66`,
                            borderColor: layer.color,
                        }}
                        onMouseDown={(e) => (isSentinel ? undefined : onRegionDragStart(e, layer, region, 'move'))}
                        onContextMenu={(e) => (isSentinel ? undefined : onRegionContextMenu(e, layer, region))}
                        onDoubleClick={(e) => onRegionDoubleClick(e, layer)}
                    >
                        {isSentinel ? null : (
                            <>
                                <div
                                    className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize bg-white/40"
                                    onMouseDown={(e) => onRegionDragStart(e, layer, region, 'resizeStart')}
                                />
                                <div
                                    className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize bg-white/40"
                                    onMouseDown={(e) => onRegionDragStart(e, layer, region, 'resizeEnd')}
                                />
                                <FadeTriangles
                                    region={region}
                                    pixelsPerBeat={pixelsPerBeat}
                                    width={Math.max(4, width)}
                                    fadePreview={fadePreview}
                                    onFadeDragStart={(e, kind) => onFadeDragStart(e, layer, region, kind)}
                                />
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// Sentinel used to render a full-range band for layers without explicit regions.
// Frozen because it is a shared singleton: any path that writes to a region's
// startBeat/endBeat would otherwise mutate this object for every layer.
// Exported for the freeze regression test.
export const EMPTY_RANGE_SENTINEL: AdjustmentRegion = Object.freeze({
    id: '__sentinel__',
    startBeat: 0,
    endBeat: 200,
    blend: 1,
    fadeInBeats: 0,
    fadeOutBeats: 0,
});
export const DEFAULT_FULL_RANGE_REGION: readonly AdjustmentRegion[] = Object.freeze([EMPTY_RANGE_SENTINEL]);

type AdjustmentLayerParamEditorProps = {
    layer: AdjustmentLayer;
    onClose: () => void;
    onSetParameter: (paramName: string, value: number) => void;
    onSetMix: (mix: number) => void;
};

const AdjustmentLayerParamEditor = ({
    layer,
    onClose,
    onSetParameter,
    onSetMix,
}: AdjustmentLayerParamEditorProps): ReactElement => {
    const presetParams = EFFECT_PRESETS[layer.effectType] ?? [];
    const paramByName = new Map(layer.parameters.map((p) => [p.name, p]));

    return (
        <Row justify="center" className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
            <div
                className="daw-floating-surface w-[380px] rounded-md p-4"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={`Adjustment Layer: ${layer.name}`}
            >
                <Row justify="between" className="mb-3">
                    <div>
                        <div className="text-xs font-semibold" style={{ color: layer.color }}>
                            {layer.name}
                        </div>
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            {layer.effectType}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="flex size-5 items-center justify-center rounded-sm hover:bg-white/10"
                        onClick={onClose}
                        aria-label="Close inspector"
                    >
                        <X className="size-3" />
                    </button>
                </Row>

                <div className="mb-3">
                    <div className="mb-1 text-[10px] font-medium text-muted-foreground">Mix</div>
                    <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        value={[layer.mix]}
                        onValueChange={(values: number[]) => {
                            const next = values[0];
                            if (typeof next === 'number') {
                                onSetMix(next);
                            }
                        }}
                    />
                </div>

                <Stack gap={2}>
                    {presetParams.map((preset) => {
                        const current = paramByName.get(preset.name) ?? preset;
                        return (
                            <div key={preset.name}>
                                <Row justify="between" className="mb-1 text-[10px]">
                                    <span className="font-medium">{preset.name}</span>
                                    <span className="text-muted-foreground">
                                        {current.value.toFixed(2)}
                                        {preset.unit}
                                    </span>
                                </Row>
                                <Slider
                                    min={preset.min}
                                    max={preset.max}
                                    step={(preset.max - preset.min) / 200}
                                    value={[current.value]}
                                    onValueChange={(values: number[]) => {
                                        const next = values[0];
                                        if (typeof next === 'number') {
                                            onSetParameter(preset.name, next);
                                        }
                                    }}
                                />
                            </div>
                        );
                    })}
                </Stack>
            </div>
        </Row>
    );
};

type FadeTrianglesProps = {
    region: AdjustmentRegion;
    pixelsPerBeat: number;
    width: number;
    fadePreview: FadePreview | null;
    onFadeDragStart: (e: ReactMouseEvent, kind: 'fadeIn' | 'fadeOut') => void;
};

const FADE_HANDLE_SIZE = 8;

const FadeTriangles = ({
    region,
    pixelsPerBeat,
    width,
    fadePreview,
    onFadeDragStart,
}: FadeTrianglesProps): ReactElement => {
    const liveFade =
        fadePreview && fadePreview.regionId === region.id
            ? { fadeInBeats: fadePreview.fadeInBeats, fadeOutBeats: fadePreview.fadeOutBeats }
            : { fadeInBeats: region.fadeInBeats, fadeOutBeats: region.fadeOutBeats };
    const fadeInPx = Math.max(0, Math.min(width, liveFade.fadeInBeats * pixelsPerBeat));
    const fadeOutPx = Math.max(0, Math.min(width, liveFade.fadeOutBeats * pixelsPerBeat));

    return (
        <>
            {fadeInPx > 0 ? (
                <svg
                    className="pointer-events-none absolute left-0 top-0 h-full"
                    width={fadeInPx}
                    height="100%"
                    viewBox={`0 0 ${fadeInPx} 20`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <polygon points={`0,20 ${fadeInPx},20 ${fadeInPx},0`} fill="rgba(255,255,255,0.18)" />
                </svg>
            ) : null}
            {fadeOutPx > 0 ? (
                <svg
                    className="pointer-events-none absolute top-0 h-full"
                    style={{ right: 0 }}
                    width={fadeOutPx}
                    height="100%"
                    viewBox={`0 0 ${fadeOutPx} 20`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <polygon points={`0,20 ${fadeOutPx},20 0,0`} fill="rgba(255,255,255,0.18)" />
                </svg>
            ) : null}
            <div
                role="slider"
                aria-label="Fade in"
                aria-valuenow={liveFade.fadeInBeats}
                tabIndex={-1}
                className="absolute top-0 cursor-col-resize bg-white/80"
                style={{
                    left: Math.max(0, fadeInPx - FADE_HANDLE_SIZE / 2),
                    width: FADE_HANDLE_SIZE,
                    height: FADE_HANDLE_SIZE,
                    clipPath: 'polygon(0 0, 100% 0, 100% 100%)',
                }}
                onMouseDown={(e) => onFadeDragStart(e, 'fadeIn')}
            />
            <div
                role="slider"
                aria-label="Fade out"
                aria-valuenow={liveFade.fadeOutBeats}
                tabIndex={-1}
                className="absolute top-0 cursor-col-resize bg-white/80"
                style={{
                    right: Math.max(0, fadeOutPx - FADE_HANDLE_SIZE / 2),
                    width: FADE_HANDLE_SIZE,
                    height: FADE_HANDLE_SIZE,
                    clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                }}
                onMouseDown={(e) => onFadeDragStart(e, 'fadeOut')}
            />
        </>
    );
};

type AffectedTracksPickerProps = {
    layer: AdjustmentLayer | null;
    tracks: Array<{ id: string; name: string }>;
    onClose: () => void;
    onChange: (trackIds: string[]) => void;
};

const AffectedTracksPicker = ({ layer, tracks, onClose, onChange }: AffectedTracksPickerProps): ReactElement | null => {
    if (!layer) {
        return null;
    }
    const selected = new Set(layer.affectedTrackIds);

    const toggle = (trackId: string) => {
        const next = new Set(selected);
        if (next.has(trackId)) {
            next.delete(trackId);
        } else {
            next.add(trackId);
        }
        onChange(Array.from(next));
    };

    const clearAll = () => onChange([]);

    return (
        <Row justify="center" className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
            <div
                className="daw-floating-surface w-[320px] rounded-md p-4"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={`Affected tracks for ${layer.name}`}
            >
                <Row justify="between" className="mb-3">
                    <div>
                        <div className="text-xs font-semibold" style={{ color: layer.color }}>
                            {layer.name}
                        </div>
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Affected Tracks</div>
                    </div>
                    <button
                        type="button"
                        className="flex size-5 items-center justify-center rounded-sm hover:bg-white/10"
                        onClick={onClose}
                        aria-label="Close tracks picker"
                    >
                        <X className="size-3" />
                    </button>
                </Row>

                <p className="mb-2 text-[10px] text-muted-foreground">
                    {selected.size === 0
                        ? 'No selection — all tracks at or below the insertion index receive this layer.'
                        : `${String(selected.size)} track${selected.size === 1 ? '' : 's'} selected.`}
                </p>

                <Stack gap={1} className="mb-3 max-h-[260px] overflow-y-auto pr-1">
                    {tracks.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground">No tracks available.</p>
                    ) : (
                        tracks.map((track) => {
                            const active = selected.has(track.id);
                            return (
                                <Row
                                    as="label"
                                    gap={2}
                                    className="cursor-pointer rounded-sm px-2 py-1 text-[11px] hover:bg-white/5"
                                    key={track.id}
                                >
                                    <input
                                        type="checkbox"
                                        checked={active}
                                        onChange={() => toggle(track.id)}
                                        className="accent-[var(--color-accent-orange)]"
                                    />
                                    <span className="truncate">{track.name || track.id}</span>
                                </Row>
                            );
                        })
                    )}
                </Stack>

                <Row justify="between">
                    <button
                        type="button"
                        onClick={clearAll}
                        className="text-[10px] text-muted-foreground hover:text-white/80"
                    >
                        Clear (= all below)
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md bg-white/10 px-2.5 py-1 text-[10px] text-white/80 hover:bg-white/15"
                    >
                        Done
                    </button>
                </Row>
            </div>
        </Row>
    );
};
