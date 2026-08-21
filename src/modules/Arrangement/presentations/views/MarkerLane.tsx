import { type ReactElement, type MouseEvent, useState, useRef, useEffect, useLayoutEffect } from 'react';

import { Flag } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { Row, Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';

import { MARKER_COLOR_PRESETS as MARKER_COLORS } from '../../models/ColorPalette';
import { type Marker } from '../../models/Marker';
import { markerStore, type MarkerStoreState } from '../../stores/markerStore';
import { addMarker } from '../../useCases/marker/markerOperations/addMarker';
import { moveMarker } from '../../useCases/marker/markerOperations/moveMarker';
import { removeMarker } from '../../useCases/marker/markerOperations/removeMarker';
import { renameMarker } from '../../useCases/marker/markerOperations/renameMarker';
import { setMarkerColor } from '../../useCases/marker/markerOperations/setMarkerColor';

import { TimelineChromeSurface } from './TimelineChromeSurface';

type MarkerLaneProps = {
    pixelsPerBeat: number;
    scrollX: number;
};

type ContextMenuState =
    | { kind: 'none' }
    | { kind: 'empty'; x: number; y: number; beat: number }
    | { kind: 'marker'; x: number; y: number; marker: Marker };

type EditingState = { markerId: string; name: string } | null;

type DragState = {
    markerId: string;
    startClientX: number;
    originalBeat: number;
} | null;

export const MARKER_LANE_HEIGHT = 20;

const defaultMarkerState: MarkerStoreState = { markers: [], sections: [] };

export const MarkerLane = ({ pixelsPerBeat, scrollX }: MarkerLaneProps): ReactElement => {
    const markerState = useStore(markerStore, defaultMarkerState);

    const markers = markerState.markers;
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: 'none' });
    const [editing, setEditing] = useState<EditingState>(null);
    const [dragPreview, setDragPreview] = useState<{ markerId: string; beat: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dragRef = useRef<DragState>(null);
    const laneRef = useRef<HTMLDivElement>(null);
    // Holds the teardown for the in-flight drag's global listeners so an unmount
    // mid-drag can detach them; null when no drag is active.
    const dragCleanupRef = useRef<(() => void) | null>(null);
    const [laneWidth, setLaneWidth] = useState(0);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    // Detach any global drag listeners still attached when the lane unmounts.
    useEffect(() => {
        return () => {
            dragCleanupRef.current?.();
            dragCleanupRef.current = null;
        };
    }, []);

    useLayoutEffect(() => {
        const lane = laneRef.current;
        if (!lane) {
            return undefined;
        }
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setLaneWidth(entry.contentRect.width);
            }
        });
        observer.observe(lane);
        setLaneWidth(lane.getBoundingClientRect().width);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (contextMenu.kind === 'none') {
            return undefined;
        }
        const handleClick = (event: globalThis.MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setContextMenu({ kind: 'none' });
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [contextMenu.kind]);

    // Compute final beat on mouseup by reading the last mousemove position
    // We use a ref-based approach for the final commit to avoid stale closure
    const handleMarkerDragStartStable = (event: MouseEvent, marker: Marker) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const originalBeat = marker.beat;
        let lastBeat = originalBeat;

        dragRef.current = {
            markerId: marker.id,
            startClientX: startX,
            originalBeat,
        };

        const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
            const deltaPx = moveEvent.clientX - startX;
            const deltaBeats = deltaPx / pixelsPerBeat;
            lastBeat = Math.max(0, Math.round(originalBeat + deltaBeats));
            setDragPreview({ markerId: marker.id, beat: lastBeat });
        };

        const detachListeners = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        const handleMouseUp = () => {
            if (lastBeat !== originalBeat) {
                moveMarker(marker.id, lastBeat);
            }
            dragRef.current = null;
            setDragPreview(null);
            detachListeners();
            dragCleanupRef.current = null;
        };

        dragCleanupRef.current = detachListeners;
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleLaneContextMenu = (event: MouseEvent<HTMLDivElement>) => {
        if (dragRef.current) {
            return;
        }
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const clickBeat = (localX + scrollX) / pixelsPerBeat;

        // Find if clicked near an existing marker (within ~10 pixels)
        const hitMarker = markers.find((message) => {
            const mx = message.beat * pixelsPerBeat - scrollX;
            return Math.abs(localX - mx) < 10;
        });

        if (hitMarker) {
            setContextMenu({ kind: 'marker', x: event.clientX, y: event.clientY, marker: hitMarker });
        } else {
            setContextMenu({ kind: 'empty', x: event.clientX, y: event.clientY, beat: clickBeat });
        }
    };

    const handleAddMarker = () => {
        if (contextMenu.kind !== 'empty') {
            return;
        }

        const beat = Math.floor(contextMenu.beat); // Snap to beat
        addMarker(beat, 'New Marker');
        setContextMenu({ kind: 'none' });
    };

    const handleDeleteMarker = () => {
        if (contextMenu.kind !== 'marker') {
            return;
        }
        removeMarker(contextMenu.marker.id);
        setContextMenu({ kind: 'none' });
    };

    const handleStartRename = () => {
        if (contextMenu.kind !== 'marker') {
            return;
        }
        setEditing({ markerId: contextMenu.marker.id, name: contextMenu.marker.name });
        setContextMenu({ kind: 'none' });
    };

    const commitRename = () => {
        if (!editing) {
            return;
        }
        const trimmed = editing.name.trim();
        if (trimmed) {
            renameMarker(editing.markerId, trimmed);
        }
        setEditing(null);
    };

    return (
        <TimelineChromeSurface
            ref={laneRef}
            className="select-none"
            style={{
                height: MARKER_LANE_HEIGHT,
            }}
            onContextMenu={handleLaneContextMenu}
            role="region"
            aria-label="Timeline markers"
        >
            {markers.map((marker) => {
                const isDragging = dragPreview?.markerId === marker.id;
                const displayBeat = isDragging ? dragPreview.beat : marker.beat;
                const left = displayBeat * pixelsPerBeat - scrollX;
                // Cull markers outside the lane's actual width; fall back to a
                // permissive bound until the lane has been measured.
                const rightBound = laneWidth > 0 ? laneWidth + 50 : Infinity;
                if (left < -50 || left > rightBound) {
                    return null;
                }

                const isEditing = editing?.markerId === marker.id;

                return (
                    <Row
                        gap={1}
                        className="absolute top-0 bottom-0 group"
                        key={marker.id}
                        style={{
                            left: Math.max(0, left),
                            opacity: isDragging ? 0.7 : 1,
                            transition: isDragging ? 'none' : 'left 0.1s ease-out',
                        }}
                        title={marker.name}
                        onDoubleClick={() => setEditing({ markerId: marker.id, name: marker.name })}
                    >
                        <Stack
                            className="h-full w-[2px] cursor-ew-resize hover:w-[4px] hover:-ml-[1px] transition-all"
                            style={{ backgroundColor: marker.color }}
                            onMouseDown={(event) => handleMarkerDragStartStable(event, marker)}
                        >
                            {null}
                        </Stack>
                        <Row
                            gap={1}
                            className="rounded-sm px-1.5 py-0.5 cursor-grab active:cursor-grabbing hover:bg-white/10"
                            style={{ backgroundColor: `${marker.color}33`, color: marker.color }}
                            onMouseDown={(event) => handleMarkerDragStartStable(event, marker)}
                        >
                            <Flag className="size-2.5" />
                            {isEditing ? (
                                <DawCompactInput
                                    ref={inputRef}
                                    size="micro"
                                    className="h-3 min-w-[60px] border-0 bg-transparent px-0 text-[9px] font-medium text-current shadow-none focus-visible:ring-0"
                                    value={editing.name}
                                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                                    onBlur={commitRename}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            commitRename();
                                        }
                                        if (event.key === 'Escape') {
                                            setEditing(null);
                                        }
                                    }}
                                />
                            ) : (
                                <span className="text-[9px] font-medium truncate max-w-[120px]">{marker.name}</span>
                            )}
                        </Row>
                    </Row>
                );
            })}
            {contextMenu.kind !== 'none' ? (
                <div
                    ref={menuRef}
                    className="daw-floating-surface fixed z-50 min-w-[140px] rounded-md p-1"
                    style={{
                        left: contextMenu.x,
                        top: contextMenu.y,
                    }}
                >
                    {contextMenu.kind === 'empty' ? (
                        <DawMenuButton onClick={handleAddMarker}>
                            Add Marker at Beat {Math.floor(contextMenu.beat)}
                        </DawMenuButton>
                    ) : null}
                    {contextMenu.kind === 'marker' ? (
                        <>
                            <DawMenuButton onClick={handleStartRename}>Rename Marker</DawMenuButton>
                            <DawMenuMutedRow className="px-2">Color</DawMenuMutedRow>
                            <Row align="stretch" gap={1} className="px-2 pb-1">
                                {MARKER_COLORS.map((context) => (
                                    <DawSwatchButton
                                        key={context}
                                        color={context}
                                        onClick={() => {
                                            setMarkerColor(contextMenu.marker.id, context);
                                            setContextMenu({ kind: 'none' });
                                        }}
                                        aria-label={`Set color ${context}`}
                                    />
                                ))}
                            </Row>
                            <DawMenuSeparator className="mx-1 my-0.5 border-border/50" />
                            <DawMenuButton tone="danger" onClick={handleDeleteMarker}>
                                Delete Marker
                            </DawMenuButton>
                        </>
                    ) : null}
                </div>
            ) : null}
        </TimelineChromeSurface>
    );
};
