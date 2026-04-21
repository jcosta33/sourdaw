/**
 * ChordTrackLane — global chord track rendered above the timeline.
 *
 * This is a **view** (not a component) because it imports use cases directly.
 * Renders colored chord blocks with right-click context menu, drag-to-move,
 * and a compact control strip matching the deep-black metallic DAW aesthetic.
 */

import { type ReactElement, type MouseEvent, useState, useRef, useEffect } from 'react';

import { Music2, Plus, Power, Trash2 } from 'lucide-react';

import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { useStore } from '#/infra/store/useStore';
import { chordTrackStore } from '#/modules/MIDI/stores';
import {
    addChordEvent,
    removeChordEvent,
    moveChordEvent,
    updateChordEvent,
    toggleChordTrack,
    clearChordTrack,
    formatChordName,
} from '#/modules/MIDI/useCases';
import { cn } from '#/utils/Styles/cn';

const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

type ChordTrackLaneProps = {
    pixelsPerBeat: number;
    scrollX: number;
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

const LANE_HEIGHT = 26;

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

type ContextMenuState =
    | { kind: 'none' }
    | { kind: 'empty'; x: number; y: number; beat: number }
    | { kind: 'chord'; x: number; y: number; event: ChordTrackEvent };

export const ChordTrackLane = ({ pixelsPerBeat, scrollX }: ChordTrackLaneProps): ReactElement => {
    const state = useStore<ChordTrackViewState>(chordTrackStore, defaultState);

    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: 'none' });
    const [dragState, setDragState] = useState<{ eventId: string; startX: number; originalBeat: number } | null>(null);
    const [showAddMenu, setShowAddMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const addRef = useRef<HTMLDivElement>(null);

    const beatToX = (beat: number): number => beat * pixelsPerBeat - scrollX;

    // ── Close menus on outside click ──────────────────────────────────
    useEffect(() => {
        if (contextMenu.kind === 'none' && !showAddMenu) {
            return () => {};
        }
        const handleClick = (e: globalThis.MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu({ kind: 'none' });
            }
            if (addRef.current && !addRef.current.contains(e.target as Node)) {
                setShowAddMenu(false);
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [contextMenu.kind, showAddMenu]);

    // ── Drag handling ─────────────────────────────────────────────────
    const handleMouseDown = (e: MouseEvent, event: ChordTrackEvent): void => {
        if (e.button !== 0) {
            return;
        }
        e.stopPropagation();
        setDragState({ eventId: event.id, startX: e.clientX, originalBeat: event.beat });
    };

    const handleMouseMove = (e: MouseEvent): void => {
        if (!dragState) {
            return;
        }
        const dx = e.clientX - dragState.startX;
        const beatDelta = dx / pixelsPerBeat;
        const newBeat = Math.max(0, Math.round((dragState.originalBeat + beatDelta) * 4) / 4);
        moveChordEvent(dragState.eventId, newBeat);
    };

    const handleMouseUp = (): void => {
        setDragState(null);
    };

    // ── Context menu ──────────────────────────────────────────────────
    const handleContextMenu = (e: MouseEvent<HTMLDivElement>): void => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const beat = (localX + scrollX) / pixelsPerBeat;

        // Check if clicked on an existing chord block
        const hitEvent = state.events.find((ev) => {
            const ex = beatToX(ev.beat);
            const ew = ev.duration * pixelsPerBeat;
            return localX >= ex && localX <= ex + ew;
        });

        if (hitEvent) {
            setContextMenu({ kind: 'chord', x: e.clientX, y: e.clientY, event: hitEvent });
        } else {
            setContextMenu({ kind: 'empty', x: e.clientX, y: e.clientY, beat });
        }
    };

    // ── Add chord at beat from context menu ───────────────────────────
    const handleAddAtBeat = (beat: number, root: number, quality: ChordQuality): void => {
        addChordEvent(Math.floor(beat), root, quality, 4);
        setContextMenu({ kind: 'none' });
    };

    // ── Add chord from top-bar "+" button ─────────────────────────────
    const handleQuickAdd = (root: number, quality: ChordQuality): void => {
        const lastEvent = state.events[state.events.length - 1];
        const beat = lastEvent ? lastEvent.beat + lastEvent.duration : 0;
        addChordEvent(beat, root, quality, 4);
        setShowAddMenu(false);
    };

    return (
        <div
            className="relative flex items-center shrink-0 border-b border-border/40 bg-surface-base/60 select-none overflow-hidden"
            style={{ height: LANE_HEIGHT }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={handleContextMenu}
            role="region"
            aria-label="Chord track"
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
                    title={state.enabled ? 'Harmonic following ON' : 'Harmonic following OFF'}
                    onClick={() => toggleChordTrack()}
                >
                    <Power className="size-2.5" />
                </button>

                {/* Add button */}
                <div className="relative" ref={addRef}>
                    <button
                        type="button"
                        className="size-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-white/5 transition-colors"
                        aria-label="Add chord event"
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
                        title="Clear chord track"
                        onClick={() => clearChordTrack()}
                    >
                        <Trash2 className="size-2.5" />
                    </button>
                ) : null}
            </div>

            {/* ── Chord blocks ── */}
            <div className="relative flex-1 h-full">
                {state.events.map((event) => {
                    const x = beatToX(event.beat);
                    const width = event.duration * pixelsPerBeat;
                    const color = ROOT_COLORS[event.root % 12]!;

                    // Cull off-screen blocks
                    if (x + width < -20 || x > 4000) {
                        return null;
                    }

                    return (
                        <div
                            key={event.id}
                            className={cn(
                                'absolute top-1 bottom-1 rounded-[3px] flex items-center cursor-grab active:cursor-grabbing',
                                'border border-white/10 hover:border-white/20 transition-all',
                                'shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                            )}
                            style={{
                                left: x,
                                width: Math.max(width, 24),
                                backgroundColor: color,
                            }}
                            onMouseDown={(e) => handleMouseDown(e, event)}
                            title={`${formatChordName(event)} — ${event.duration} beats`}
                        >
                            <span className="text-[9px] font-bold text-white/90 tracking-tight whitespace-nowrap overflow-hidden text-ellipsis px-1.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                                {formatChordName(event)}
                            </span>
                        </div>
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
                >
                    {contextMenu.kind === 'empty' && (
                        <>
                            <DawMenuMutedRow className="px-2">Beat {Math.floor(contextMenu.beat)}</DawMenuMutedRow>
                            {ROOT_NAMES.slice(0, 7).map((name, rootIdx) => (
                                <button
                                    type="button"
                                    key={name}
                                    className="flex w-full items-center rounded-sm px-2 py-1 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                                    onClick={() => handleAddAtBeat(contextMenu.beat, rootIdx, 'major')}
                                >
                                    Add {name}
                                </button>
                            ))}
                        </>
                    )}
                    {contextMenu.kind === 'chord' && (
                        <>
                            <DawMenuMutedRow className="px-2">{formatChordName(contextMenu.event)}</DawMenuMutedRow>
                            <DawMenuMutedRow className="px-2">Quality</DawMenuMutedRow>
                            <div className="flex flex-wrap gap-0.5 px-2 pb-1">
                                {ADD_MENU_QUALITIES.map((q) => (
                                    <button
                                        type="button"
                                        key={q}
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-[9px] transition-colors',
                                            contextMenu.event.quality === q
                                                ? 'bg-accent text-accent-foreground'
                                                : 'text-popover-foreground hover:bg-accent/50'
                                        )}
                                        onClick={() => {
                                            updateChordEvent(contextMenu.event.id, { quality: q });
                                            setContextMenu({ kind: 'none' });
                                        }}
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                            <DawMenuMutedRow className="px-2">Root</DawMenuMutedRow>
                            <div className="flex flex-wrap gap-0.5 px-2 pb-1">
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
                                        onClick={() => {
                                            updateChordEvent(contextMenu.event.id, { root: idx });
                                            setContextMenu({ kind: 'none' });
                                        }}
                                    >
                                        {name}
                                    </button>
                                ))}
                            </div>
                            <DawMenuSeparator className="my-0.5 border-border/50" />
                            <button
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                    removeChordEvent(contextMenu.event.id);
                                    setContextMenu({ kind: 'none' });
                                }}
                            >
                                Delete Chord
                            </button>
                        </>
                    )}
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
