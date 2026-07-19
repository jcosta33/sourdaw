import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type CommitLegacyCommandUndo, type LegacyCommandMutationRunner } from '#/utils/handlerContract';

import { NotePropertyLane } from '../NotePropertyLane';

const laneMocks = vi.hoisted(() => ({
    commitUndo: vi.fn<CommitLegacyCommandUndo>(),
    midiState: {
        notesByClipId: {} as Record<
            string,
            Array<{ id: string; pitch: number; startBeat: number; duration: number; velocity: number }>
        >,
    },
}));

const replayLegacyMutation: LegacyCommandMutationRunner = async (mutation) => mutation(laneMocks.commitUndo);

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return laneMocks.midiState;
        },
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: { tracks: [] } },
}));

vi.mock('#/modules/Command/useCases', () => {
    return {
        runLegacyCommandMutation: (mutation: (publishUndo: typeof laneMocks.commitUndo) => unknown) =>
            Promise.resolve(mutation(laneMocks.commitUndo)),
    };
});

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#151515'),
}));

vi.mock('../../../helpers/oklchColor', () => ({
    colorWithAlpha: vi.fn((color: string, _alpha: number) => color),
    brightenColor: vi.fn((color: string) => color),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => store.value ?? fallback),
}));

describe('NotePropertyLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        beatWidth: 40,
        contentWidth: 800,
        getValue: (note: { velocity: number }) => note.velocity,
        setValue: vi.fn(),
        label: 'Velocity',
        undoLabel: 'Change velocity',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        laneMocks.midiState = { notesByClipId: {} };
    });

    it('should render without crashing', () => {
        render(<NotePropertyLane {...defaultProps} />);
        expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('should render with correct aria-label', () => {
        render(<NotePropertyLane {...defaultProps} />);
        expect(screen.getByLabelText('Velocity lane')).toBeInTheDocument();
    });

    it('should render canvas element', () => {
        render(<NotePropertyLane {...defaultProps} />);
        expect(screen.getByRole('group').querySelector('canvas')).toBeInTheDocument();
    });

    it('should render with correct label', () => {
        render(<NotePropertyLane {...defaultProps} label="Test Label" />);
        expect(screen.getByLabelText('Test Label lane')).toBeInTheDocument();
    });

    describe('value painting and ramps', () => {
        type LaneNote = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };

        // Shared jsdom 2d-context stub — the same object serves every canvas.
        const ctx2d = document.createElement('canvas').getContext('2d')!;
        let rectSpy: { mockRestore: () => void };

        const makeNote = (id: string, startBeat: number, velocity = 100): LaneNote => ({
            id,
            pitch: 60,
            startBeat,
            duration: 1,
            velocity,
        });

        const seedNotes = (notes: LaneNote[]): void => {
            laneMocks.midiState = { notesByClipId: { 'clip-1': notes } };
        };

        // setValue that behaves like the real use case: mutates the store state
        // so the release handler can diff old vs new values.
        const liveSetValue = vi.fn((clipId: string, noteId: string, value: number): void => {
            const note = (laneMocks.midiState.notesByClipId[clipId] ?? []).find((entry) => entry.id === noteId);
            if (note) {
                note.velocity = value;
            }
        });

        beforeEach(() => {
            // Deterministic geometry: value = round((1 - (clientY - 2) / 127) * 127)
            rectSpy = vi
                .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
                .mockReturnValue(new DOMRect(0, 0, 200, 131));
        });

        afterEach(() => {
            rectSpy.mockRestore();
        });

        const getCanvas = (): HTMLElement => {
            const canvas = screen.getByRole('group').querySelector('canvas');
            expect(canvas).not.toBeNull();
            return canvas!;
        };

        it('draws one bar per note with height proportional to its value', () => {
            const roundRect = vi.spyOn(ctx2d, 'roundRect');
            seedNotes([makeNote('n1', 0, 127)]);

            render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

            // barW = 1 beat * 40px - 2, barH = (127/127) * (131 - 4), barY = 131 - 127 - 2
            expect(roundRect).toHaveBeenCalledWith(1, 2, 38, 127, [2, 2, 0, 0]);
        });

        it('renders an empty-state hint when the clip has no notes', () => {
            const fillText = vi.spyOn(ctx2d, 'fillText');

            render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

            expect(fillText).toHaveBeenCalledWith(
                'No notes — add MIDI to edit velocity',
                expect.any(Number),
                expect.any(Number)
            );
        });

        it('painting a note sets its value from the pointer height and records an undo diff', () => {
            seedNotes([makeNote('n1', 0, 100)]);
            render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

            // clientY = 2 → top of the usable range → value 127
            fireEvent.mouseDown(getCanvas(), { clientX: 10, clientY: 2 });
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n1', 127);

            fireEvent.mouseUp(window, { clientX: 10, clientY: 2 });
            expect(laneMocks.commitUndo).toHaveBeenCalledWith(
                'Change velocity',
                expect.any(Function),
                expect.any(Function)
            );

            const undoFn = laneMocks.commitUndo.mock.calls[0]?.[1];
            expect(undoFn).toBeDefined();
            undoFn!(replayLegacyMutation);
            expect(liveSetValue).toHaveBeenLastCalledWith('clip-1', 'n1', 100);
        });

        it('drag-through paints the note currently under the cursor', () => {
            seedNotes([makeNote('n1', 0, 100), makeNote('n2', 2, 100)]);
            render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

            fireEvent.mouseDown(getCanvas(), { clientX: 10, clientY: 2 });
            // n2 spans x 81–119; clientY 129 → bottom → value 0
            fireEvent.mouseMove(window, { clientX: 90, clientY: 129 });

            expect(liveSetValue).toHaveBeenLastCalledWith('clip-1', 'n2', 0);

            fireEvent.mouseUp(window, { clientX: 90, clientY: 129 });
            expect(laneMocks.commitUndo).toHaveBeenCalledWith(
                'Change velocity',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('shift+drag with a multi-selection applies a linear ramp across the selected notes', () => {
            seedNotes([makeNote('n1', 0, 100), makeNote('n2', 2, 100), makeNote('n3', 4, 100)]);
            render(
                <NotePropertyLane
                    {...defaultProps}
                    setValue={liveSetValue}
                    selectedNoteIds={new Set(['n1', 'n2', 'n3'])}
                />
            );

            fireEvent.mouseDown(getCanvas(), { clientX: 10, clientY: 2, shiftKey: true });

            // anchor 100 → end 127 over 4 beats: n1 = 100, n2 = 114, n3 = 127
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n1', 100);
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n2', 114);
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n3', 127);

            fireEvent.mouseUp(window, { clientX: 10, clientY: 2 });
            expect(laneMocks.commitUndo).toHaveBeenCalledWith(
                'Change velocity ramp',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('shows ramp handles only for a multi-selection', () => {
            seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
            const single = render(
                <NotePropertyLane {...defaultProps} setValue={liveSetValue} selectedNoteIds={new Set(['n1'])} />
            );
            expect(single.container.querySelectorAll('div.cursor-ns-resize')).toHaveLength(0);
            single.unmount();

            const multi = render(
                <NotePropertyLane {...defaultProps} setValue={liveSetValue} selectedNoteIds={new Set(['n1', 'n3'])} />
            );
            expect(multi.container.querySelectorAll('div.cursor-ns-resize')).toHaveLength(2);
            expect(multi.container.querySelector('svg line')).not.toBeNull();
        });

        it('dragging the right ramp handle rewrites the ramp and undoes through setValues', () => {
            seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
            const setValues = vi.fn();
            const { container } = render(
                <NotePropertyLane
                    {...defaultProps}
                    setValue={liveSetValue}
                    setValues={setValues}
                    selectedNoteIds={new Set(['n1', 'n3'])}
                />
            );

            const handles = container.querySelectorAll('div.cursor-ns-resize');
            expect(handles).toHaveLength(2);

            fireEvent.pointerDown(handles[1]!);
            fireEvent.pointerMove(window, { clientY: 2 });

            // left anchor stays at 100, right end pulls to 127
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n1', 100);
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n3', 127);

            fireEvent.pointerUp(window, { clientY: 2 });
            expect(laneMocks.commitUndo).toHaveBeenCalledWith(
                'Change velocity ramp',
                expect.any(Function),
                expect.any(Function)
            );

            const redoFn = laneMocks.commitUndo.mock.lastCall?.[2];
            expect(redoFn).toBeDefined();
            redoFn!(replayLegacyMutation);
            expect(setValues).toHaveBeenCalledWith('clip-1', [{ noteId: 'n3', velocity: 127 }]);
        });
    });
});
