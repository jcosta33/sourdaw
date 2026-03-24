import {
    type ReactElement,
    type MouseEvent,
    useState,
    useRef,
    useEffect,
    useSyncExternalStore,
} from 'react';
import { markerStore } from '../../stores/markerStore';
import {
    addSection,
    removeSection,
    renameSection,
    setSectionColor,
    reorderSection,
    moveSection,
    resizeSection,
} from '../../useCases/markerUseCases';
import { type ArrangementSection } from '../../models/Marker';
import { cn } from '#/helpers/Styles/cn';

type ArrangementBarProps = {
    pixelsPerBeat: number;
    scrollX: number;
};

const SECTION_COLORS = [
    'oklch(0.38 0.08 260)',
    'oklch(0.38 0.08 150)',
    'oklch(0.38 0.08 30)',
    'oklch(0.38 0.08 330)',
    'oklch(0.38 0.08 200)',
    'oklch(0.38 0.08 80)',
];

type ContextMenuState =
    | { kind: 'none' }
    | { kind: 'empty'; x: number; y: number; beat: number }
    | { kind: 'section'; x: number; y: number; section: ArrangementSection };

type EditingState = { sectionId: string; name: string } | null;

type DragMode = 'move' | 'resize-left' | 'resize-right';

type DragState = {
    sectionId: string;
    mode: DragMode;
    startClientX: number;
    originalStart: number;
    originalEnd: number;
} | null;

const BAR_HEIGHT = 22;
const EDGE_ZONE = 6; // px from edge to detect resize handle

