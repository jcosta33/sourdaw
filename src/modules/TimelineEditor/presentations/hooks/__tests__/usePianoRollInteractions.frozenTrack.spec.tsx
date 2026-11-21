import { type ReactElement, useRef } from 'react';

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultStepRecordState, stepRecordStore } from '#/modules/MIDI/stores';

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
    playheadBeat: 1 as number | undefined,
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
vi.mock('../../helpers/clipPlayheadBeat', () => ({ readClipPlayheadBeat: () => mocks.playheadBeat }));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: mocks.writes.addMidiNote,
    batchAddMidiNotes: mocks.writes.batchAddMidiNotes,
    removeMidiNote: mocks.writes.removeMidiNote,
    moveMidiNote: mocks.writes.moveMidiNote,
    removeNotesByIds: mocks.writes.removeNotesByIds,
    replaceMidiNotesIfUnchanged: mocks.writes.replaceMidiNotesIfUnchanged,
    restoreMidiNoteMembershipIfUnchanged: mocks.writes.restoreMidiNoteMembershipIfUnchanged,
    resizeMidiNote: mocks.writes.resizeMidiNote,
    setNoteVelocity: mocks.writes.setNoteVelocity,
    setNotesForClip: mocks.writes.setNotesForClip,
    stampChord: mocks.writes.stampChord,
    joinNotes: mocks.writes.joinNotes,
    legatoNotes: mocks.writes.legatoNotes,
    splitNoteAtBeat: mocks.writes.splitNoteAtBeat,
    stepRecordNoteOn: mocks.writes.stepRecordNoteOn,
    stepRecordNoteOff: mocks.writes.stepRecordNoteOff,
    sliceMidiTakeNoteForEdit: vi.fn(),
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

