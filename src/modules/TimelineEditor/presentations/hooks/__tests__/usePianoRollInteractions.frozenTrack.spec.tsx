import { type ReactElement, useRef } from 'react';

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { usePianoRollInteractions } from '../usePianoRollInteractions';

const mocks = vi.hoisted(() => ({
    writes: {
        addMidiNote: vi.fn(),
        batchAddMidiNotes: vi.fn(),
        removeMidiNote: vi.fn(),
        moveMidiNote: vi.fn(),
        removeNotesByIds: vi.fn(),
        replaceMidiNotesIfUnchanged: vi.fn(),
        restoreMidiNoteMembershipIfUnchanged: vi.fn(),
        resizeMidiNote: vi.fn(),
        setNoteVelocity: vi.fn(),
        setNotesForClip: vi.fn(),
        stampChord: vi.fn(),
        joinNotes: vi.fn(),
        legatoNotes: vi.fn(),
        splitNoteAtBeat: vi.fn(),
        stepRecordNoteOn: vi.fn(),
        stepRecordNoteOff: vi.fn(),
        pushUndoEntry: vi.fn(),
    },
    getNotesForClip: vi.fn(),
    notifyUser: vi.fn(),
    trackState: { tracks: [] as Array<{ id: string; frozen: boolean; clips: Array<{ id: string }> }> },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackState;
        },
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: { beginAudioPreviewIntent: vi.fn() },
    playAuditionNote: vi.fn(() => vi.fn()),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: mocks.writes.pushUndoEntry,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

vi.mock('#/modules/MIDI/useCases', () => ({
    ...mocks.writes,
    getNotesForClip: mocks.getNotesForClip,
    stepRecordAdvance: vi.fn(),
    stepRecordRetreat: vi.fn(),
    stepRecordStepUp: vi.fn(),
    stepRecordStepDown: vi.fn(),
}));

vi.mock('#/modules/Preferences/stores', () => ({ preferencesStore: { value: { defaultVelocity: 90 } } }));

type HookArgs = Parameters<typeof usePianoRollInteractions>[0];
type HarnessArgs = Omit<HookArgs, 'canvasRef'>;

const ROW = 16;
const RULER = 22;
const yForPitch = (pitch: number): number => RULER + (127 - pitch) * ROW + 8;
const FROZEN_MESSAGE = 'This track is frozen. Unfreeze it to edit its notes.';
const NOTE = { id: 'n1', pitch: 60, startBeat: 2, duration: 2, velocity: 100 };

const Harness = ({ args }: { args: HarnessArgs }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const handlers = usePianoRollInteractions({ ...args, canvasRef });
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
        />
    );
};

const renderRoll = (overrides: Partial<HarnessArgs> = {}): HTMLElement => {
    const args: HarnessArgs = {
        scrollRef: { current: null },
        clipId: 'clip-1',
        trackId: 'track-1',
        notes: [NOTE],
        beatWidth: 40,
        rowHeight: ROW,
        gridSnap: 1,
        scaleType: 'chromatic',
        scaleRoot: 0,
        isFolded: false,
        stepInput: false,
        stepBeat: 4,
        setStepBeat: vi.fn(),
        chordMode: false,
        chordType: 'major',
        paintMode: false,
        lassoMode: false,
        selectedNoteIds: new Set<string>(),
        setSelectedNoteIds: vi.fn(),
        setZoom: vi.fn(),
        draw: vi.fn(),
        constrainToScale: false,
        notePreviewEnabled: false,
        drawPreviewRef: { current: null },
        rubberBandRef: { current: null },
        lassoPathRef: { current: null },
        dragPreviewRef: { current: null },
        ...overrides,
    };
    render(<Harness args={args} />);
    return screen.getByLabelText('piano-roll-test-surface');
};

const writeCallCount = (): number =>
    Object.values(mocks.writes).reduce((total, writer) => total + writer.mock.calls.length, 0);

const frozenWarnings = (): unknown[][] =>
    mocks.notifyUser.mock.calls.filter((call) => call[0] === FROZEN_MESSAGE && call[1] === 'warning');

type Gesture = {
    name: string;
    overrides?: Partial<HarnessArgs>;
    perform: (canvas: HTMLElement) => void;
};

const gestures: Gesture[] = [
    {
        name: 'drawing a note with a click',
        perform: (canvas) => {
            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });
        },
    },
    {
        name: 'painting notes',
        overrides: { paintMode: true, notes: [] },
        perform: (canvas) => {
            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            fireEvent.mouseMove(canvas, { clientX: 125, clientY: yForPitch(70) });
            fireEvent.mouseUp(canvas, { clientX: 125, clientY: yForPitch(70) });
        },
    },
    {
        name: 'step-input entry',
        overrides: { stepInput: true, notes: [] },
        perform: (canvas) => {
            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
        },
    },
    {
        name: 'stamping a chord',
        overrides: { chordMode: true, notes: [] },
        perform: (canvas) => {
            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });
        },
    },
    {
        name: 'moving a note',
        perform: (canvas) => {
            fireEvent.mouseDown(canvas, { clientX: 120, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 200, clientY: yForPitch(60) });
            fireEvent.mouseUp(canvas, { clientX: 200, clientY: yForPitch(60) });
        },
    },
    {
        name: 'resizing a note from its right edge',
        perform: (canvas) => {
            fireEvent.mouseDown(canvas, { clientX: 155, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 195, clientY: yForPitch(60) });
            fireEvent.mouseUp(canvas, { clientX: 195, clientY: yForPitch(60) });
        },
    },
    {
        name: 'duplicating a note with an alt-drag',
        perform: (canvas) => {
            fireEvent.mouseDown(canvas, { clientX: 120, clientY: yForPitch(60), altKey: true });
            fireEvent.mouseMove(canvas, { clientX: 200, clientY: yForPitch(60), altKey: true });
            fireEvent.mouseUp(canvas, { clientX: 200, clientY: yForPitch(60), altKey: true });
        },
    },
    {
        name: 'deleting a note by double click',
        perform: (canvas) => {
            fireEvent.doubleClick(canvas, { clientX: 120, clientY: yForPitch(60) });
        },
    },
    {
        name: 'deleting the selection with Delete',
        overrides: { selectedNoteIds: new Set(['n1']) },
        perform: (canvas) => {
            fireEvent.keyDown(canvas, { key: 'Delete' });
        },
    },
    {
        name: 'nudging the selection with an arrow key',
        overrides: { selectedNoteIds: new Set(['n1']) },
        perform: (canvas) => {
            fireEvent.keyDown(canvas, { key: 'ArrowRight' });
        },
    },
    {
        name: 'duplicating the selection with Ctrl+D',
        overrides: { selectedNoteIds: new Set(['n1']) },
        perform: (canvas) => {
            fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true });
        },
    },
    {
        name: 'setting velocity with a step-input preset key',
        overrides: { selectedNoteIds: new Set(['n1']), stepInput: true },
        perform: (canvas) => {
            fireEvent.keyDown(canvas, { key: '3' });
        },
    },
];

