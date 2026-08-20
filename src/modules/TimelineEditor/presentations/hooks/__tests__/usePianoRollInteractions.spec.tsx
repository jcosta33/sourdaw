import { type ReactElement, useEffect, useRef } from 'react';

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { usePianoRollInteractions } from '../usePianoRollInteractions';

const mocks = vi.hoisted(() => {
    let idCounter = 0;
    return {
        nextId: (): string => `gen-${++idCounter}`,
        playAuditionNote: vi.fn(),
        auditionStop: vi.fn(),
        pushUndoEntry: vi.fn(),
        addMidiNote: vi.fn(),
        batchAddMidiNotes: vi.fn(),
        getNotesForClip: vi.fn(),
        removeMidiNote: vi.fn(),
        moveMidiNote: vi.fn(),
        removeNotesByIds: vi.fn(),
        resizeMidiNote: vi.fn(),
        setNoteVelocity: vi.fn(),
        setNotesForClip: vi.fn(),
        stampChord: vi.fn(),
        joinNotes: vi.fn(),
        legatoNotes: vi.fn(),
        splitNoteAtBeat: vi.fn(),
        stepRecordAdvance: vi.fn(),
        stepRecordRetreat: vi.fn(),
        stepRecordStepUp: vi.fn(),
        stepRecordStepDown: vi.fn(),
        stepRecordNoteOn: vi.fn(),
        stepRecordNoteOff: vi.fn(),
        getTransportState: vi.fn(),
        stepRecordState: { currentPitch: 62 },
        trackState: {
            tracks: [
                {
                    id: 'track-1',
                    kind: 'midi',
                    clips: [{ id: 'clip-1', type: 'midi' }],
                },
                {
                    id: 'track-2',
                    kind: 'midi',
                    clips: [{ id: 'clip-2', type: 'midi' }],
                },
            ],
        },
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackState;
        },
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    playAuditionNote: mocks.playAuditionNote,
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    stepRecordStore: {
        get value() {
            return mocks.stepRecordState;
        },
    },
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: mocks.addMidiNote,
    batchAddMidiNotes: mocks.batchAddMidiNotes,
    getNotesForClip: mocks.getNotesForClip,
    removeMidiNote: mocks.removeMidiNote,
    moveMidiNote: mocks.moveMidiNote,
    removeNotesByIds: mocks.removeNotesByIds,
    resizeMidiNote: mocks.resizeMidiNote,
    setNoteVelocity: mocks.setNoteVelocity,
    setNotesForClip: mocks.setNotesForClip,
    stampChord: mocks.stampChord,
    joinNotes: mocks.joinNotes,
    legatoNotes: mocks.legatoNotes,
    splitNoteAtBeat: mocks.splitNoteAtBeat,
    stepRecordAdvance: mocks.stepRecordAdvance,
    stepRecordRetreat: mocks.stepRecordRetreat,
    stepRecordStepUp: mocks.stepRecordStepUp,
    stepRecordStepDown: mocks.stepRecordStepDown,
    stepRecordNoteOn: mocks.stepRecordNoteOn,
    stepRecordNoteOff: mocks.stepRecordNoteOff,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

type HookArgs = Parameters<typeof usePianoRollInteractions>[0];
type Handlers = ReturnType<typeof usePianoRollInteractions>;
type HarnessArgs = Omit<HookArgs, 'canvasRef'>;
type Note = HookArgs['notes'][number];

// ── Geometry (chromatic scale, unfolded) ─────────────────────────────────
// getVisiblePitches yields pitches 83 → 24 top-to-bottom, ROW_HEIGHT = 16,
// RULER_HEIGHT = 22. Fixture beatWidth = 40, gridSnap = 1.
const ROW = 16;
const RULER = 22;
const BEAT_W = 40;

/** clientY at the vertical middle of the row for a pitch. */
const yForPitch = (pitch: number): number => RULER + (83 - pitch) * ROW + 8;

const makeNote = (id: string, pitch: number, startBeat: number, duration: number, velocity = 100): Note => ({
    id,
    pitch,
    startBeat,
    duration,
    velocity,
});

const latest: { current: Handlers | null } = { current: null };

const Harness = ({ args }: { args: HarnessArgs }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const handlers = usePianoRollInteractions({ ...args, canvasRef });
    useEffect(() => {
        latest.current = handlers;
    });
    return (
        <canvas
            ref={canvasRef}
            aria-label="piano-roll-test-surface"
            tabIndex={0}
            onMouseDown={handlers.handleMouseDown}
            onMouseMove={handlers.handleMouseMove}
            onMouseUp={handlers.handleMouseUp}
            onDoubleClick={handlers.handleDoubleClick}
            onKeyDown={handlers.handleKeyDown}
            onContextMenu={handlers.handleContextMenu}
        />
    );
};

const setSelectedNoteIds = vi.fn();
const setStepBeat = vi.fn();
const setZoom = vi.fn();
const setScrollX = vi.fn();
const draw = vi.fn();

const buildArgs = (overrides: Partial<HarnessArgs> = {}): HarnessArgs => ({
    clipId: 'clip-1',
    trackId: 'track-1',
    notes: [makeNote('n1', 60, 2, 2)],
    beatWidth: BEAT_W,
    gridSnap: 1,
    scaleType: 'chromatic',
    scaleRoot: 0,
    isFolded: false,
    stepInput: false,
    stepBeat: 4,
    setStepBeat,
    chordMode: false,
    chordType: 'major',
    paintMode: false,
    lassoMode: false,
    selectedNoteIds: new Set<string>(),
    setSelectedNoteIds,
    setZoom,
    setScrollX,
    draw,
    constrainToScale: false,
    notePreviewEnabled: false,
    drawPreviewRef: { current: null },
    rubberBandRef: { current: null },
    dragPreviewRef: { current: null },
    ...overrides,
});

const renderRoll = (overrides: Partial<HarnessArgs> = {}): { canvas: HTMLElement; args: HarnessArgs } => {
    const args = buildArgs(overrides);
    render(<Harness args={args} />);
    return { canvas: screen.getByLabelText('piano-roll-test-surface'), args };
};

describe('usePianoRollInteractions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addMidiNote.mockImplementation((_clipId, pitch, startBeat, duration, velocity) => ({
            id: mocks.nextId(),
            pitch,
            startBeat,
            duration,
            velocity,
        }));
        mocks.batchAddMidiNotes.mockImplementation((_clipId, list: Array<Omit<Note, 'id'>>) =>
            list.map((entry) => ({ id: mocks.nextId(), ...entry }))
        );
        mocks.getNotesForClip.mockReturnValue([]);
        mocks.playAuditionNote.mockReturnValue(mocks.auditionStop);
        mocks.getTransportState.mockReturnValue({ playheadPosition: 2.5 });
        mocks.stepRecordState = { currentPitch: 62 };
        latest.current = null;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('note stamping and selection', () => {
        it('stamps a note at the clicked grid cell on click without drag', () => {
            const { canvas } = renderRoll();

            // Empty cell: pitch 70, x = 45px → beat snaps to 1
            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });

            expect(mocks.addMidiNote).toHaveBeenCalledWith('clip-1', 70, 1, 1, 100);
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Draw MIDI note',
                expect.any(Function),
                expect.any(Function)
            );
            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set());
        });

        it('undo of a stamped note removes exactly the created note', () => {
            const { canvas } = renderRoll();
            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });
            const createdId = mocks.addMidiNote.mock.results[0]?.value.id;

            const undoFn = mocks.pushUndoEntry.mock.calls[0]?.[1];
            undoFn();

            expect(mocks.removeMidiNote).toHaveBeenCalledWith('clip-1', createdId);
        });

        it('ignores mouse-down inside the beat ruler strip', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 45, clientY: 10 });
            fireEvent.mouseUp(canvas, { clientX: 45, clientY: 10 });

            expect(mocks.addMidiNote).not.toHaveBeenCalled();
            expect(setSelectedNoteIds).not.toHaveBeenCalled();
        });

        it('selects the note under the cursor on body mouse-down and auditions it', () => {
            const { canvas } = renderRoll();

            // n1 body: beats 2–4 at pitch 60 → x 88–152
            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(60) });

            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set(['n1']));
            expect(mocks.playAuditionNote).toHaveBeenCalledWith('track-1', 60, 100);
        });

        it('shift-click toggles note membership in the selection', () => {
            const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(60), shiftKey: true });

            const updater = setSelectedNoteIds.mock.calls[0]?.[0];
            expect(typeof updater).toBe('function');
            expect(updater(new Set(['n1']))).toEqual(new Set());
            expect(updater(new Set())).toEqual(new Set(['n1']));
        });

        it('stops the audition when the mouse is released', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(60) });
            expect(mocks.auditionStop).not.toHaveBeenCalled();

            fireEvent.mouseUp(canvas, { clientX: 100, clientY: yForPitch(60) });
            expect(mocks.auditionStop).toHaveBeenCalledTimes(1);
        });
    });

    describe('rubber-band selection', () => {
        it('selects intersecting notes on a meaningful drag and never stamps', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 60, clientY: yForPitch(70) });
            fireEvent.mouseMove(canvas, { clientX: 200, clientY: yForPitch(58) });
            fireEvent.mouseUp(canvas, { clientX: 200, clientY: yForPitch(58) });

            expect(setSelectedNoteIds).toHaveBeenLastCalledWith(new Set(['n1']));
            expect(mocks.addMidiNote).not.toHaveBeenCalled();
        });

        it('merges into the previous selection when shift is held on release', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 60, clientY: yForPitch(70) });
            fireEvent.mouseMove(canvas, { clientX: 200, clientY: yForPitch(58) });
            fireEvent.mouseUp(canvas, { clientX: 200, clientY: yForPitch(58), shiftKey: true });

            const updater = setSelectedNoteIds.mock.lastCall?.[0];
            expect(typeof updater).toBe('function');
            expect(updater(new Set(['other']))).toEqual(new Set(['other', 'n1']));
        });

        it('alt-drag in empty space is select-only: no stamp on a still click', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 300, clientY: yForPitch(70), altKey: true });
            fireEvent.mouseUp(canvas, { clientX: 300, clientY: yForPitch(70) });

            expect(mocks.addMidiNote).not.toHaveBeenCalled();
            // Selection cleared both on mouse-down (non-shift alt) and on release
            expect(setSelectedNoteIds).toHaveBeenLastCalledWith(new Set());
        });

        it('also picks up notes from other opened clips', () => {
            const { canvas } = renderRoll({
                openedClipNotes: { 'clip-2': [makeNote('n2', 62, 1, 1)] },
            });

            fireEvent.mouseDown(canvas, { clientX: 10, clientY: yForPitch(70) });
            fireEvent.mouseMove(canvas, { clientX: 200, clientY: yForPitch(58) });
            fireEvent.mouseUp(canvas, { clientX: 200, clientY: yForPitch(58) });

            expect(setSelectedNoteIds).toHaveBeenLastCalledWith(new Set(['n1', 'n2']));
        });
    });

    describe('move, duplicate, and resize drags', () => {
        it('moving a note commits the new position and pushes an undo entry', () => {
            const { args, canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 140, clientY: yForPitch(60) });

            expect(args.dragPreviewRef.current).toEqual({
                noteIds: new Set(['n1']),
                beatDelta: 1,
                pitchDelta: 0,
                isDuplicate: false,
            });
            expect(draw).toHaveBeenCalled();

            fireEvent.mouseUp(canvas, { clientX: 140, clientY: yForPitch(60) });

            expect(mocks.moveMidiNote).toHaveBeenCalledWith('clip-1', 'n1', 60, 3);
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith('Move 1 note', expect.any(Function), expect.any(Function));
            expect(args.dragPreviewRef.current).toBeNull();
        });

        it('dragging one row up transposes the note a semitone', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 100, clientY: yForPitch(60) - ROW });
            fireEvent.mouseUp(canvas, { clientX: 100, clientY: yForPitch(60) - ROW });

            expect(mocks.moveMidiNote).toHaveBeenCalledWith('clip-1', 'n1', 61, 2);
        });

        it('alt-drag duplicates: original stays, copy lands at the offset position', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(60), altKey: true });
            fireEvent.mouseMove(canvas, { clientX: 140, clientY: yForPitch(60), altKey: true });
            fireEvent.mouseUp(canvas, { clientX: 140, clientY: yForPitch(60), altKey: true });

            expect(mocks.moveMidiNote).not.toHaveBeenCalled();
            expect(mocks.batchAddMidiNotes).toHaveBeenCalledWith('clip-1', [
                { pitch: 60, startBeat: 3, duration: 2, velocity: 100 },
            ]);
            const copyId = mocks.batchAddMidiNotes.mock.results[0]?.value[0].id;
            expect(setSelectedNoteIds).toHaveBeenLastCalledWith(new Set([copyId]));
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Duplicate 1 note',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('right-edge drag resizes duration and commits via resizeMidiNote', () => {
            const { args, canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 155, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 195, clientY: yForPitch(60) });

            expect(args.dragPreviewRef.current?.durationOverride?.get('n1')).toBe(3);

            fireEvent.mouseUp(canvas, { clientX: 195, clientY: yForPitch(60) });

            expect(mocks.resizeMidiNote).toHaveBeenCalledWith('clip-1', 'n1', undefined, 3);
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Resize MIDI note',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('left-edge drag moves the start and preserves the end beat', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 82, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 42, clientY: yForPitch(60) });
            fireEvent.mouseUp(canvas, { clientX: 42, clientY: yForPitch(60) });

            // start 2 → 1, duration 2 → 3 (end beat 4 unchanged)
            expect(mocks.resizeMidiNote).toHaveBeenCalledWith('clip-1', 'n1', 1, 3);
        });

        it('a drag that returns to the origin commits nothing', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 140, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 100, clientY: yForPitch(60) });
            fireEvent.mouseUp(canvas, { clientX: 100, clientY: yForPitch(60) });

            expect(mocks.moveMidiNote).not.toHaveBeenCalled();
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        });
    });

    describe('paint, chord, lasso, and step-input modes', () => {
        it('paint mode adds a note per crossed grid cell during the drag', () => {
            const { canvas } = renderRoll({ paintMode: true, notes: [] });

            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            expect(mocks.addMidiNote).toHaveBeenCalledWith('clip-1', 70, 1, 1, 100);

            fireEvent.mouseMove(canvas, { clientX: 125, clientY: yForPitch(70) });
            const paintedBeats = mocks.addMidiNote.mock.calls.map((call) => call[2]);
            expect(paintedBeats).toContain(2);
            expect(paintedBeats).toContain(3);

            fireEvent.mouseUp(canvas, { clientX: 125, clientY: yForPitch(70) });
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                expect.stringMatching(/^Paint \d+ notes?$/),
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('chord mode stamps a chord and selects the created notes', () => {
            mocks.stampChord.mockReturnValue([{ id: 'ch1' }, { id: 'ch2' }, { id: 'ch3' }]);
            const { canvas } = renderRoll({ chordMode: true, chordType: 'min7' });

            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });

            expect(mocks.stampChord).toHaveBeenCalledWith('clip-1', 70, 1, 1, 100, 'min7');
            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set(['ch1', 'ch2', 'ch3']));
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Stamp min7 chord',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('step-input click adds a note at the step cursor and advances it', () => {
            const { canvas } = renderRoll({ stepInput: true, stepBeat: 4 });

            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });

            expect(mocks.addMidiNote).toHaveBeenCalledWith('clip-1', 70, 4, 1, 100);
            const advance = setStepBeat.mock.calls[0]?.[0];
            expect(advance(4)).toBe(5);
        });

        it('lasso mode selects notes enclosed by the drawn polygon', () => {
            const { canvas } = renderRoll({ lassoMode: true });

            const above = yForPitch(61);
            const below = yForPitch(59);
            fireEvent.mouseDown(canvas, { clientX: 60, clientY: above });
            fireEvent.mouseMove(canvas, { clientX: 200, clientY: above });
            fireEvent.mouseMove(canvas, { clientX: 200, clientY: below });
            fireEvent.mouseMove(canvas, { clientX: 60, clientY: below });
            fireEvent.mouseUp(canvas, { clientX: 60, clientY: above });

            expect(setSelectedNoteIds).toHaveBeenLastCalledWith(new Set(['n1']));
        });

        it('constrainToScale snaps a stamped pitch to the nearest scale degree', () => {
            const { canvas } = renderRoll({
                notes: [],
                constrainToScale: true,
                scaleType: 'major',
                scaleRoot: 0,
            });

            // Pitch 61 (C#) is not in C major → snaps down to 60 (C)
            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(61) });
            fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(61) });

            expect(mocks.addMidiNote).toHaveBeenCalledWith('clip-1', 60, 1, 1, 100);
        });
    });

    describe('wheel: modifier zoom cancels the browser page default', () => {
        // A cancellable native wheel event is the only way to observe the defect:
        // React registers `wheel` at its root container with `{ passive: true }`,
        // so a `preventDefault()` inside a JSX `onWheel` prop is silently inert
        // and the browser applies its own ctrl+wheel page zoom instead. jsdom
        // enforces the same passive rule, so `defaultPrevented` is a real signal.
        const dispatchWheel = (canvas: HTMLElement, init: WheelEventInit): WheelEvent => {
            const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
            act(() => {
                canvas.dispatchEvent(event);
            });
            return event;
        };

        it('cancels the page default and zooms the editor on ctrl+wheel', () => {
            const { canvas } = renderRoll();

            const event = dispatchWheel(canvas, { ctrlKey: true, deltaY: -100 });

            expect(event.defaultPrevented).toBe(true);
            const zoomUpdater = setZoom.mock.calls[0]?.[0];
            expect(zoomUpdater(1)).toBeCloseTo(1.2);
        });

        it('cancels the page default and zooms the editor on cmd+wheel', () => {
            const { canvas } = renderRoll();

            const event = dispatchWheel(canvas, { metaKey: true, deltaY: -100 });

            expect(event.defaultPrevented).toBe(true);
            const zoomUpdater = setZoom.mock.calls[0]?.[0];
            expect(zoomUpdater(1)).toBeCloseTo(1.2);
        });

        it('leaves shift+wheel and plain wheel to the native scroll container', () => {
            const { canvas } = renderRoll();

            const shiftEvent = dispatchWheel(canvas, { shiftKey: true, deltaY: 60 });
            expect(shiftEvent.defaultPrevented).toBe(false);

            const plainEvent = dispatchWheel(canvas, { deltaY: 60 });
            expect(plainEvent.defaultPrevented).toBe(false);

            expect(setZoom).not.toHaveBeenCalled();
        });
    });

    describe('wheel and hover', () => {
        it('ctrl+wheel zooms with clamping and plain wheel scrolls horizontally', () => {
            const { canvas } = renderRoll();

            fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100 });
            const zoomUpdater = setZoom.mock.calls[0]?.[0];
            expect(zoomUpdater(1)).toBeCloseTo(1.2);
            expect(zoomUpdater(4)).toBe(4);

            fireEvent.wheel(canvas, { deltaX: 50 });
            const scrollUpdater = setScrollX.mock.calls[0]?.[0];
            expect(scrollUpdater(0)).toBe(50);
            expect(scrollUpdater(-100)).toBe(0);
        });

        it('reports grab over a note body, ew-resize over edges, crosshair elsewhere', () => {
            const { canvas } = renderRoll();

            fireEvent.mouseMove(canvas, { clientX: 100, clientY: yForPitch(60) });
            expect(latest.current?.hoverCursor).toBe('grab');

            fireEvent.mouseMove(canvas, { clientX: 155, clientY: yForPitch(60) });
            expect(latest.current?.hoverCursor).toBe('ew-resize');

            fireEvent.mouseMove(canvas, { clientX: 300, clientY: yForPitch(60) });
            expect(latest.current?.hoverCursor).toBe('crosshair');
        });

        it('hover preview auditions the note after the 200ms debounce and auto-stops', () => {
            vi.useFakeTimers();
            const { canvas } = renderRoll({ notePreviewEnabled: true });

            fireEvent.mouseMove(canvas, { clientX: 100, clientY: yForPitch(60) });
            expect(mocks.playAuditionNote).not.toHaveBeenCalled();

            act(() => {
                vi.advanceTimersByTime(200);
            });
            expect(mocks.playAuditionNote).toHaveBeenCalledWith('track-1', 60, 100);

            act(() => {
                vi.advanceTimersByTime(500);
            });
            expect(mocks.auditionStop).toHaveBeenCalledTimes(1);
        });

        it('moving off the note before the debounce fires cancels the preview', () => {
            vi.useFakeTimers();
            const { canvas } = renderRoll({ notePreviewEnabled: true });

            fireEvent.mouseMove(canvas, { clientX: 100, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 300, clientY: yForPitch(60) });

            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(mocks.playAuditionNote).not.toHaveBeenCalled();
        });
    });

    describe('keyboard editing', () => {
        it('Delete removes the selected notes across clips and clears the selection', () => {
            const { canvas } = renderRoll({
                selectedNoteIds: new Set(['n1', 'n2']),
                openedClipNotes: { 'clip-2': [makeNote('n2', 62, 1, 1)] },
            });

            fireEvent.keyDown(canvas, { key: 'Delete' });

            expect(mocks.removeMidiNote).toHaveBeenCalledWith('clip-1', 'n1');
            expect(mocks.removeMidiNote).toHaveBeenCalledWith('clip-2', 'n2');
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Delete 2 notes',
                expect.any(Function),
                expect.any(Function)
            );
            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set());
        });

        it('cmd+A selects every note including other opened clips', () => {
            const { canvas } = renderRoll({
                openedClipNotes: { 'clip-2': [makeNote('n2', 62, 1, 1)] },
            });

            fireEvent.keyDown(canvas, { key: 'a', metaKey: true });

            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set(['n1', 'n2']));
        });

        it('cmd+D duplicates the selection forward by its span', () => {
            const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });

            fireEvent.keyDown(canvas, { key: 'd', metaKey: true });

            // n1 spans beats 2–4 → copy starts at 2 + 2
            expect(mocks.batchAddMidiNotes).toHaveBeenCalledWith('clip-1', [
                { pitch: 60, startBeat: 4, duration: 2, velocity: 100 },
            ]);
            const copyId = mocks.batchAddMidiNotes.mock.results[0]?.value[0].id;
            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set([copyId]));
        });

        it('arrow keys nudge and transpose the selection', () => {
            const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });

            fireEvent.keyDown(canvas, { key: 'ArrowRight' });
            expect(mocks.moveMidiNote).toHaveBeenLastCalledWith('clip-1', 'n1', 60, 3);

            fireEvent.keyDown(canvas, { key: 'ArrowUp' });
            expect(mocks.moveMidiNote).toHaveBeenLastCalledWith('clip-1', 'n1', 61, 2);

            fireEvent.keyDown(canvas, { key: 'ArrowUp', shiftKey: true });
            expect(mocks.moveMidiNote).toHaveBeenLastCalledWith('clip-1', 'n1', 72, 2);
        });

        it('L applies legato to the selected notes with undo based on durations', () => {
            mocks.getNotesForClip.mockReturnValue([makeNote('n1', 60, 2, 4)]);
            const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });

            fireEvent.keyDown(canvas, { key: 'l' });

            expect(mocks.legatoNotes).toHaveBeenCalledWith('clip-1', ['n1']);
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Legato notes',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('J does not join when only one note is selected', () => {
            const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });

            fireEvent.keyDown(canvas, { key: 'j' });

            expect(mocks.joinNotes).not.toHaveBeenCalled();
        });

        it('J joins the selection when at least two notes are selected', () => {
            const twoNotes = [makeNote('n1', 60, 2, 2), makeNote('n3', 60, 4, 2)];
            const { canvas } = renderRoll({ notes: twoNotes, selectedNoteIds: new Set(['n1', 'n3']) });
            fireEvent.keyDown(canvas, { key: 'j' });
            expect(mocks.joinNotes).toHaveBeenCalledWith('clip-1', expect.arrayContaining(['n1', 'n3']));
            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set());
        });

        it('shift+S splits the selected notes at the transport playhead', () => {
            const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });

            fireEvent.keyDown(canvas, { key: 'S', shiftKey: true });

            expect(mocks.splitNoteAtBeat).toHaveBeenCalledWith('clip-1', ['n1'], 2.5);
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Split notes at cursor',
                expect.any(Function),
                expect.any(Function)
            );
            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set());
        });

        it('step-input keys drive the step recorder', () => {
            const { canvas } = renderRoll({ stepInput: true });

            fireEvent.keyDown(canvas, { key: 'ArrowRight' });
            expect(mocks.stepRecordAdvance).toHaveBeenCalledTimes(1);

            fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
            expect(mocks.stepRecordRetreat).toHaveBeenCalledTimes(1);

            fireEvent.keyDown(canvas, { key: 'ArrowUp' });
            expect(mocks.stepRecordStepUp).toHaveBeenCalledTimes(1);

            fireEvent.keyDown(canvas, { key: 'ArrowDown' });
            expect(mocks.stepRecordStepDown).toHaveBeenCalledTimes(1);

            fireEvent.keyDown(canvas, { key: ' ', ctrlKey: true });
            expect(mocks.stepRecordNoteOn).toHaveBeenCalledWith(62);
            expect(mocks.stepRecordNoteOff).toHaveBeenCalledWith(62);
        });

        it('velocity preset digits set velocity on the selection in step-input mode', () => {
            const { canvas } = renderRoll({ stepInput: true, selectedNoteIds: new Set(['n1']) });

            fireEvent.keyDown(canvas, { key: '5' });

            expect(mocks.setNoteVelocity).toHaveBeenCalledWith('clip-1', 'n1', 90);
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Set velocity',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('velocity preset digits set velocity on cross-clip selection in their respective owner clips', () => {
            const { canvas } = renderRoll({
                stepInput: true,
                selectedNoteIds: new Set(['n1', 'n2']),
                openedClipNotes: {
                    'clip-2': [makeNote('n2', 65, 4, 2, 80)],
                },
            });

            fireEvent.keyDown(canvas, { key: '5' });

            expect(mocks.setNoteVelocity).toHaveBeenCalledWith('clip-1', 'n1', 90);
            expect(mocks.setNoteVelocity).toHaveBeenCalledWith('clip-2', 'n2', 90);
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Set velocity',
                expect.any(Function),
                expect.any(Function)
            );

            // The undo/redo closures must act on each note's own owner clip, not
            // the primary clip — invoke them and assert against the real targets.
            mocks.setNoteVelocity.mockClear();
            const undoFn = mocks.pushUndoEntry.mock.calls[0]?.[1];
            undoFn();
            expect(mocks.setNoteVelocity).toHaveBeenCalledWith('clip-1', 'n1', 100);
            expect(mocks.setNoteVelocity).toHaveBeenCalledWith('clip-2', 'n2', 80);

            mocks.setNoteVelocity.mockClear();
            const redoFn = mocks.pushUndoEntry.mock.calls[0]?.[2];
            redoFn();
            expect(mocks.setNoteVelocity).toHaveBeenCalledWith('clip-1', 'n1', 90);
            expect(mocks.setNoteVelocity).toHaveBeenCalledWith('clip-2', 'n2', 90);
        });
    });

    describe('cross-clip audition', () => {
        it('auditioning a secondary-clip note plays through its own track instrument on mousedown', () => {
            const { canvas } = renderRoll({
                openedClipNotes: {
                    'clip-2': [makeNote('n2', 65, 4, 2, 80)],
                },
            });

            fireEvent.mouseDown(canvas, { clientX: 180, clientY: yForPitch(65) });

            expect(mocks.playAuditionNote).toHaveBeenCalledWith('track-2', 65, 80);
        });

        it('hovering a secondary-clip note plays the preview through its own track instrument', () => {
            vi.useFakeTimers();
            const { canvas } = renderRoll({
                notePreviewEnabled: true,
                openedClipNotes: {
                    'clip-2': [makeNote('n2', 65, 4, 2, 80)],
                },
            });

            fireEvent.mouseMove(canvas, { clientX: 180, clientY: yForPitch(65) });
            expect(mocks.playAuditionNote).not.toHaveBeenCalled();

            act(() => {
                vi.advanceTimersByTime(200);
            });

            expect(mocks.playAuditionNote).toHaveBeenCalledWith('track-2', 65, 80);
        });
    });

    describe('double-click and context menu', () => {
        it('double-clicking a note deletes it with an undo entry', () => {
            const { canvas } = renderRoll();

            fireEvent.doubleClick(canvas, { clientX: 100, clientY: yForPitch(60) });

            expect(mocks.removeMidiNote).toHaveBeenCalledWith('clip-1', 'n1');
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Delete MIDI note',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('context menu opens at the cursor with the beat under it', () => {
            const { canvas } = renderRoll();

            fireEvent.contextMenu(canvas, { clientX: 100, clientY: 200 });

            expect(latest.current?.ctxMenu).toEqual({ x: 100, y: 200, beat: 2.5 });
        });
    });

    describe('cross-clip hit-test z-order', () => {
        // The renderer paints secondary opened clips in openedClipIds order
        // (later clip on top) and the primary clip's notes last of all, so the
        // primary is always topmost. Hit-testing must resolve overlap the same
        // way: the topmost visibly painted note wins the click.
        const overlappingSecondaries = {
            openedClipNotes: {
                'clip-2': [makeNote('under', 55, 2, 2)],
                'clip-3': [makeNote('over', 55, 2, 2)],
            },
        };

        it('a primary-clip note painted over a secondary note receives the click', () => {
            const { canvas } = renderRoll({
                openedClipNotes: { 'clip-2': [makeNote('n2', 60, 2, 2)] },
            });

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(60) });

            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set(['n1']));
        });

        it('the topmost-painted secondary note receives the click, not the hidden one', () => {
            const { canvas } = renderRoll(overlappingSecondaries);

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: yForPitch(55) });

            expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set(['over']));
        });

        it('double-click deletes the topmost-painted secondary note from its owner clip', () => {
            const { canvas } = renderRoll(overlappingSecondaries);

            fireEvent.doubleClick(canvas, { clientX: 100, clientY: yForPitch(55) });

            expect(mocks.removeMidiNote).toHaveBeenCalledWith('clip-3', 'over');
            expect(mocks.removeMidiNote).not.toHaveBeenCalledWith('clip-2', 'under');
        });
    });
});