export const ArrangementBar = ({ pixelsPerBeat, scrollX }: ArrangementBarProps): ReactElement => {
    const markerState = useSyncExternalStore(
        (cb) => markerStore.subscribe(() => cb()),
        () => markerStore.value,
        () => markerStore.value
    );

    const sections = markerState?.sections ?? [];
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: 'none' });
    const [editing, setEditing] = useState<EditingState>(null);
    const [dragPreview, setDragPreview] = useState<{
        sectionId: string;
        startBeat: number;
        endBeat: number;
    } | null>(null);
    const [hoverEdge, setHoverEdge] = useState<{
        sectionId: string;
        edge: 'left' | 'right';
    } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dragRef = useRef<DragState>(null);

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

    const detectEdge = (
        e: MouseEvent,
        section: ArrangementSection
    ): 'left' | 'right' | null => {
        const parentRect = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect();
        const localX = e.clientX - parentRect.left;
        const sectionLeftPx = section.startBeat * pixelsPerBeat - scrollX;
        const sectionRightPx = section.endBeat * pixelsPerBeat - scrollX;

        if (Math.abs(localX - sectionLeftPx) <= EDGE_ZONE) {
            return 'left';
        }
        if (Math.abs(localX - sectionRightPx) <= EDGE_ZONE) {
            return 'right';
        }
        return null;
    };

    const handleSectionMouseDown = (e: MouseEvent, section: ArrangementSection) => {
        if (e.button !== 0 || editing) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        // Detect which part was clicked: edge (resize) or body (move)
        const parentRect = e.currentTarget.parentElement!.getBoundingClientRect();
        const localX = e.clientX - parentRect.left;
        const sectionLeftPx = section.startBeat * pixelsPerBeat - scrollX;
        const sectionRightPx = section.endBeat * pixelsPerBeat - scrollX;

        let mode: DragMode = 'move';
        if (Math.abs(localX - sectionLeftPx) <= EDGE_ZONE) {
            mode = 'resize-left';
        } else if (Math.abs(localX - sectionRightPx) <= EDGE_ZONE) {
            mode = 'resize-right';
        }

        const startX = e.clientX;
        const origStart = section.startBeat;
        const origEnd = section.endBeat;
        let lastStart = origStart;
        let lastEnd = origEnd;

        dragRef.current = {
            sectionId: section.id,
            mode,
            startClientX: startX,
            originalStart: origStart,
            originalEnd: origEnd,
        };

        const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
            const deltaPx = moveEvent.clientX - startX;
            const deltaBeats = deltaPx / pixelsPerBeat;

            if (mode === 'move') {
                const newStart = Math.max(0, Math.round(origStart + deltaBeats));
                const duration = origEnd - origStart;
                lastStart = newStart;
                lastEnd = newStart + duration;
            } else if (mode === 'resize-left') {
                lastStart = Math.max(0, Math.round(origStart + deltaBeats));
                lastEnd = origEnd;
                // Enforce minimum duration
                if (lastEnd - lastStart < 4) {
                    lastStart = lastEnd - 4;
                }
            } else {
                lastStart = origStart;
                lastEnd = Math.max(origStart + 4, Math.round(origEnd + deltaBeats));
            }

            setDragPreview({ sectionId: section.id, startBeat: lastStart, endBeat: lastEnd });
        };

        const handleMouseUp = () => {
            if (mode === 'move' && lastStart !== origStart) {
                moveSection(section.id, lastStart);
            } else if ((mode === 'resize-left' || mode === 'resize-right') && (lastStart !== origStart || lastEnd !== origEnd)) {
                resizeSection(section.id, lastStart, lastEnd);
            }
            dragRef.current = null;
            setDragPreview(null);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleSectionMouseMove = (e: MouseEvent, section: ArrangementSection) => {
        if (dragRef.current) {
            return;
        }
        const edge = detectEdge(e, section);
        if (edge) {
            setHoverEdge({ sectionId: section.id, edge });
        } else if (hoverEdge?.sectionId === section.id) {
            setHoverEdge(null);
        }
    };

    const handleSectionMouseLeave = (section: ArrangementSection) => {
        if (hoverEdge?.sectionId === section.id && !dragRef.current) {
            setHoverEdge(null);
        }
    };

    const handleBarContextMenu = (e: MouseEvent<HTMLDivElement>) => {
        if (dragRef.current) {
            return;
        }
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const beat = (localX + scrollX) / pixelsPerBeat;

        const hitSection = sections.find((s) => {
            const sx = s.startBeat * pixelsPerBeat - scrollX;
            const sw = (s.endBeat - s.startBeat) * pixelsPerBeat;
            return localX >= sx && localX <= sx + sw;
        });

        if (hitSection) {
            setContextMenu({ kind: 'section', x: e.clientX, y: e.clientY, section: hitSection });
        } else {
            setContextMenu({ kind: 'empty', x: e.clientX, y: e.clientY, beat });
        }
    };

    const handleAddSection = () => {
        if (contextMenu.kind !== 'empty') {
            return;
        }
        const name = 'New Section';
        const startBeat = Math.floor(contextMenu.beat);
        const endBeat = startBeat + 16;
        addSection(startBeat, endBeat, name);
        setContextMenu({ kind: 'none' });
    };

    const handleDeleteSection = () => {
        if (contextMenu.kind !== 'section') {
            return;
        }
        removeSection(contextMenu.section.id);
        setContextMenu({ kind: 'none' });
    };

    const handleStartRename = () => {
        if (contextMenu.kind !== 'section') {
            return;
        }
        setEditing({ sectionId: contextMenu.section.id, name: contextMenu.section.name });
        setContextMenu({ kind: 'none' });
    };

    const commitRename = () => {
        if (!editing) {
            return;
        }
        const trimmed = editing.name.trim();
        if (trimmed) {
            renameSection(editing.sectionId, trimmed);
        }
        setEditing(null);
    };

    const getSectionColor = (section: ArrangementSection, index: number): string => {
        if (section.color && section.color !== 'oklch(0.35 0.07 260)') {
            return section.color;
        }
        return SECTION_COLORS[index % SECTION_COLORS.length]!;
    };

    const getCursorForSection = (section: ArrangementSection): string => {
        if (dragRef.current?.sectionId === section.id) {
            const mode = dragRef.current.mode;
            return mode === 'move' ? 'grabbing' : 'col-resize';
        }
        if (hoverEdge?.sectionId === section.id) {
            return 'col-resize';
        }
        return 'grab';
    };

    return (
        <div
            className="relative shrink-0 border-b border-border/40 bg-surface-base overflow-hidden select-none"
            style={{ height: BAR_HEIGHT }}
            onContextMenu={handleBarContextMenu}
            role="region"
            aria-label="Arrangement sections"
        >
            {sections.map((section, i) => {
                const isDragging = dragPreview?.sectionId === section.id;
                const displayStart = isDragging ? dragPreview.startBeat : section.startBeat;
                const displayEnd = isDragging ? dragPreview.endBeat : section.endBeat;
                const left = displayStart * pixelsPerBeat - scrollX;
                const width = (displayEnd - displayStart) * pixelsPerBeat;

                if (left + width < 0 || left > 4000) {
                    return null;
                }

                const color = getSectionColor(section, i);
                const isEditing = editing?.sectionId === section.id;

                return (
                    <div
                        key={section.id}
                        className={cn(
                            'absolute top-0.5 bottom-0.5 rounded-sm flex items-center overflow-hidden',
                            'border border-white/10'
                        )}
                        style={{
                            left: Math.max(0, left),
                            width: left < 0 ? width + left : width,
                            backgroundColor: color,
                            cursor: getCursorForSection(section),
                            opacity: isDragging ? 0.7 : 1,
                            transition: isDragging ? 'none' : undefined,
                        }}
                        title={section.name}
                        onMouseDown={(e) => handleSectionMouseDown(e, section)}
                        onMouseMove={(e) => handleSectionMouseMove(e, section)}
                        onMouseLeave={() => handleSectionMouseLeave(section)}
                        onDoubleClick={() => {
                            setEditing({ sectionId: section.id, name: section.name });
                        }}
                    >
                        {/* Left resize handle visual */}
                        <div
                            className="absolute left-0 top-0 bottom-0 w-[3px] hover:bg-white/20 transition-colors"
                            style={{ cursor: 'col-resize' }}
                        />

                        {isEditing ? (
                            <input
                                ref={inputRef}
                                className="w-full h-full bg-transparent text-[10px] text-white font-medium px-1.5 outline-none"
                                value={editing.name}
                                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                onBlur={commitRename}
                                onMouseDown={(e) => e.stopPropagation()}
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
                            <span className="text-[10px] text-white/90 font-medium px-1.5 truncate">
                                {section.name}
                            </span>
                        )}

                        {/* Right resize handle visual */}
                        <div
                            className="absolute right-0 top-0 bottom-0 w-[3px] hover:bg-white/20 transition-colors"
                            style={{ cursor: 'col-resize' }}
                        />
                    </div>
                );
            })}

            {sections.length === 0 && (
                <div className="flex items-center justify-center h-full">
                    <span className="text-[9px] text-muted-foreground/40">Right-click to add arrangement sections</span>
                </div>
            )}

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
                            onClick={handleAddSection}
                        >
                            Add Section
                        </button>
                    )}
                    {contextMenu.kind === 'section' && (
                        <>
                            <button
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                                onClick={handleStartRename}
                            >
                                Rename
                            </button>
                            <div className="px-2 py-1 text-[10px] text-muted-foreground">Color</div>
                            <div className="flex gap-1 px-2 pb-1">
                                {SECTION_COLORS.map((c) => (
                                    <button
                                        type="button"
                                        key={c}
                                        className="size-3.5 rounded-full border border-white/20 hover:ring-1 hover:ring-foreground/30"
                                        style={{ backgroundColor: c }}
                                        onClick={() => {
                                            setSectionColor(contextMenu.section.id, c);
                                            setContextMenu({ kind: 'none' });
                                        }}
                                        aria-label={`Set color ${c}`}
                                    />
                                ))}
                            </div>
                            <div className="my-0.5 border-t border-border/50" />
                            <button
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none"
                                disabled={sections.indexOf(contextMenu.section) === 0}
                                onClick={() => {
                                    reorderSection(contextMenu.section.id, 'left');
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Move Left
                            </button>
                            <button
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none"
                                disabled={sections.indexOf(contextMenu.section) === sections.length - 1}
                                onClick={() => {
                                    reorderSection(contextMenu.section.id, 'right');
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Move Right
                            </button>
                            <div className="my-0.5 border-t border-border/50" />
                            <button
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                                onClick={handleDeleteSection}
                            >
                                Delete
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