describe('usePianoRollInteractions on a frozen track', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The store the gesture reads: the note as it was, then as the write left it.
        let reads = 0;
        mocks.getNotesForClip.mockImplementation(() => {
            reads += 1;
            return [reads % 2 === 1 ? NOTE : { ...NOTE, duration: 3 }];
        });
        mocks.writes.addMidiNote.mockImplementation((_clipId, pitch, startBeat, duration, velocity) => ({
            id: 'new-note',
            pitch,
            startBeat,
            duration,
            velocity,
        }));
        mocks.writes.stampChord.mockReturnValue([{ id: 'chord-note' }]);
        mocks.writes.batchAddMidiNotes.mockReturnValue([{ id: 'copy-note' }]);
    });

    afterEach(() => {
        cleanup();
    });

    describe.each(gestures)('$name', ({ overrides, perform }) => {
        it('writes nothing and warns once when the clip track is frozen', () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];

            perform(renderRoll(overrides));

            expect(writeCallCount()).toBe(0);
            expect(frozenWarnings()).toHaveLength(1);
        });

        it('still writes with no frozen warning when the track is not frozen', () => {
            mocks.trackState.tracks = [{ id: 'track-1', frozen: false, clips: [{ id: 'clip-1' }] }];

            perform(renderRoll(overrides));

            expect(writeCallCount()).toBeGreaterThan(0);
            expect(frozenWarnings()).toHaveLength(0);
        });
    });

    it('lets a click on a note select it without a warning on a frozen track', () => {
        mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];
        const setSelectedNoteIds = vi.fn();

        const canvas = renderRoll({ setSelectedNoteIds });
        fireEvent.mouseDown(canvas, { clientX: 120, clientY: yForPitch(60) });
        fireEvent.mouseUp(canvas, { clientX: 120, clientY: yForPitch(60) });

        expect(setSelectedNoteIds).toHaveBeenCalledWith(new Set(['n1']));
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(writeCallCount()).toBe(0);
    });

    it('lets a rubber-band drag on empty grid select without a warning on a frozen track', () => {
        mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];
        const setSelectedNoteIds = vi.fn();

        const canvas = renderRoll({ setSelectedNoteIds, rubberBandRef: { current: null } });
        fireEvent.mouseDown(canvas, { clientX: 60, clientY: yForPitch(70) });
        fireEvent.mouseMove(canvas, { clientX: 260, clientY: yForPitch(40) });
        fireEvent.mouseUp(canvas, { clientX: 260, clientY: yForPitch(40) });

        expect(setSelectedNoteIds).toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(writeCallCount()).toBe(0);
    });
});
