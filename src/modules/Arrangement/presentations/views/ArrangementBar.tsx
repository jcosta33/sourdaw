import { type ReactElement, type MouseEvent, useState, useRef, useEffect } from 'react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { useStore } from '#/infra/store/useStore';
import { cn } from '#/utils/Styles/cn';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { SECTION_COLORS } from '../../models/colorPalette';
import { type ArrangementSection } from '../../models/Marker';
import { markerStore, type MarkerStoreState } from '../../stores/markerStore';
import { addSection } from '../../useCases/marker/sectionOperations/addSection';
import { moveSection } from '../../useCases/marker/sectionOperations/moveSection';
import { removeSection } from '../../useCases/marker/sectionOperations/removeSection';
import { renameSection } from '../../useCases/marker/sectionOperations/renameSection';
import { reorderSection } from '../../useCases/marker/sectionOperations/reorderSection';
import { resizeSection } from '../../useCases/marker/sectionOperations/resizeSection';
import { setSectionColor } from '../../useCases/marker/sectionOperations/setSectionColor';

import { TimelineChromeSurface } from './TimelineChromeSurface';

type ArrangementBarProps = {
    pixelsPerBeat: number;
    scrollX: number;
};

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

const defaultMarkerState: MarkerStoreState = { markers: [], sections: [] };

export const ArrangementBar = ({ pixelsPerBeat, scrollX }: ArrangementBarProps): ReactElement => {
    const markerState = useStore(markerStore, defaultMarkerState);

    const sections = markerState.sections;
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

    useContextMenuDismiss(menuRef, () => setContextMenu({ kind: 'none' }));

    const detectEdge = (e: MouseEvent, section: ArrangementSection): 'left' | 'right' | null => {
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
        const edge = detectEdge(e, section);
        const mode: DragMode = edge === 'left' ? 'resize-left' : edge === 'right' ? 'resize-right' : 'move';

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
            } else if (
                (mode === 'resize-left' || mode === 'resize-right') &&
                (lastStart !== origStart || lastEnd !== origEnd)
            ) {
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
        if (section.color) {
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
        <TimelineChromeSurface
            className="select-none"
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
                            <DawCompactInput
                                ref={inputRef}
                                size="micro"
                                className="h-full w-full border-0 bg-transparent px-1.5 text-[10px] font-medium text-white shadow-none focus-visible:ring-0"
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

            {sections.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                    <DawInlineHint>Right-click to add arrangement sections</DawInlineHint>
                </div>
            ) : null}

            {contextMenu.kind !== 'none' ? (
                <div
                    ref={menuRef}
                    className="daw-floating-surface fixed z-50 min-w-[140px] rounded-md p-1"
                    style={{
                        left: contextMenu.x,
                        top: contextMenu.y,
                    }}
                >
                    {contextMenu.kind === 'empty' && (
                        <DawMenuButton onClick={handleAddSection}>Add Section</DawMenuButton>
                    )}
                    {contextMenu.kind === 'section' && (
                        <>
                            <DawMenuButton onClick={handleStartRename}>Rename</DawMenuButton>
                            <DawMenuMutedRow className="px-2">Color</DawMenuMutedRow>
                            <div className="flex gap-1 px-2 pb-1">
                                {SECTION_COLORS.map((c) => (
                                    <DawSwatchButton
                                        key={c}
                                        color={c}
                                        onClick={() => {
                                            setSectionColor(contextMenu.section.id, c);
                                            setContextMenu({ kind: 'none' });
                                        }}
                                        aria-label={`Set color ${c}`}
                                    />
                                ))}
                            </div>
                            <DawMenuSeparator className="mx-1 my-0.5 border-border/50" />
                            <DawMenuButton
                                disabled={sections.indexOf(contextMenu.section) === 0}
                                onClick={() => {
                                    reorderSection(contextMenu.section.id, 'left');
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Move Left
                            </DawMenuButton>
                            <DawMenuButton
                                disabled={sections.indexOf(contextMenu.section) === sections.length - 1}
                                onClick={() => {
                                    reorderSection(contextMenu.section.id, 'right');
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Move Right
                            </DawMenuButton>
                            <DawMenuSeparator className="mx-1 my-0.5 border-border/50" />
                            <DawMenuButton tone="danger" onClick={handleDeleteSection}>
                                Delete
                            </DawMenuButton>
                        </>
                    )}
                </div>
            ) : null}
        </TimelineChromeSurface>
    );
};
