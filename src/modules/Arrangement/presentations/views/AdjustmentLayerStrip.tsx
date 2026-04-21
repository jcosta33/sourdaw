import { type ReactElement, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';

import { Layers, Plus, Power, Trash2, X } from 'lucide-react';

import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
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
    | { kind: 'resizeStart'; regionId: string; layerId: string; startClientX: number; origStart: number; origEnd: number }
    | { kind: 'resizeEnd'; regionId: string; layerId: string; startClientX: number; origStart: number; origEnd: number }
    | null;

const ROW_HEIGHT = 20;
const MIN_DRAG_PX = 3;

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
    const layers = state.layers;

    const [contextMenu, setContextMenu] = useState<LayerContextMenu>({ kind: 'none' });
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [inspector, setInspector] = useState<InspectorState>(null);
    const [dragPreview, setDragPreview] = useState<{ regionId: string; startBeat: number; endBeat: number } | null>(null);
    const dragStateRef = useRef<DragState>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const addMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (contextMenu.kind === 'none') {
            return;
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
            return;
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
            setDragPreview({ regionId: region.id, startBeat: nextStart, endBeat: nextEnd });
        };

        const handleUp = () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
            const finalPreview = previewRef.current;
            dragStateRef.current = null;
            if (finalPreview) {
                executeAppAction({
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

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
    };

    const previewRef = useRef<{ regionId: string; startBeat: number; endBeat: number } | null>(null);
    useEffect(() => {
        previewRef.current = dragPreview;
    }, [dragPreview]);

    const openAddMenu = () => setAddMenuOpen((prev) => !prev);

    const createLayer = (effectType: AdjustmentEffectType) => {
        const label = `${effectType.charAt(0).toUpperCase()}${effectType.slice(1)} Layer`;
        executeAppAction({
            type: 'createAdjustmentLayer',
            payload: { name: label, effectType },
        });
        setAddMenuOpen(false);
    };

    const toggleLayer = (layerId: string) => {
        executeAppAction({ type: 'toggleAdjustmentLayer', payload: { layerId } });
    };

    const removeLayer = (layerId: string) => {
        executeAppAction({ type: 'removeAdjustmentLayer', payload: { layerId } });
    };

    const removeRegion = (layerId: string, regionId: string) => {
        executeAppAction({ type: 'removeAdjustmentRegion', payload: { layerId, regionId } });
    };

    const setLayerMix = (layerId: string, mix: number) => {
        executeAppAction({ type: 'setLayerMix', payload: { layerId, mix } });
    };

    const setLayerParameter = (layerId: string, paramName: string, value: number) => {
        executeAppAction({ type: 'setLayerParameter', payload: { layerId, paramName, value } });
    };

    const addRegionAtBeat = (layerId: string, beat: number) => {
        const start = Math.max(0, Math.floor(beat));
        executeAppAction({
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

    const inspectorLayer = inspector ? layers.find((l) => l.id === inspector.layerId) ?? null : null;

    return (
        <TimelineChromeSurface
            className="select-none"
            style={{ height: rowsHeight + ROW_HEIGHT }}
            role="region"
            aria-label="Adjustment layers"
        >
            <div className="flex items-center justify-between border-b border-border/30 px-2" style={{ height: ROW_HEIGHT }}>
                <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Layers className="size-2.5" />
                    Adjustment Layers
                </div>
                <button
                    type="button"
                    className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-white/10"
                    onClick={openAddMenu}
                    aria-label="Add adjustment layer"
                >
                    <Plus className="size-3" />
                </button>
            </div>

            {layers.map((layer, idx) => {
                const yOffset = ROW_HEIGHT + idx * ROW_HEIGHT;
                return (
                    <AdjustmentLayerRow
                        key={layer.id}
                        layer={layer}
                        yOffset={yOffset}
                        pixelsPerBeat={pixelsPerBeat}
                        scrollX={scrollX}
                        dragPreview={dragPreview}
                        onLaneClick={handleLaneClick}
                        onLayerContextMenu={handleLayerContextMenu}
                        onRegionContextMenu={handleRegionContextMenu}
                        onRegionDoubleClick={handleRegionDoubleClick}
                        onRegionDragStart={startRegionDrag}
                        onToggleEnabled={() => toggleLayer(layer.id)}
                        onRemoveLayer={() => removeLayer(layer.id)}
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
                                Region: {contextMenu.region.startBeat.toFixed(1)}–{contextMenu.region.endBeat.toFixed(1)}
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
        </TimelineChromeSurface>
    );
};

type AdjustmentLayerRowProps = {
    layer: AdjustmentLayer;
    yOffset: number;
    pixelsPerBeat: number;
    scrollX: number;
    dragPreview: { regionId: string; startBeat: number; endBeat: number } | null;
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
    onToggleEnabled: () => void;
    onRemoveLayer: () => void;
};

const AdjustmentLayerRow = ({
    layer,
    yOffset,
    pixelsPerBeat,
    scrollX,
    dragPreview,
    onLaneClick,
    onLayerContextMenu,
    onRegionContextMenu,
    onRegionDoubleClick,
    onRegionDragStart,
    onToggleEnabled,
    onRemoveLayer,
}: AdjustmentLayerRowProps): ReactElement => {
    const regions = layer.regions.length > 0 ? layer.regions : DEFAULT_FULL_RANGE_REGION;

    return (
        <div
            className={cn('absolute left-0 right-0 border-b border-border/20', layer.enabled ? '' : 'opacity-40')}
            style={{ top: yOffset, height: ROW_HEIGHT }}
            onClick={(e) => onLaneClick(e, layer)}
            onContextMenu={(e) => onLayerContextMenu(e, layer)}
        >
            <div
                className="absolute left-0 top-0 z-10 flex items-center gap-1 border-r border-border/40 px-1 py-0.5"
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
                    title="Remove layer"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemoveLayer();
                    }}
                >
                    <X className="size-2.5" />
                </button>
            </div>
            {regions.map((region) => {
                const liveRegion =
                    dragPreview && dragPreview.regionId === region.id && region !== EMPTY_RANGE_SENTINEL
                        ? { startBeat: dragPreview.startBeat, endBeat: dragPreview.endBeat }
                        : { startBeat: region.startBeat, endBeat: region.endBeat };
                const left = liveRegion.startBeat * pixelsPerBeat - scrollX;
                const width = (liveRegion.endBeat - liveRegion.startBeat) * pixelsPerBeat;
                if (left + width < 100 || left > 4000) {
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
                        onMouseDown={(e) =>
                            isSentinel ? undefined : onRegionDragStart(e, layer, region as AdjustmentRegion, 'move')
                        }
                        onContextMenu={(e) =>
                            isSentinel ? undefined : onRegionContextMenu(e, layer, region as AdjustmentRegion)
                        }
                        onDoubleClick={(e) => onRegionDoubleClick(e, layer)}
                    >
                        {isSentinel ? null : (
                            <>
                                <div
                                    className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize bg-white/40"
                                    onMouseDown={(e) =>
                                        onRegionDragStart(e, layer, region as AdjustmentRegion, 'resizeStart')
                                    }
                                />
                                <div
                                    className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize bg-white/40"
                                    onMouseDown={(e) =>
                                        onRegionDragStart(e, layer, region as AdjustmentRegion, 'resizeEnd')
                                    }
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
const EMPTY_RANGE_SENTINEL: AdjustmentRegion = {
    id: '__sentinel__',
    startBeat: 0,
    endBeat: 200,
    blend: 1,
    fadeInBeats: 0,
    fadeOutBeats: 0,
};
const DEFAULT_FULL_RANGE_REGION: AdjustmentRegion[] = [EMPTY_RANGE_SENTINEL];

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div
                className="daw-floating-surface w-[380px] rounded-md p-4"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={`Adjustment Layer: ${layer.name}`}
            >
                <div className="mb-3 flex items-center justify-between">
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
                </div>

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

                <div className="space-y-2">
                    {presetParams.map((preset) => {
                        const current = paramByName.get(preset.name) ?? preset;
                        return (
                            <div key={preset.name}>
                                <div className="mb-1 flex items-center justify-between text-[10px]">
                                    <span className="font-medium">{preset.name}</span>
                                    <span className="text-muted-foreground">
                                        {current.value.toFixed(2)}
                                        {preset.unit}
                                    </span>
                                </div>
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
                </div>
            </div>
        </div>
    );
};
