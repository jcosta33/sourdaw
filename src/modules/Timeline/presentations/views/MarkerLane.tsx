import {
    type ReactElement,
    type MouseEvent as ReactMouseEvent,
    useState,
    useRef,
    useEffect,
    useSyncExternalStore,
} from 'react';
import { markerStore } from '../../stores/markerStore';
import { addMarker, removeMarker, renameMarker, setMarkerColor } from '../../useCases/markerUseCases';
import { type Marker } from '../../models/Marker';
import { Flag } from 'lucide-react';

type MarkerLaneProps = {
    pixelsPerBeat: number;
    scrollX: number;
};

const MARKER_COLORS = [
    'oklch(0.58 0.08 200)', // slate teal
    'oklch(0.58 0.09 150)', // sage green
    'oklch(0.58 0.09 70)',  // dusty amber
    'oklch(0.55 0.09 340)', // dusty rose
    'oklch(0.55 0.09 270)', // muted indigo
    'oklch(0.55 0.10 20)',  // muted coral
    'oklch(0.58 0.09 250)', // steel blue
];

type ContextMenuState =
    | { kind: 'none' }
    | { kind: 'empty'; x: number; y: number; beat: number }
    | { kind: 'marker'; x: number; y: number; marker: Marker };

type EditingState = { markerId: string; name: string } | null;

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
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

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
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu({ kind: 'none' });
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [contextMenu.kind]);

    const handleLaneContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
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
            className="relative shrink-0 border-b border-border/40 bg-surface-base/50 overflow-hidden select-none"
            style={{ height: LANE_HEIGHT }}
            onContextMenu={handleLaneContextMenu}
            role="region"
            aria-label="Timeline markers"
        >
            {markers.map((marker) => {
                const left = marker.beat * pixelsPerBeat - scrollX;
                if (left < -50 || left > 4000) {
                    return null;
                }

                const isEditing = editing?.markerId === marker.id;

                return (
                    <div
                        key={marker.id}
                        className="absolute top-0 bottom-0 flex items-center gap-1 group"
                        style={{ left: Math.max(0, left) }}
                        title={marker.name}
                        onDoubleClick={() => setEditing({ markerId: marker.id, name: marker.name })}
                    >
                        <div
                            className="flex flex-col h-full w-[2px] cursor-ew-resize hover:w-[4px] hover:-ml-[1px] transition-all"
                            style={{ backgroundColor: marker.color }}
                        />
                        <div
                            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-white/90 cursor-default hover:bg-white/10"
                            style={{ backgroundColor: `${marker.color}33`, color: marker.color }}
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
