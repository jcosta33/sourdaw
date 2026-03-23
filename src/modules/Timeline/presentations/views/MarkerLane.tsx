import {
    type ReactElement,
    type MouseEvent,
    useState,
    useRef,
    useEffect,
    useSyncExternalStore,
} from 'react';
import { markerStore } from '../../stores/markerStore';
import { addMarker, removeMarker, renameMarker, setMarkerColor, moveMarker } from '../../useCases/markerUseCases';
import { type Marker } from '../../models/Marker';
import { Flag } from 'lucide-react';

type MarkerLaneProps = {
    pixelsPerBeat: number;
    scrollX: number;
};

const MARKER_COLORS = [
    'oklch(0.40 0.07 200)', // deep teal
    'oklch(0.40 0.08 150)', // deep sage
    'oklch(0.40 0.08 70)',  // deep amber
    'oklch(0.38 0.08 340)', // deep rose
    'oklch(0.38 0.08 270)', // deep indigo
    'oklch(0.38 0.09 20)',  // deep coral
    'oklch(0.40 0.08 250)', // deep blue
];

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

const LANE_HEIGHT = 20;

export const MarkerLane = ({ pixelsPerBeat, scrollX }: MarkerLaneProps): ReactElement => {
    const markerState = useSyncExternalStore(
        (cb) => markerStore.subscribe(() => cb()),
        () => markerStore.value,
        () => markerStore.value
    );

    const markers = markerState?.markers ?? [];
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: 'none' });
    const [editing, setEditing] = useState<EditingState>(null);
    const [dragPreview, setDragPreview] = useState<{ markerId: string; beat: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dragRef = useRef<DragState>(null);
    const laneRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

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

    // Compute final beat on mouseup by reading the last mousemove position
    // We use a ref-based approach for the final commit to avoid stale closure
    const handleMarkerDragStartStable = (e: MouseEvent, marker: Marker) => {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
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

        const handleMouseUp = () => {
            if (lastBeat !== originalBeat) {
                moveMarker(marker.id, lastBeat);
            }
            dragRef.current = null;
            setDragPreview(null);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleLaneContextMenu = (e: MouseEvent<HTMLDivElement>) => {
        if (dragRef.current) {
            return;
        }
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const clickBeat = (localX + scrollX) / pixelsPerBeat;

        // Find if clicked near an existing marker (within ~10 pixels)
        const hitMarker = markers.find((m) => {
            const mx = m.beat * pixelsPerBeat - scrollX;
            return Math.abs(localX - mx) < 10;
        });

        if (hitMarker) {
            setContextMenu({ kind: 'marker', x: e.clientX, y: e.clientY, marker: hitMarker });
        } else {
            setContextMenu({ kind: 'empty', x: e.clientX, y: e.clientY, beat: clickBeat });
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
        <div
            ref={laneRef}
            className="relative shrink-0 border-b border-border/40 bg-surface-base/50 overflow-hidden select-none"
            style={{ height: LANE_HEIGHT }}
            onContextMenu={handleLaneContextMenu}
            role="region"
            aria-label="Timeline markers"
        >
            {markers.map((marker) => {
                const isDragging = dragPreview?.markerId === marker.id;
                const displayBeat = isDragging ? dragPreview.beat : marker.beat;
                const left = displayBeat * pixelsPerBeat - scrollX;
                if (left < -50 || left > 4000) {
                    return null;
                }

                const isEditing = editing?.markerId === marker.id;

                return (
                    <div
                        key={marker.id}
                        className="absolute top-0 bottom-0 flex items-center gap-1 group"
                        style={{
                            left: Math.max(0, left),
                            opacity: isDragging ? 0.7 : 1,
                            transition: isDragging ? 'none' : 'left 0.1s ease-out',
                        }}
                        title={marker.name}
                        onDoubleClick={() => setEditing({ markerId: marker.id, name: marker.name })}
                    >
                        <div
                            className="flex flex-col h-full w-[2px] cursor-ew-resize hover:w-[4px] hover:-ml-[1px] transition-all"
                            style={{ backgroundColor: marker.color }}
                            onMouseDown={(e) => handleMarkerDragStartStable(e, marker)}
                        />
                        <div
                            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 cursor-grab active:cursor-grabbing hover:bg-white/10"
                            style={{ backgroundColor: `${marker.color}33`, color: marker.color }}
                            onMouseDown={(e) => handleMarkerDragStartStable(e, marker)}
                        >
                            <Flag className="size-2.5" />
                            {isEditing ? (
                                <input
                                    ref={inputRef}
                                    className="h-3 bg-transparent text-[9px] font-medium outline-none min-w-[60px]"
                                    value={editing.name}
                                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                    onBlur={commitRename}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            commitRename();
                                        }
                                        if (e.key === 'Escape') {
                                            setEditing(null);
                                        }
                                    }}
                                />
                            ) : (
                                <span className="text-[9px] font-medium truncate max-w-[120px]">{marker.name}</span>
                            )}
                        </div>
                    </div>
                );
            })}

            {contextMenu.kind !== 'none' && (
                <div
                    ref={menuRef}
                    className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    {contextMenu.kind === 'empty' && (
                        <button
                            type="button"
                            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                            onClick={handleAddMarker}
                        >
                            Add Marker at Beat {Math.floor(contextMenu.beat)}
                        </button>
                    )}
                    {contextMenu.kind === 'marker' && (
                        <>
                            <button
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                                onClick={handleStartRename}
                            >
                                Rename Marker
                            </button>
                            <div className="px-2 py-1 text-[10px] text-muted-foreground">Color</div>
                            <div className="flex gap-1 px-2 pb-1">
                                {MARKER_COLORS.map((c) => (
                                    <button
                                        type="button"
                                        key={c}
                                        className="size-3.5 rounded-full border border-white/20 hover:ring-1 hover:ring-foreground/30"
                                        style={{ backgroundColor: c }}
                                        onClick={() => {
                                            setMarkerColor(contextMenu.marker.id, c);
                                            setContextMenu({ kind: 'none' });
                                        }}
                                        aria-label={`Set color ${c}`}
                                    />
                                ))}
                            </div>
                            <div className="my-0.5 border-t border-border/50" />
                            <button
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                                onClick={handleDeleteMarker}
                            >
                                Delete Marker
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
