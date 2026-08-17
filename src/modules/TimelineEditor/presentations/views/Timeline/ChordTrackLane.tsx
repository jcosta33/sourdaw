/**
 * ChordTrackLane — global chord track rendered above the timeline.
 *
 * This is a **view** (not a component) because it imports use cases directly.
 * Renders colored chord blocks with right-click context menu, drag-to-move,
 * and a compact control strip matching the deep-black metallic DAW aesthetic.
 */

import {
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';

import { Music2, Plus, Power, Trash2 } from 'lucide-react';

import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { useStore } from '#/infra/store/useStore';
import { executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { formatChordName } from '#/modules/MIDI/useCases';
import { cn } from '#/utils/Styles/cn';

const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

type ChordTrackLaneProps = {
    pixelsPerBeat: number;
    scrollX: number;
    /** Timeline viewport width in px, so the off-screen cull tracks the real canvas instead of a fixed guess. */
    viewportWidth: number;
};

type ChordQuality =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';

type ChordTrackEvent = {
    id: string;
    beat: number;
    duration: number;
    root: number;
    quality: ChordQuality;
};

type ChordTrackViewState = {
    enabled: boolean;
    events: ChordTrackEvent[];
};

const defaultState: ChordTrackViewState = { enabled: false, events: [] };

export const CHORD_TRACK_LANE_HEIGHT = 26;

/**
 * oklch-based colors per root note — muted and metallic to match
 * the deep-black theme, with enough saturation to be distinguishable.
 */
const ROOT_COLORS = [
    'oklch(0.42 0.08 250)', // C  - steel blue
    'oklch(0.38 0.08 280)', // C# - indigo
    'oklch(0.38 0.08 300)', // D  - violet
    'oklch(0.38 0.08 320)', // D# - purple
    'oklch(0.40 0.08 350)', // E  - rose
    'oklch(0.40 0.08 25)', // F  - red/coral
    'oklch(0.42 0.08 55)', // F# - orange
    'oklch(0.42 0.08 80)', // G  - amber
    'oklch(0.42 0.08 100)', // G# - gold
    'oklch(0.38 0.08 150)', // A  - emerald
    'oklch(0.38 0.08 175)', // A# - teal
    'oklch(0.40 0.08 200)', // B  - cyan
] as const;

/** Chord qualities offered in the quick-add menu. */
const ADD_MENU_QUALITIES: ChordQuality[] = ['major', 'minor', '7', 'maj7', 'min7', 'dim', 'sus4'];

const PAGE_CONTROL_SELECTOR =
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]';

function getContextMenuQualities(currentQuality: ChordQuality): ChordQuality[] {
    if (ADD_MENU_QUALITIES.includes(currentQuality)) {
        return ADD_MENU_QUALITIES;
    }
    return [...ADD_MENU_QUALITIES, currentQuality];
}

type ContextMenuState =
    | { kind: 'none' }
    | { kind: 'empty'; x: number; y: number; beat: number }
    | { kind: 'chord'; x: number; y: number; event: ChordTrackEvent };

type DragState = {
    eventId: string;
    originalBeat: number;
    pointerId: number;
    previewBeat: number;
    startX: number;
};

type ActionEffects = {
    onSettled?: () => void;
    onApplied?: () => void;
};

export const ChordTrackLane = ({ pixelsPerBeat, scrollX, viewportWidth }: ChordTrackLaneProps): ReactElement => {
    const state = useStore<ChordTrackViewState>(chordTrackStore, defaultState);

    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: 'none' });
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [pending, setPending] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionStatus, setActionStatus] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const addRef = useRef<HTMLDivElement>(null);
    const menuOpenerRef = useRef<HTMLElement | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const committingPointerRef = useRef<number | null>(null);
    const restoreAddFocusRef = useRef(false);
    const mountedRef = useRef(true);
    const pendingRef = useRef(false);

    const beatToX = (beat: number): number => beat * pixelsPerBeat - scrollX;

    const updateDrag = (next: DragState | null): void => {
        dragRef.current = next;
        setDragState(next);
    };

    const dispatchAction = async (
        action: Parameters<typeof executeAppAction>[0],
        effects: ActionEffects = {}
    ): Promise<void> => {
        if (pendingRef.current) {
            return;
        }
        pendingRef.current = true;
        setPending(true);
        setActionError(null);
        setActionStatus(null);
        try {
            await executeAppAction(action);
            if (mountedRef.current) {
                effects.onApplied?.();
            }
        } catch (error) {
            if (mountedRef.current) {
                if (isAppActionCommittedError(error)) {
                    effects.onApplied?.();
                    setActionStatus(null);
                    setActionError('Chord change applied, but undo history could not be recorded.');
                } else {
                    setActionError('Chord change failed. Try again.');
                }
            }
        } finally {
            pendingRef.current = false;
            if (mountedRef.current) {
                effects.onSettled?.();
                setPending(false);
            }
        }
    };

    // ── Close menus on outside click ──────────────────────────────────
    useEffect(() => {
        if (contextMenu.kind === 'none' && !showAddMenu) {
            return () => {};
        }
        const handleClick = (event: globalThis.MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setContextMenu({ kind: 'none' });
            }
            if (addRef.current && !addRef.current.contains(event.target as Node)) {
                setShowAddMenu(false);
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [contextMenu.kind, showAddMenu]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            pendingRef.current = false;
            dragRef.current = null;
            committingPointerRef.current = null;
        };
    }, []);

    const closeContextMenu = (restoreFocus: boolean): void => {
        setContextMenu({ kind: 'none' });
        if (restoreFocus) {
            menuOpenerRef.current?.focus();
        }
    };

    useEffect(() => {
        if (contextMenu.kind !== 'none') {
            menuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
        }
    }, [contextMenu]);

    useEffect(() => {
        if (!pending && restoreAddFocusRef.current) {
            restoreAddFocusRef.current = false;
            addRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        }
    }, [pending]);

    const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeContextMenu(true);
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            const opener = menuOpenerRef.current;
            const pageControls = Array.from(document.querySelectorAll<HTMLElement>(PAGE_CONTROL_SELECTOR)).filter(
                (control) => control.tabIndex >= 0 && !menuRef.current?.contains(control)
            );
            const openerIndex = opener ? pageControls.indexOf(opener) : -1;
            const nextIndex = openerIndex + (event.shiftKey ? -1 : 1);
            const nextControl = openerIndex >= 0 ? pageControls[nextIndex] : undefined;
            closeContextMenu(false);
            nextControl?.focus();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation();
            return;
        }
        const items = Array.from(
            menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []
        );
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        let nextIndex: number | null = null;
        if (event.key === 'ArrowDown') {
            nextIndex = (currentIndex + 1) % items.length;
        } else if (event.key === 'ArrowUp') {
            nextIndex = (currentIndex - 1 + items.length) % items.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = items.length - 1;
        }
        if (nextIndex !== null) {
            event.preventDefault();
            event.stopPropagation();
            items[nextIndex]?.focus();
        }
    };

    // ── Drag handling ─────────────────────────────────────────────────
    const handlePointerDown = (pointerEvent: PointerEvent<HTMLButtonElement>, event: ChordTrackEvent): void => {
        if (pointerEvent.button !== 0 || pendingRef.current || dragRef.current) {
            return;
        }
        pointerEvent.stopPropagation();
        pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
        updateDrag({
            eventId: event.id,
            originalBeat: event.beat,
            pointerId: pointerEvent.pointerId,
            previewBeat: event.beat,
            startX: pointerEvent.clientX,
        });
    };

    const handlePointerMove = (pointerEvent: PointerEvent<HTMLButtonElement>): void => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== pointerEvent.pointerId) {
            return;
        }
        const dx = pointerEvent.clientX - drag.startX;
        const beatDelta = dx / pixelsPerBeat;
        const previewBeat = Math.max(0, Math.round((drag.originalBeat + beatDelta) * 4) / 4);
        updateDrag({ ...drag, previewBeat });
    };

    const handlePointerUp = (pointerEvent: PointerEvent<HTMLButtonElement>): void => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== pointerEvent.pointerId) {
            return;
        }
        if (pendingRef.current) {
            updateDrag(null);
            return;
        }
        committingPointerRef.current = drag.pointerId;
        if (drag.previewBeat === drag.originalBeat) {
            committingPointerRef.current = null;
            updateDrag(null);
            return;
        }
        void dispatchAction(
            { type: 'moveChordEvent', payload: { eventId: drag.eventId, beat: drag.previewBeat } },
            {
                onSettled: () => {
                    committingPointerRef.current = null;
                    updateDrag(null);
                },
            }
        );
    };

    const cancelPointerDrag = (pointerEvent: PointerEvent<HTMLButtonElement>): void => {
        const drag = dragRef.current;
        if (drag?.pointerId === pointerEvent.pointerId && committingPointerRef.current !== pointerEvent.pointerId) {
            updateDrag(null);
        }
    };

    // ── Context menu ──────────────────────────────────────────────────
    const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
        event.preventDefault();
        if (pendingRef.current) {
            return;
        }
        const activeElement = document.activeElement;
        menuOpenerRef.current =
            activeElement instanceof HTMLElement &&
            activeElement.matches(PAGE_CONTROL_SELECTOR) &&
            activeElement.tabIndex >= 0
                ? activeElement
                : (addRef.current?.querySelector<HTMLButtonElement>('button') ?? null);
        const rect = event.currentTarget.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const beat = (localX + scrollX) / pixelsPerBeat;

        // Check if clicked on an existing chord block
        const hitEvent = state.events.find((ev) => {
            const ex = beatToX(ev.beat);
            const ew = ev.duration * pixelsPerBeat;
            return localX >= ex && localX <= ex + ew;
        });

        if (hitEvent) {
            const opener = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
            if (opener?.dataset.chordEventId === hitEvent.id) {
                menuOpenerRef.current = opener;
            }
            setContextMenu({ kind: 'chord', x: event.clientX, y: event.clientY, event: hitEvent });
        } else {
            setContextMenu({ kind: 'empty', x: event.clientX, y: event.clientY, beat });
        }
    };

    const openChordMenuFromKeyboard = (
        keyboardEvent: KeyboardEvent<HTMLButtonElement>,
        event: ChordTrackEvent
    ): void => {
        const opensMenu =
            keyboardEvent.key === 'ContextMenu' ||
            (keyboardEvent.shiftKey && keyboardEvent.key === 'F10') ||
            keyboardEvent.key === 'Enter' ||
            keyboardEvent.key === ' ';
        if (!opensMenu) {
            return;
        }
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();
        const rect = keyboardEvent.currentTarget.getBoundingClientRect();
        menuOpenerRef.current = keyboardEvent.currentTarget;
        setContextMenu({ kind: 'chord', x: rect.left + rect.width / 2, y: rect.bottom, event });
    };

    const finishKeyboardDelete = (event: ChordTrackEvent): void => {
        closeContextMenu(false);
        restoreAddFocusRef.current = true;
        setActionStatus(`Removed ${formatChordName(event)} chord at beat ${String(event.beat)}.`);
    };

    const handleChordKeyDown = (keyboardEvent: KeyboardEvent<HTMLButtonElement>, event: ChordTrackEvent): void => {
        if (pendingRef.current) {
            return;
        }
        if (keyboardEvent.key === 'ArrowLeft' || keyboardEvent.key === 'ArrowRight') {
            keyboardEvent.preventDefault();
            keyboardEvent.stopPropagation();
            const direction = keyboardEvent.key === 'ArrowLeft' ? -1 : 1;
            const beat = Math.max(0, event.beat + direction * 0.25);
            void dispatchAction(
                { type: 'moveChordEvent', payload: { eventId: event.id, beat } },
                { onApplied: () => setActionStatus(`Moved ${formatChordName(event)} chord to beat ${String(beat)}.`) }
            );
            return;
        }
        if (keyboardEvent.key === 'Delete' || keyboardEvent.key === 'Backspace') {
            keyboardEvent.preventDefault();
            keyboardEvent.stopPropagation();
            void dispatchAction(
                { type: 'removeChordEvent', payload: { eventId: event.id } },
                { onApplied: () => finishKeyboardDelete(event) }
            );
            return;
        }
        openChordMenuFromKeyboard(keyboardEvent, event);
    };

    // ── Add chord at beat from context menu ───────────────────────────
    const handleAddAtBeat = (beat: number, root: number, quality: ChordQuality): void => {
        void dispatchAction(
            {
                type: 'addChordEvent',
                payload: { beat: Math.floor(beat), root, quality, duration: 4 },
            },
            { onApplied: () => closeContextMenu(false) }
        );
    };

    // ── Add chord from top-bar "+" button ─────────────────────────────
    const handleQuickAdd = (root: number, quality: ChordQuality): void => {
        const lastEvent = state.events[state.events.length - 1];
        const beat = lastEvent ? lastEvent.beat + lastEvent.duration : 0;
        void dispatchAction(
            { type: 'addChordEvent', payload: { beat, root, quality, duration: 4 } },
            { onApplied: () => setShowAddMenu(false) }
        );
    };

    let statusText: string | null = null;
    if (pending) {
        statusText = 'Applying chord change…';
    } else if (actionStatus) {
        statusText = actionStatus;
    }

    return (
        <div
            className="relative flex items-center shrink-0 border-b border-border/40 bg-surface-base/60 select-none overflow-hidden"
            style={{ height: CHORD_TRACK_LANE_HEIGHT }}
            onContextMenu={handleContextMenu}
            role="region"
            aria-label="Chord track"
            aria-busy={pending}
        >
            {/* ── Label + controls strip ── */}
            <div className="flex items-center gap-1.5 px-2 shrink-0 z-10 bg-surface-base/90 border-r border-border/30 h-full">
                <Music2 className="size-3 text-[var(--color-accent-peach)]/80" aria-hidden="true" />
                <span className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">
                    Chords
                </span>

                {/* Power toggle — matches mute/solo button styling */}
                <button
                    type="button"
                    className={cn(
                        'size-4 rounded flex items-center justify-center transition-colors',
                        state.enabled
                            ? 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)] hover:bg-[var(--color-accent-peach)]/30'
                            : 'text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-white/5'
                    )}
                    aria-label={state.enabled ? 'Disable harmonic following' : 'Enable harmonic following'}
                    aria-pressed={state.enabled}
                    disabled={pending}
                    title={state.enabled ? 'Harmonic following ON' : 'Harmonic following OFF'}
                    onClick={() => {
                        void dispatchAction({
                            type: 'toggleChordTrack',
                            payload: { enabled: !state.enabled },
                        });
                    }}
                >
                    <Power className="size-2.5" />
                </button>

                {/* Add button */}
                <div className="relative" ref={addRef}>
                    <button
                        type="button"
                        className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-white/5 transition-colors"
                        aria-label="Add chord event"
                        disabled={pending}
                        onClick={() => setShowAddMenu(!showAddMenu)}
                    >
                        <Plus className="size-2.5" />
                    </button>
                    {showAddMenu ? <ChordPickerPopover onPick={handleQuickAdd} /> : null}
                </div>

                {/* Clear all — only show if there are events */}
                {state.events.length > 0 ? (
                    <button
                        type="button"
                        className="size-4 rounded flex items-center justify-center text-muted-foreground/30 hover:text-destructive/70 hover:bg-destructive/5 transition-colors"
                        aria-label="Clear all chords"
                        disabled={pending}
                        title="Clear chord track"
                        onClick={() => {
                            void dispatchAction({ type: 'clearChordTrack' });
                        }}
                    >
                        <Trash2 className="size-2.5" />
                    </button>
                ) : null}
            </div>
            <span
                className="absolute right-2 z-40 text-[9px] text-muted-foreground"
                role="status"
                aria-atomic="true"
                aria-live="polite"
            >
                {statusText ?? ''}
            </span>
            <span
                className="absolute right-2 z-40 text-[9px] text-destructive"
                role="alert"
                aria-atomic="true"
                aria-live="assertive"
            >
                {actionError ?? ''}
            </span>
            {/* ── Chord blocks ── */}
            <div className="relative flex-1 h-full">
                {state.events.map((event) => {
                    const displayedBeat = dragState?.eventId === event.id ? dragState.previewBeat : event.beat;
                    const x = beatToX(displayedBeat);
                    const width = event.duration * pixelsPerBeat;
                    const color = ROOT_COLORS[event.root % 12]!;

                    // Cull off-screen blocks against the real viewport width — a fixed
                    // guess here hid chord blocks on wide viewports (#2039).
                    if (x + width < -20 || x > viewportWidth + 20) {
                        return null;
                    }

                    return (
                        <button
                            type="button"
                            key={event.id}
                            className={cn(
                                'absolute top-1 bottom-1 rounded-[3px] flex items-center p-0 text-left cursor-grab active:cursor-grabbing',
                                'border border-white/10 hover:border-white/20 transition-all',
                                'shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                            )}
                            style={{
                                left: x,
                                width: Math.max(width, 24),
                                backgroundColor: color,
                            }}
                            aria-disabled={pending}
                            aria-expanded={contextMenu.kind === 'chord' && contextMenu.event.id === event.id}
                            aria-haspopup="menu"
                            aria-label={`${formatChordName(event)} chord at beat ${String(event.beat)}`}
                            data-chord-event-id={event.id}
                            onKeyDown={(keyboardEvent) => handleChordKeyDown(keyboardEvent, event)}
                            onLostPointerCapture={cancelPointerDrag}
                            onPointerCancel={cancelPointerDrag}
                            onPointerDown={(pointerEvent) => handlePointerDown(pointerEvent, event)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            title={`${formatChordName(event)} — ${event.duration} beats`}
                        >
                            <span className="text-[9px] font-bold text-white/90 tracking-tight whitespace-nowrap overflow-hidden text-ellipsis px-1.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                                {formatChordName(event)}
                            </span>
                        </button>
                    );
                })}

                {/* Empty state hint */}
                {state.events.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <DawInlineHint>Right-click to add chords · Drag to reposition</DawInlineHint>
                    </div>
                ) : null}
            </div>
            {/* ── Context menus ── */}
            {contextMenu.kind !== 'none' ? (
                <div
                    ref={menuRef}
                    className="daw-floating-surface fixed z-50 min-w-[140px] rounded-md p-1"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    aria-label={
                        contextMenu.kind === 'chord'
                            ? `Chord actions for ${formatChordName(contextMenu.event)}`
                            : 'Add chord'
                    }
                    onKeyDown={handleMenuKeyDown}
                    role="menu"
                    tabIndex={-1}
                >
                    {contextMenu.kind === 'empty' ? (
                        <>
                            <DawMenuMutedRow className="px-2">Beat {Math.floor(contextMenu.beat)}</DawMenuMutedRow>
                            {ROOT_NAMES.slice(0, 7).map((name, rootIdx) => (
                                <button
                                    type="button"
                                    key={name}
                                    className="flex w-full items-center rounded-sm px-2 py-1 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                                    disabled={pending}
                                    onClick={() => handleAddAtBeat(contextMenu.beat, rootIdx, 'major')}
                                    role="menuitem"
                                    tabIndex={-1}
                                >
                                    Add {name}
                                </button>
                            ))}
                        </>
                    ) : null}
                    {contextMenu.kind === 'chord' ? (
                        <>
                            <DawMenuMutedRow className="px-2">{formatChordName(contextMenu.event)}</DawMenuMutedRow>
                            <DawMenuMutedRow className="px-2">Quality</DawMenuMutedRow>
                            <div className="flex flex-wrap gap-0.5 px-2 pb-1" aria-label="Quality" role="group">
                                {getContextMenuQualities(contextMenu.event.quality).map((query) => (
                                    <button
                                        type="button"
                                        key={query}
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-[9px] transition-colors',
                                            contextMenu.event.quality === query
                                                ? 'bg-accent text-accent-foreground'
                                                : 'text-popover-foreground hover:bg-accent/50'
                                        )}
                                        disabled={pending}
                                        onClick={() => {
                                            void dispatchAction(
                                                {
                                                    type: 'updateChordEvent',
                                                    payload: { eventId: contextMenu.event.id, quality: query },
                                                },
                                                { onApplied: () => closeContextMenu(true) }
                                            );
                                        }}
                                        aria-checked={contextMenu.event.quality === query}
                                        role="menuitemradio"
                                        tabIndex={-1}
                                    >
                                        {query}
                                    </button>
                                ))}
                            </div>
                            <DawMenuMutedRow className="px-2">Root</DawMenuMutedRow>
                            <div className="flex flex-wrap gap-0.5 px-2 pb-1" aria-label="Root" role="group">
                                {ROOT_NAMES.map((name, idx) => (
                                    <button
                                        type="button"
                                        key={name}
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-[9px] transition-colors',
                                            contextMenu.event.root === idx
                                                ? 'bg-accent text-accent-foreground'
                                                : 'text-popover-foreground hover:bg-accent/50'
                                        )}
                                        disabled={pending}
                                        onClick={() => {
                                            void dispatchAction(
                                                {
                                                    type: 'updateChordEvent',
                                                    payload: { eventId: contextMenu.event.id, root: idx },
                                                },
                                                { onApplied: () => closeContextMenu(true) }
                                            );
                                        }}
                                        aria-checked={contextMenu.event.root === idx}
                                        role="menuitemradio"
                                        tabIndex={-1}
                                    >
                                        {name}
                                    </button>
                                ))}
                            </div>
                            <DawMenuSeparator className="my-0.5 border-border/50" />
                            <button
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                                disabled={pending}
                                onClick={() => {
                                    void dispatchAction(
                                        { type: 'removeChordEvent', payload: { eventId: contextMenu.event.id } },
                                        { onApplied: () => finishKeyboardDelete(contextMenu.event) }
                                    );
                                }}
                                role="menuitem"
                                tabIndex={-1}
                            >
                                Delete Chord
                            </button>
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};

// ── Chord picker popover ──────────────────────────────────────────────────

const ChordPickerPopover = ({ onPick }: { onPick: (root: number, quality: ChordQuality) => void }): ReactElement => (
    <div className="daw-floating-surface absolute left-0 top-full z-50 mt-1 max-h-56 w-48 overflow-y-auto rounded-md p-1.5">
        {ROOT_NAMES.map((name, rootIdx) => (
            <div key={name}>
                <div className="px-1.5 pt-1 pb-0.5 text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider">
                    {name}
                </div>
                <div className="flex flex-wrap gap-0.5 px-1 pb-1">
                    {ADD_MENU_QUALITIES.map((quality) => (
                        <button
                            type="button"
                            key={`${name}-${quality}`}
                            className="rounded px-1.5 py-0.5 text-[9px] text-popover-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors"
                            onClick={() => onPick(rootIdx, quality)}
                        >
                            {quality === 'major' ? name : `${name}${quality}`}
                        </button>
                    ))}
                </div>
            </div>
        ))}
    </div>
);