describe('usePianoRollInteractions with a frozen clip opened beside an unfrozen one', () => {
    const OPENED_NOTE = { id: 'n2', pitch: 72, startBeat: 2, duration: 2, velocity: 100 };
    const withOpenedFrozenClip: Partial<HarnessArgs> = { openedClipNotes: { 'clip-2': [OPENED_NOTE] } };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.playheadBeat = 1;
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
        mocks.trackState.tracks = [
            { id: 'track-1', frozen: false, clips: [{ id: 'clip-1' }] },
            { id: 'track-2', frozen: true, clips: [{ id: 'clip-2' }] },
        ];
    });

    afterEach(() => {
        stepRecordStore.set(defaultStepRecordState);
        cleanup();
    });

    it.each<[string, Partial<HarnessArgs>, (canvas: HTMLElement) => void]>([
        [
            'drawing in the unfrozen target clip',
            {},
            (canvas) => {
                fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
                fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });
            },
        ],
        [
            'moving a note of the unfrozen clip',
            {},
            (canvas) => {
                fireEvent.mouseDown(canvas, { clientX: 120, clientY: yForPitch(60) });
                fireEvent.mouseMove(canvas, { clientX: 200, clientY: yForPitch(60) });
                fireEvent.mouseUp(canvas, { clientX: 200, clientY: yForPitch(60) });
            },
        ],
        [
            'deleting a note of the unfrozen clip',
            { selectedNoteIds: new Set(['n1']) },
            (canvas) => {
                fireEvent.keyDown(canvas, { key: 'Delete' });
            },
        ],
    ])('still writes without a warning when %s', (_name, overrides, perform) => {
        perform(renderRoll({ ...withOpenedFrozenClip, ...overrides }));

        expect(writeCallCount()).toBeGreaterThan(0);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it.each<[string, Partial<HarnessArgs>, (canvas: HTMLElement) => void]>([
        [
            'drawing into the frozen target clip',
            { focusedClipId: 'clip-2' },
            (canvas) => {
                fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
                fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });
            },
        ],
        [
            'moving a note of the frozen clip',
            {},
            (canvas) => {
                fireEvent.mouseDown(canvas, { clientX: 120, clientY: yForPitch(72) });
                fireEvent.mouseMove(canvas, { clientX: 200, clientY: yForPitch(72) });
                fireEvent.mouseUp(canvas, { clientX: 200, clientY: yForPitch(72) });
            },
        ],
        [
            'deleting a note of the frozen clip',
            { selectedNoteIds: new Set(['n2']) },
            (canvas) => {
                fireEvent.keyDown(canvas, { key: 'Delete' });
            },
        ],
        [
            'deleting a selection that spans both clips',
            { selectedNoteIds: new Set(['n1', 'n2']) },
            (canvas) => {
                fireEvent.keyDown(canvas, { key: 'Delete' });
            },
        ],
        [
            'nudging a note of the frozen clip',
            { selectedNoteIds: new Set(['n2']) },
            (canvas) => {
                fireEvent.keyDown(canvas, { key: 'ArrowRight' });
            },
        ],
        [
            'double-clicking a note of the frozen clip',
            {},
            (canvas) => {
                fireEvent.doubleClick(canvas, { clientX: 120, clientY: yForPitch(72) });
            },
        ],
    ])('writes nothing and warns once when %s', (_name, overrides, perform) => {
        perform(renderRoll({ ...withOpenedFrozenClip, ...overrides }));

        expect(writeCallCount()).toBe(0);
        expect(frozenWarnings()).toHaveLength(1);
    });

    it('refuses Ctrl+Space in step input when step recording writes into a frozen clip', () => {
        stepRecordStore.set({ ...defaultStepRecordState, active: true, clipId: 'clip-2' });

        fireEvent.keyDown(renderRoll({ ...withOpenedFrozenClip, stepInput: true }), { key: ' ', ctrlKey: true });

        expect(mocks.writes.stepRecordNoteOn).not.toHaveBeenCalled();
        expect(frozenWarnings()).toHaveLength(1);
    });

    it('still enters a step note with Ctrl+Space when step recording writes into the unfrozen clip', () => {
        stepRecordStore.set({ ...defaultStepRecordState, active: true, clipId: 'clip-1' });

        fireEvent.keyDown(renderRoll({ ...withOpenedFrozenClip, stepInput: true }), { key: ' ', ctrlKey: true });

        expect(mocks.writes.stepRecordNoteOn).toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('refuses Shift+S in step input when the playhead resolves a split beat in a frozen clip', () => {
        const canvas = renderRoll({ ...withOpenedFrozenClip, stepInput: true, selectedNoteIds: new Set(['n2']) });

        fireEvent.keyDown(canvas, { key: 'S', shiftKey: true });

        expect(writeCallCount()).toBe(0);
        expect(frozenWarnings()).toHaveLength(1);
    });

    it('does not warn for Shift+S when the playhead is outside the clip, which splits nothing', () => {
        mocks.playheadBeat = undefined;
        const canvas = renderRoll({ ...withOpenedFrozenClip, selectedNoteIds: new Set(['n2']) });

        fireEvent.keyDown(canvas, { key: 'S', shiftKey: true });

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('does not warn for j with a single note selected, which joins nothing', () => {
        renderRoll({ ...withOpenedFrozenClip, selectedNoteIds: new Set(['n2']) });

        fireEvent.keyDown(screen.getByLabelText('piano-roll-test-surface'), { key: 'j' });

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('does not warn for a zero-movement press and release on a note of the frozen clip', () => {
        const canvas = renderRoll(withOpenedFrozenClip);

        fireEvent.mouseDown(canvas, { clientX: 120, clientY: yForPitch(72) });
        fireEvent.mouseMove(canvas, { clientX: 120, clientY: yForPitch(72) });
        fireEvent.mouseUp(canvas, { clientX: 120, clientY: yForPitch(72) });

        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(writeCallCount()).toBe(0);
    });

    it.each<[string, Partial<HarnessArgs>, Parameters<typeof fireEvent.keyDown>[1]]>([
        [
            'Ctrl+D with nothing selected in an empty frozen clip',
            { notes: [], openedClipNotes: {} },
            { key: 'd', ctrlKey: true },
        ],
        ['legato on a selection spanning two clips', { selectedNoteIds: new Set(['n1', 'n2']) }, { key: 'l' }],
        ['join on a selection spanning two clips', { selectedNoteIds: new Set(['n1', 'n2']) }, { key: 'j' }],
    ])('does not warn for %s, which changes nothing', (_name, overrides, key) => {
        mocks.trackState.tracks = [{ id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] }];

        fireEvent.keyDown(renderRoll({ ...withOpenedFrozenClip, ...overrides }), key);

        expect(writeCallCount()).toBe(0);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
