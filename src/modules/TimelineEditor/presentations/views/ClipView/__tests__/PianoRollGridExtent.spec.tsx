/**
 * PianoRoll.spec.tsx replaces the whole `pianoRollConstants` barrel with a
 * fake `GRID_BEATS: 256`, so its width assertions describe a value the
 * product never produces and cannot observe a regression in the real
 * extent rule. These tests run against the real `pianoRollConstants` module
 * (only `#/modules/MIDI/stores` and `#/modules/Arrangement/stores` are
 * mocked, to control the clip/notes fixture) so they exercise
 * `getPianoRollExtentBeats` exactly as the shipped component does.
 *
 * Isolated into their own file — not merged into PianoRoll.spec.tsx — because
 * that file's whole-module mock of `pianoRollConstants` is load-bearing for
 * its other tests (deterministic `getVisiblePitches`, distinct
 * `ROW_HEIGHT`/`RULER_HEIGHT` probe values); unmocking it there would need a
 * second, parallel set of fixtures for no benefit.
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { PianoRoll } from '../PianoRoll';

type ProbeNote = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };
type ProbeClip = { id: string; type: 'midi'; startBeat: number; endBeat: number; color?: string };
type ProbeTrack = { id: string; kind: 'midi'; color: string; clips: ProbeClip[] };

type ProbeMidiState = {
    notesByClipId: Record<string, ProbeNote[]>;
    ccByClipId: Record<string, unknown[]>;
    pitchBendByClipId: Record<string, unknown[]>;
};
type ProbeTrackState = { tracks: ProbeTrack[]; selectedTrackId: string | null };

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: unknown[]) => inputs.filter((input) => typeof input === 'string').join(' '),
}));

const { midiState, trackState, toolbarProps } = vi.hoisted(
    (): {
        midiState: ProbeMidiState;
        trackState: ProbeTrackState;
        toolbarProps: { current: Record<string, unknown> | null };
    } => ({
        midiState: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        trackState: { tracks: [], selectedTrackId: null },
        toolbarProps: { current: null },
    })
);

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

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => fallback ?? store.value),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    setNoteVelocity: vi.fn(),
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
        toolbarProps.current = props;
        return <div data-testid="toolbar" />;
    },
}));

vi.mock('../PianoRollContextMenu', () => ({
    PianoRollContextMenu: () => <div data-testid="context-menu" />,
}));

vi.mock('../../AutomationLane/NotePropertyLane', () => ({
    NotePropertyLane: () => <div data-testid="note-property-lane" />,
}));

vi.mock('#/components/daw/DawGridHeaderCell', () => ({
    DawGridHeaderCell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/daw/DawSideRail', () => ({
    DawSideRail: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('PianoRoll grid extent (real pianoRollConstants)', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        onSelectedNoteIdsChange: vi.fn(),
    };

    it('floors the reported content width at the GRID_BEATS minimum for an empty, just-created clip', () => {
        midiState.notesByClipId = {};
        trackState.tracks = [];

        const onContentWidthChange = vi.fn();
        render(<PianoRoll {...defaultProps} onContentWidthChange={onContentWidthChange} />);

        // beatWidth = 40 (zoom=1). No clip in the store and no notes → floor
        // is GRID_BEATS(32) rounded to a bar (already 32) + 1 trailing bar
        // (4 beats) = 36 beats. 36 * 40 = 1440.
        expect(onContentWidthChange).toHaveBeenCalledWith(1440);
    });

    // Evidence for issue #2299: a MIDI clip longer than eight bars at 4/4
    // (32 beats) holding a note past beat 32 used to report a content width
    // frozen at the GRID_BEATS constant, leaving the note's tail outside the
    // scrollable canvas — unreachable to select, move, resize, or delete.
    it('reports a content width that covers a note past beat 32 on a clip longer than eight bars', () => {
        const lateNote: ProbeNote = { id: 'n1', pitch: 60, startBeat: 36, duration: 2, velocity: 100 };
        midiState.notesByClipId = { 'clip-1': [lateNote] };
        trackState.tracks = [
            {
                id: 'track-1',
                kind: 'midi',
                color: 'oklch(0.5 0.1 200)',
                clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 40 }],
            },
        ];

        const onContentWidthChange = vi.fn();
        render(<PianoRoll {...defaultProps} onContentWidthChange={onContentWidthChange} />);

        // clip length 40, furthest note end 38 (36+2), GRID_BEATS floor 32 →
        // max is 40, already a bar boundary (÷4), + 1 trailing bar (4) = 44
        // beats. beatWidth = 40 (zoom=1) → 44 * 40 = 1760.
        const reportedWidth = onContentWidthChange.mock.calls.at(-1)?.[0] as number;
        expect(reportedWidth).toBe(1760);

        // The decisive assertion: the reported width must reach past the
        // note's own end position (38 beats * 40px = 1520), which is exactly
        // what GRID_BEATS(32) * 40 = 1280 failed to do.
        const noteEndPx = (lateNote.startBeat + lateNote.duration) * 40;
        expect(reportedWidth).toBeGreaterThanOrEqual(noteEndPx);
    });

    // A9 multi-clip editing (ClipView.tsx's `openedClipIds`) draws a second
    // clip's notes in the piano roll's same absolute beat coordinate space,
    // and those notes are editable — not read-only ghosts. An extent derived
    // from only the primary clip reproduces the exact "tail outside the
    // canvas, unreachable by mouse" bug this component exists to fix, just
    // through the opened clip instead of a long primary one.
    it('reports a content width that covers a note on an opened clip past the primary clip extent', () => {
        const openedNote: ProbeNote = { id: 'o1', pitch: 60, startBeat: 50, duration: 2, velocity: 100 };
        midiState.notesByClipId = { 'clip-1': [], 'clip-2': [openedNote] };
        trackState.tracks = [
            {
                id: 'track-1',
                kind: 'midi',
                color: 'oklch(0.5 0.1 200)',
                clips: [
                    { id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 8 },
                    { id: 'clip-2', type: 'midi', startBeat: 0, endBeat: 8 },
                ],
            },
        ];

        const onContentWidthChange = vi.fn();
        render(
            <PianoRoll
                {...defaultProps}
                openedClipIds={['clip-1', 'clip-2']}
                onContentWidthChange={onContentWidthChange}
            />
        );

        // primary clip length 8, opened clip length 8, furthest note end 52
        // (50+2), GRID_BEATS floor 32 → max is 52, rounds up to bar 52
        // (already aligned), + 1 trailing bar (4) = 56 beats. beatWidth = 40
        // (zoom=1) → 56 * 40 = 2240.
        const reportedWidth = onContentWidthChange.mock.calls.at(-1)?.[0] as number;
        expect(reportedWidth).toBe(2240);

        // The decisive assertion: the reported width must reach past the
        // opened clip's own note end position (52 beats * 40px = 2080) —
        // an extent computed from the primary clip alone (length 8, floored
        // at GRID_BEATS(32) * 40 = 1280) would fail this.
        const openedNoteEndPx = (openedNote.startBeat + openedNote.duration) * 40;
        expect(reportedWidth).toBeGreaterThanOrEqual(openedNoteEndPx);
    });

    // The decisive case for issue #2299. The layout extent is what the scroll
    // container and the expression lane span, so a beat missing from it cannot
    // be scrolled to, selected, dragged or resized at all.
    //
    // Pinning one `pixelsPerBeat` (the old tests all used beatWidth 40 at
    // devicePixelRatio 1) cannot observe a ceiling that is a *pixel* budget:
    // such a ceiling only engages once zoom and display density push
    // `beats * beatWidth * devicePixelRatio` past the budget, which 40 never
    // does. That blind spot is why an extent ceiling shipped twice. This
    // sweeps the zoom levels the toolbar actually offers across the display
    // densities the app actually runs on, and asserts against the clip's own
    // length rather than a computed expectation — so it stays decisive
    // whatever rule replaces the one under test.
    describe('reachability across zoom and device pixel ratio', () => {
        /** 64 bars at 4/4 — an unremarkable arrangement-length MIDI clip. */
        const LONG_CLIP_BEATS = 256;
        const originalDevicePixelRatio = window.devicePixelRatio;

        afterEach(() => {
            Object.defineProperty(window, 'devicePixelRatio', {
                value: originalDevicePixelRatio,
                configurable: true,
            });
        });

        const cases = [1, 2, 3].flatMap((devicePixelRatio) => [2, 4].map((zoom) => ({ devicePixelRatio, zoom })));

        it.each(cases)(
            'keeps every beat of a 256-beat clip inside the layout extent at zoom $zoom on a $devicePixelRatio x display',
            ({ devicePixelRatio, zoom }) => {
                Object.defineProperty(window, 'devicePixelRatio', {
                    value: devicePixelRatio,
                    configurable: true,
                });
                midiState.notesByClipId = { 'clip-1': [] };
                trackState.tracks = [
                    {
                        id: 'track-1',
                        kind: 'midi',
                        color: 'oklch(0.5 0.1 200)',
                        clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: LONG_CLIP_BEATS }],
                    },
                ];

                const onContentWidthChange = vi.fn();
                render(<PianoRoll {...defaultProps} onContentWidthChange={onContentWidthChange} />);
                const onZoomChange = toolbarProps.current?.onZoomChange as ((next: number) => void) | undefined;
                expect(onZoomChange).toBeTypeOf('function');
                act(() => {
                    onZoomChange?.(zoom);
                });

                // PianoRoll's own zoom→beatWidth rule: max(1, 40 * zoom).
                const beatWidth = 40 * zoom;
                const reportedWidth = onContentWidthChange.mock.calls.at(-1)?.[0] as number;
                expect(reportedWidth).toBeGreaterThanOrEqual(LONG_CLIP_BEATS * beatWidth);
            }
        );
    });
});
