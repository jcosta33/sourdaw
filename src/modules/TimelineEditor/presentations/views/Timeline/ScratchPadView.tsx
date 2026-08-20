/**
 * ScratchPadView — collapsible arrangement scratch pad.
 *
 * A Studio One–style alternative arrangement workspace displayed below
 * the main timeline. Users can capture the current arrangement, reorder
 * sections freely, and commit back when ready.
 *
 * Follows the same deep-black metallic theme as ArrangementBar/MarkerLane
 * with oklch colors, border-white/10, and consistent context menus.
 */

import { type ReactElement, type MouseEvent, useState, useRef, useEffect } from 'react';

import { Copy, ArrowUpFromLine, Trash2, ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { Row, Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { scratchPadStore } from '#/modules/Arrangement/stores';
import {
    removeScratchPadSection,
    renameScratchPadSection,
    setScratchPadSectionColor,
    reorderScratchPadSection,
    clearScratchPad,
    captureArrangementToScratchPad,
    commitScratchPadToArrangement,
} from '#/modules/Arrangement/useCases';
import { cn } from '#/utils/Styles/cn';

type ScratchPadSectionView = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
    color: string;
    order: number;
};

type ScratchPadViewState = {
    sections: ScratchPadSectionView[];
};

const defaultState: ScratchPadViewState = { sections: [] };

const SECTION_COLORS = [
    'oklch(0.40 0.08 260)',
    'oklch(0.40 0.08 150)',
    'oklch(0.40 0.08 30)',
    'oklch(0.40 0.08 330)',
    'oklch(0.40 0.08 200)',
    'oklch(0.40 0.08 80)',
];

type ContextMenuState = { kind: 'none' } | { kind: 'section'; x: number; y: number; section: ScratchPadSectionView };

type EditingState = { sectionId: string; name: string } | null;

type ScratchPadViewProps = {
    height: number;
    onToggle: () => void;
};

export const ScratchPadView = ({ height, onToggle }: ScratchPadViewProps): ReactElement => {
    const state = useStore<ScratchPadViewState>(scratchPadStore, defaultState);

    const sections = [...state.sections].sort((alpha, b) => alpha.order - b.order);

    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: 'none' });
    const [editing, setEditing] = useState<EditingState>(null);
    const [collapsed, setCollapsed] = useState(false);
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
            return () => {};
        }
        const handleClick = (event: globalThis.MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setContextMenu({ kind: 'none' });
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [contextMenu.kind]);

    const handleContextMenu = (event: MouseEvent, section: ScratchPadSectionView): void => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ kind: 'section', x: event.clientX, y: event.clientY, section });
    };

    const commitRename = (): void => {
        if (!editing) {
            return;
        }
        const trimmed = editing.name.trim();
        if (trimmed) {
            renameScratchPadSection(editing.sectionId, trimmed);
        }
        setEditing(null);
    };

    const effectiveHeight = collapsed ? 30 : height;

    return (
        <Stack
            className="relative border-t border-border/40 bg-surface-base/80 select-none overflow-hidden"
            style={{ height: effectiveHeight, minHeight: 30 }}
        >
            {/* ── Header strip ── */}
            <Row gap={1.5} shrink={false} className="px-2 h-[30px] bg-surface-base border-b border-border/30">
                <GripHorizontal className="size-3 text-muted-foreground/30" aria-hidden="true" />
                <span className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">
                    Scratch Pad
                </span>
                <div className="flex-1" />

                {/* Capture current arrangement */}
                <button
                    type="button"
                    className="h-5 px-1.5 rounded flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/5 transition-colors"
                    title="Capture current arrangement"
                    onClick={() => captureArrangementToScratchPad()}
                >
                    <Copy className="size-2.5" />
                    <span>Capture</span>
                </button>

                {/* Commit to arrangement */}
                {sections.length > 0 ? (
                    <button
                        type="button"
                        className="h-5 px-1.5 rounded flex items-center gap-1 text-[9px] text-[var(--color-accent-peach)]/70 hover:text-[var(--color-accent-peach)] hover:bg-[var(--color-accent-peach)]/10 transition-colors"
                        title="Apply scratch pad to main arrangement"
                        onClick={() => commitScratchPadToArrangement()}
                    >
                        <ArrowUpFromLine className="size-2.5" />
                        <span>Apply</span>
                    </button>
                ) : null}

                {/* Clear */}
                {sections.length > 0 ? (
                    <button
                        type="button"
                        className="size-5 rounded flex items-center justify-center text-muted-foreground/30 hover:text-destructive/70 hover:bg-destructive/5 transition-colors"
                        aria-label="Clear scratch pad"
                        title="Clear scratch pad"
                        onClick={() => clearScratchPad()}
                    >
                        <Trash2 className="size-2.5" />
                    </button>
                ) : null}

                {/* Collapse toggle */}
                <button
                    type="button"
                    className="size-5 rounded flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-white/5 transition-colors"
                    aria-label={collapsed ? 'Expand scratch pad' : 'Collapse scratch pad'}
                    onClick={() => setCollapsed(!collapsed)}
                >
                    {collapsed ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>

                {/* Close */}
                <button
                    type="button"
                    className="size-5 rounded flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground/50 hover:bg-white/5 transition-colors text-[10px] font-bold"
                    aria-label="Close scratch pad"
                    onClick={onToggle}
                >
                    ✕
                </button>
            </Row>
            {/* ── Sections area ── */}
            {!collapsed ? (
                <div className="flex-1 overflow-x-auto overflow-y-hidden px-2 py-1.5">
                    {sections.length === 0 ? (
                        <Row justify="center" className="h-full">
                            <DawInlineHint>
                                Click "Capture" to snapshot the current arrangement · Drag to reorder
                            </DawInlineHint>
                        </Row>
                    ) : (
                        <Row align="stretch" gap={1} className="h-full">
                            {sections.map((section, index) => {
                                const color =
                                    section.color && section.color !== 'oklch(0.5 0.1 260)'
                                        ? section.color
                                        : SECTION_COLORS[index % SECTION_COLORS.length]!;
                                const isEditing = editing?.sectionId === section.id;
                                const duration = section.endBeat - section.startBeat;

                                return (
                                    <Stack
                                        key={section.id}
                                        justify="center"
                                        className={cn(
                                            'relative rounded-[3px] cursor-default',
                                            'border border-white/10 hover:border-white/20 transition-all',
                                            'shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
                                            'min-w-[64px] px-2 py-1'
                                        )}
                                        style={{
                                            backgroundColor: color,
                                            flex: `${duration} 0 0`,
                                        }}
                                        onContextMenu={(event) => handleContextMenu(event, section)}
                                        onDoubleClick={() => setEditing({ sectionId: section.id, name: section.name })}
                                        title={`${section.name} — ${duration} beats`}
                                    >
                                        {isEditing ? (
                                            <DawCompactInput
                                                ref={inputRef}
                                                size="micro"
                                                className="w-full border-0 bg-transparent px-0 text-[10px] font-semibold text-white shadow-none focus-visible:ring-0"
                                                value={editing.name}
                                                onChange={(event) =>
                                                    setEditing({ ...editing, name: event.target.value })
                                                }
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
                                            <span className="text-[10px] font-semibold text-white/90 truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                                                {section.name}
                                            </span>
                                        )}
                                        <span className="text-[8px] text-white/40 mt-0.5">{duration} beats</span>
                                    </Stack>
                                );
                            })}
                        </Row>
                    )}
                </div>
            ) : null}
            {/* ── Context menu ── */}
            {contextMenu.kind === 'section' ? (
                <div
                    ref={menuRef}
                    className="daw-floating-surface fixed z-50 min-w-[140px] rounded-md p-1"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <button
                        type="button"
                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                            setEditing({ sectionId: contextMenu.section.id, name: contextMenu.section.name });
                            setContextMenu({ kind: 'none' });
                        }}
                    >
                        Rename
                    </button>
                    <DawMenuMutedRow className="px-2">Color</DawMenuMutedRow>
                    <Row align="stretch" gap={1} className="px-2 pb-1">
                        {SECTION_COLORS.map((context) => (
                            <DawSwatchButton
                                key={context}
                                color={context}
                                active={contextMenu.section.color === context}
                                onClick={() => {
                                    setScratchPadSectionColor(contextMenu.section.id, context);
                                    setContextMenu({ kind: 'none' });
                                }}
                                aria-label={`Set color ${context}`}
                            />
                        ))}
                    </Row>
                    <DawMenuSeparator className="my-0.5 border-border/50" />
                    <button
                        type="button"
                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none"
                        disabled={contextMenu.section.order === 0}
                        onClick={() => {
                            reorderScratchPadSection(contextMenu.section.id, 'left');
                            setContextMenu({ kind: 'none' });
                        }}
                    >
                        Move Left
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none"
                        disabled={contextMenu.section.order === sections.length - 1}
                        onClick={() => {
                            reorderScratchPadSection(contextMenu.section.id, 'right');
                            setContextMenu({ kind: 'none' });
                        }}
                    >
                        Move Right
                    </button>
                    <DawMenuSeparator className="my-0.5 border-border/50" />
                    <button
                        type="button"
                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                        onClick={() => {
                            removeScratchPadSection(contextMenu.section.id);
                            setContextMenu({ kind: 'none' });
                        }}
                    >
                        Delete
                    </button>
                </div>
            ) : null}
        </Stack>
    );
};
