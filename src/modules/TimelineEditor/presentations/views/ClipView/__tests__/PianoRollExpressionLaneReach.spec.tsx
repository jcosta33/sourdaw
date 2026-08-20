/**
 * PR review (piano-roll-grid-extent, PianoRoll.tsx:207): this lane made the
 * layout `contentWidth` track the clip's real length instead of a fixed
 * GRID_BEATS cap. `NotePropertyLane` — the velocity/pressure/slide/pitch-bend
 * panel behind "Show Expression View" — receives that same `contentWidth`
 * and sizes its canvas to it, but its wrapper in `PianoRoll.tsx` was plain
 * `overflow-x-hidden` with no scrollbar and no `scrollLeft` sync to the main
 * canvas. Before this lane `contentWidth` was capped near 1280px, so the
 * clipping was invisible; once it tracks a clip's real length, any note past
 * the panel's initial width becomes permanently unreachable — not drawn
 * off-screen, but undraggable and unclickable with no way to scroll to it.
 *
 * This file exercises the *real* `NotePropertyLane` (unlike PianoRoll.spec.tsx
 * and PianoRollGridExtent.spec.tsx, which both stub it out) so it can prove
 * the fix two ways: the wrapper is a real horizontal scroll container synced
 * to the main piano roll's `scrollLeft` (AutomationLane.tsx's existing
 * pattern), and a note far past the initial width is still hit-testable once
 * scrolled to.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setNoteVelocity } from '#/modules/MIDI/useCases';

import { PianoRoll } from '../PianoRoll';

type ProbeNote = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };
type ProbeMidiState = {
    notesByClipId: Record<string, ProbeNote[]>;
    ccByClipId: Record<string, unknown[]>;
    pitchBendByClipId: Record<string, unknown[]>;
};
type ProbeTrackState = {
    tracks: Array<{
        id: string;
        kind: 'midi';
        color: string;
        clips: Array<{ id: string; type: 'midi'; startBeat: number; endBeat: number }>;
    }>;
    selectedTrackId: string | null;
};

const { midiState, trackState, toolbarPropsRef } = vi.hoisted(
    (): {
        midiState: ProbeMidiState;
        trackState: ProbeTrackState;
        toolbarPropsRef: { current: Record<string, unknown> | null };
    } => ({
        midiState: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        trackState: { tracks: [], selectedTrackId: null },
        toolbarPropsRef: { current: null },
    })
);

function invokeToolbarHandler<TArgs extends unknown[]>(name: string, ...args: TArgs): void {
    const handler = toolbarPropsRef.current?.[name];
    if (typeof handler !== 'function') {
        throw new TypeError(`Expected toolbar prop "${name}" to be a function`);
    }
    (handler as (...handlerArgs: TArgs) => void)(...args);
}

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: unknown[]) => inputs.filter((input) => typeof input === 'string').join(' '),
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return midiState;
        },
        getSnapshot: () => midiState,
        subscribe: vi.fn(() => () => {}),
        subscribeReact: vi.fn(() => () => {}),
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return trackState;
        },
        getSnapshot: () => trackState,
        subscribe: vi.fn(() => () => {}),
        subscribeReact: vi.fn(() => () => {}),
    },
}));

// Order matters: `NotePropertyLane` calls `useStore(midiStore, { notesByClipId: {}, ... })`
// with a truthy fallback object, so `fallback ?? store.value` (the order PianoRoll.spec.tsx
// and PianoRollGridExtent.spec.tsx use, safe there only because both stub NotePropertyLane
// out entirely) would always win and silently return the empty fallback, hiding every note.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => store.value ?? fallback),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    setNoteVelocity: vi.fn(),
    setNoteVelocities: vi.fn(),
    setNotePressure: vi.fn(),
    setNoteSlide: vi.fn(),
    setNotePitchBend: vi.fn(),
    setStepRecordBeat: vi.fn(),
    toggleStepRecordingForClip: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    setProjectKeyRoot: vi.fn(),
    setProjectScaleName: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#151515'),
}));

vi.mock('../../../hooks/usePianoRollRenderer', () => ({
    usePianoRollRenderer: vi.fn(() => vi.fn()),
}));

vi.mock('../../../hooks/usePianoRollInteractions', () => ({
    usePianoRollInteractions: vi.fn(() => ({
        handleMouseDown: vi.fn(),
        handleMouseMove: vi.fn(),
        handleMouseUp: vi.fn(),
        handleDoubleClick: vi.fn(),
        handleKeyDown: vi.fn(),
        handleContextMenu: vi.fn(),
        ctxMenu: null,
        setCtxMenu: vi.fn(),
        hoverCursor: 'crosshair',
    })),
}));

vi.mock('../PianoRollToolbar', () => ({
    PianoRollToolbar: (props: Record<string, unknown>) => {
        toolbarPropsRef.current = props;
        return <div data-testid="toolbar" />;
    },
}));

vi.mock('../PianoRollContextMenu', () => ({
    PianoRollContextMenu: () => <div data-testid="context-menu" />,
}));

vi.mock('#/components/daw/DawGridHeaderCell', () => ({
    DawGridHeaderCell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/daw/DawSideRail', () => ({
    DawSideRail: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Whole-module mock: same fake constants PianoRoll.spec.tsx uses, so the
// panel gets a large, deterministic content width (256 beats * 40px =
// 10,240px) far past any initial viewport — see that file's own comment for
// why the real extent rule is left to PianoRollGridExtent.spec.tsx instead.
vi.mock('../../../helpers/pianoRollConstants', () => ({
    NOTE_NAMES: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    GRID_BEATS: 256,
    ROW_HEIGHT: 24,
    RULER_HEIGHT: 28,
    PITCH_RAIL_WIDTH: 40,
    EMPTY_NOTES: [],
    getVisiblePitches: vi.fn(() => [60, 61, 62, 63, 64]),
    getPianoRollExtentBeats: vi.fn(() => 256),
}));

describe('PianoRoll expression lane reachability (real NotePropertyLane)', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        onSelectedNoteIdsChange: vi.fn(),
    };

    // beatWidth = 40 (zoom=1). Far past any viewport the panel could plausibly
    // start at, and past the pre-fix content-width cap of 32 beats (1280px).
    const FAR_NOTE: ProbeNote = { id: 'n-far', pitch: 60, startBeat: 200, duration: 2, velocity: 100 };

    beforeEach(() => {
        vi.clearAllMocks();
        toolbarPropsRef.current = null;
        midiState.notesByClipId = { 'clip-1': [FAR_NOTE] };
        trackState.tracks = [
            {
                id: 'track-1',
                kind: 'midi',
                color: 'oklch(0.5 0.1 200)',
                clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 256 }],
            },
        ];
        // Deterministic geometry for the property lane's own pointer math —
        // same fixed rect NotePropertyLane.spec.tsx uses. `.left` is 0, so a
        // clientX is directly the canvas-local x the render loop drew at.
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 131));
    });

    it('gives the expression lane a real horizontal scroll container synced to the main scroll, not a clipped one', () => {
        render(<PianoRoll {...defaultProps} />);
        act(() => {
            invokeToolbarHandler('onToggleExpressionView');
        });

        const mainScrollContainer = screen.getByLabelText('Piano roll editor').closest('.overflow-auto');
        if (!mainScrollContainer) {
            throw new Error('Expected the piano roll scroll container');
        }

        const laneGroup = screen.getByLabelText('velocity lane');
        const scrollWrapper = laneGroup.parentElement?.parentElement;
        if (!scrollWrapper) {
            throw new Error('Expected the expression lane scroll wrapper');
        }

        // A wrapper that clips (overflow-x-hidden) has no scrollbar and no
        // programmatic scroll path from the user, so anything past its
        // initial width is unreachable no matter what scrollLeft is later
        // set to — this is the decisive structural assertion.
        expect(scrollWrapper.className).toContain('overflow-x-auto');
        expect(scrollWrapper.className).not.toContain('overflow-x-hidden');

        // Scrolling the main piano roll must drag the expression lane's
        // scroll position with it (AutomationLane.tsx's existing pattern via
        // ClipView.tsx's handlePianoRollScroll) — otherwise the wrapper is
        // scrollable in principle but never actually moves.
        Object.defineProperty(mainScrollContainer, 'scrollLeft', { value: 8000, configurable: true });
        fireEvent.scroll(mainScrollContainer);

        expect(scrollWrapper.scrollLeft).toBe(8000);
    });

    it('keeps a note past the panel initial width present and hit-testable once scrolled to', () => {
        render(<PianoRoll {...defaultProps} />);
        act(() => {
            invokeToolbarHandler('onToggleExpressionView');
        });

        const laneCanvas = screen.getByLabelText('velocity lane').querySelector('canvas');
        if (!laneCanvas) {
            throw new Error('Expected the expression lane canvas');
        }

        // The canvas backing store must actually cover the far note — this is
        // NotePropertyLane's own `Math.max(containerWidth, contentWidth)`
        // sizing, unaffected by the wrapper fix but the other half of
        // "present": a canvas capped at viewport width would never draw the
        // bar at all, scroll sync or not.
        const noteX = FAR_NOTE.startBeat * 40; // beatWidth
        const barW = Math.max(3, FAR_NOTE.duration * 40 - 2);
        expect(laneCanvas.style.width.replace('px', '')).toMatch(/^\d+$/);
        expect(parseFloat(laneCanvas.style.width)).toBeGreaterThanOrEqual(noteX + barW);

        // clientY 2 → top of the usable (h=131) range → value 127.
        fireEvent.pointerDown(laneCanvas, { pointerId: 1, clientX: noteX + 1, clientY: 2 });

        expect(setNoteVelocity).toHaveBeenCalledWith('clip-1', 'n-far', 127);
    });
});
