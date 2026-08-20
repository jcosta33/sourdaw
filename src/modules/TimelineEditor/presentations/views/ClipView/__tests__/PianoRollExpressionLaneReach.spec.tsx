/**
 * Reachability of the expression panel (velocity/pressure/slide/pitch-bend,
 * behind "Show Expression View") once the layout `contentWidth` tracks a clip's
 * real length instead of a fixed GRID_BEATS cap.
 *
 * Two things have to hold together, and each one alone leaves a note past the
 * panel's initial width unreachable:
 *
 * 1. The wrapper is a real horizontal scroll container whose `scrollLeft`
 *    follows the main piano roll's (AutomationLane.tsx's existing pattern),
 *    rather than one that clips with no way for the user to scroll.
 * 2. `NotePropertyLane` sizes its backing store from that container's viewport
 *    and draws from its `scrollLeft`. Sizing it to `contentWidth` instead makes
 *    the reachable beat count inversely proportional to zoom by construction —
 *    a canvas dimension is finite, so at the toolbar's 400% on a 3x display the
 *    browser stops allocating around beat 68 and the panel goes blank while the
 *    scrollbar keeps scrolling into the blank region.
 *
 * This file exercises the *real* `NotePropertyLane` (unlike PianoRoll.spec.tsx
 * and PianoRollGridExtent.spec.tsx, which both stub it out), so it is where the
 * two halves are proven to be wired to each other.
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
    const VIEWPORT_WIDTH = 300;

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
        // Deterministic geometry for the property lane's own pointer math. The
        // lane's canvas is `position: sticky`, so `.left` of 0 is what it really
        // reports at any scroll offset: a clientX is a *viewport*-local x, and
        // the scroll offset is what the lane has to add back to reach a beat.
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(0, 0, VIEWPORT_WIDTH, 131)
        );
        // jsdom lays nothing out, so every element reports clientWidth 0. The
        // lane sizes its backing store from its scroll container's clientWidth,
        // and a zero-width viewport has no slice to draw at all.
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH);
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

    it('keeps a note past the panel initial width hit-testable once scrolled to, on a viewport-sized canvas', () => {
        render(<PianoRoll {...defaultProps} />);
        act(() => {
            invokeToolbarHandler('onToggleExpressionView');
        });

        const mainScrollContainer = screen.getByLabelText('Piano roll editor').closest('.overflow-auto');
        if (!mainScrollContainer) {
            throw new Error('Expected the piano roll scroll container');
        }
        const laneCanvas = screen.getByLabelText('velocity lane').querySelector('canvas');
        if (!laneCanvas) {
            throw new Error('Expected the expression lane canvas');
        }

        // The backing store is the viewport, not the clip. At 256 beats and a
        // 40px beat the old sizing made this 10,240 CSS px; at the toolbar's
        // 400% on a 3x display the same rule asks for 491,520 device px, which
        // no browser will allocate.
        expect(parseFloat(laneCanvas.style.width)).toBe(VIEWPORT_WIDTH);

        // Unscrolled, beat 200 is nowhere near the visible slice, so a press
        // inside that slice writes nothing.
        fireEvent.pointerDown(laneCanvas, { pointerId: 1, clientX: 100, clientY: 2 });
        expect(setNoteVelocity).not.toHaveBeenCalled();

        // Scrolling the main roll drags the panel with it, putting the far
        // note 100px into the visible slice.
        const noteX = FAR_NOTE.startBeat * 40; // beatWidth
        Object.defineProperty(mainScrollContainer, 'scrollLeft', { value: noteX - 100, configurable: true });
        fireEvent.scroll(mainScrollContainer);

        // clientY 2 → top of the usable (h=131) range → value 127. clientX 102
        // is a viewport-local position: the lane owes the scroll offset back.
        fireEvent.pointerDown(laneCanvas, { pointerId: 2, clientX: 102, clientY: 2 });

        expect(setNoteVelocity).toHaveBeenCalledWith('clip-1', 'n-far', 127);
    });
});
