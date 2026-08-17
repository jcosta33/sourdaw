import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { pushUndoEntry } from '#/modules/Command/useCases';

import { NotePropertyLane } from '../NotePropertyLane';

const laneMocks = vi.hoisted(() => {
    const notesByClipId: Record<
        string,
        Array<{ id: string; pitch: number; startBeat: number; duration: number; velocity: number }>
    > = {};
    return {
        midiState: { notesByClipId },
    };
});

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

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: vi.fn(),
}));

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
            const canvas = getCanvas();

            // clientY = 2 → top of the usable range → value 127
            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n1', 127);

            fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
            expect(pushUndoEntry).toHaveBeenCalledWith('Change velocity', expect.any(Function), expect.any(Function));

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            expect(undoFn).toBeDefined();
            undoFn!();
            expect(liveSetValue).toHaveBeenLastCalledWith('clip-1', 'n1', 100);
        });

        it('hit-tests the topmost (last-painted) note when notes overlap', () => {
            // n1 and n2 share the same startBeat and fully overlap on screen.
            // The paint loop draws array order, so n2 renders on top — the hit
            // test must prefer it, not the first (bottommost) array match.
            seedNotes([makeNote('n1', 0, 100), makeNote('n2', 0, 50)]);
            render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
            const canvas = getCanvas();

            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });

            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n2', 127);
            expect(liveSetValue).not.toHaveBeenCalledWith('clip-1', 'n1', expect.anything());
        });

        it('drag-through paints the note currently under the cursor', () => {
            seedNotes([makeNote('n1', 0, 100), makeNote('n2', 2, 100)]);
            render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
            const canvas = getCanvas();

            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
            // n2 spans x 81–119; clientY 129 → bottom → value 0
            fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 90, clientY: 129 });

            expect(liveSetValue).toHaveBeenLastCalledWith('clip-1', 'n2', 0);

            fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 90, clientY: 129 });
            expect(pushUndoEntry).toHaveBeenCalledWith('Change velocity', expect.any(Function), expect.any(Function));
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
            const canvas = getCanvas();

            fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2, shiftKey: true });

            // anchor 100 → end 127 over 4 beats: n1 = 100, n2 = 114, n3 = 127
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n1', 100);
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n2', 114);
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n3', 127);

            fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
            expect(pushUndoEntry).toHaveBeenCalledWith(
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

            fireEvent.pointerDown(handles[1]!, { pointerId: 3 });
            fireEvent.pointerMove(handles[1]!, { pointerId: 3, clientY: 2 });

            // left anchor stays at 100, right end pulls to 127
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n1', 100);
            expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n3', 127);

            fireEvent.pointerUp(handles[1]!, { pointerId: 3, clientY: 2 });
            expect(pushUndoEntry).toHaveBeenCalledWith(
                'Change velocity ramp',
                expect.any(Function),
                expect.any(Function)
            );

            const redoFn = vi.mocked(pushUndoEntry).mock.lastCall?.[2];
            expect(redoFn).toBeDefined();
            redoFn!();
            expect(setValues).toHaveBeenCalledWith('clip-1', [{ noteId: 'n3', velocity: 127 }]);
        });

        describe('touch, pen, and interrupted drags', () => {
            const readVelocity = (noteId: string): number | undefined =>
                (laneMocks.midiState.notesByClipId['clip-1'] ?? []).find((note) => note.id === noteId)?.velocity;

            const setVisibility = (state: 'visible' | 'hidden'): void => {
                Object.defineProperty(document, 'visibilityState', {
                    configurable: true,
                    get: () => state,
                });
            };

            it('paints from a touch pointer, not only from a mouse', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

                fireEvent.pointerDown(getCanvas(), {
                    pointerId: 7,
                    pointerType: 'touch',
                    clientX: 10,
                    clientY: 2,
                });

                expect(liveSetValue).toHaveBeenCalledWith('clip-1', 'n1', 127);
            });

            it('opts every touch surface out of the browser pan/zoom gesture', () => {
                seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
                const { container } = render(
                    <NotePropertyLane
                        {...defaultProps}
                        setValue={liveSetValue}
                        selectedNoteIds={new Set(['n1', 'n3'])}
                    />
                );

                // Without touch-action: none the browser claims the stroke for panning and
                // cancels it mid-gesture, so touch editing never completes.
                const lane = screen.getByRole('group');
                expect(lane.style.touchAction).toBe('none');
                expect(getCanvas().style.touchAction).toBe('none');

                const handles = container.querySelectorAll<HTMLElement>('div.cursor-ns-resize');
                expect(handles).toHaveLength(2);
                expect(handles[0]!.style.touchAction).toBe('none');
                expect(handles[1]!.style.touchAction).toBe('none');
            });

            it('takes pointer capture before the gesture writes its first value', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                const capture = vi.spyOn(HTMLElement.prototype, 'setPointerCapture');
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

                fireEvent.pointerDown(getCanvas(), { pointerId: 4, clientX: 10, clientY: 2 });

                // A write that lands before the gesture has an owner can be stranded with no
                // undo entry if capture then fails.
                expect(capture.mock.invocationCallOrder[0]!).toBeLessThan(liveSetValue.mock.invocationCallOrder[0]!);
                capture.mockRestore();
            });

            it('takes pointer capture before the shift+drag ramp writes its first value', () => {
                seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
                const capture = vi.spyOn(HTMLElement.prototype, 'setPointerCapture');
                render(
                    <NotePropertyLane
                        {...defaultProps}
                        setValue={liveSetValue}
                        selectedNoteIds={new Set(['n1', 'n3'])}
                    />
                );

                fireEvent.pointerDown(getCanvas(), { pointerId: 4, clientX: 10, clientY: 2, shiftKey: true });

                expect(capture.mock.invocationCallOrder[0]!).toBeLessThan(liveSetValue.mock.invocationCallOrder[0]!);
                capture.mockRestore();
            });

            it('ignores a right-button press so the context menu is not also an edit', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, button: 2, clientX: 10, clientY: 2 });

                expect(liveSetValue).not.toHaveBeenCalled();

                // …and no gesture was latched, so the next primary press still works.
                fireEvent.pointerDown(canvas, { pointerId: 2, button: 0, clientX: 10, clientY: 2 });
                expect(readVelocity('n1')).toBe(127);
            });

            it('ignores a right-button press on a ramp handle', () => {
                seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
                const { container } = render(
                    <NotePropertyLane
                        {...defaultProps}
                        setValue={liveSetValue}
                        selectedNoteIds={new Set(['n1', 'n3'])}
                    />
                );
                const handle = container.querySelectorAll('div.cursor-ns-resize')[1]!;

                fireEvent.pointerDown(handle, { pointerId: 3, button: 2, clientY: 66 });
                fireEvent.pointerMove(handle, { pointerId: 3, clientY: 2 });

                expect(liveSetValue).not.toHaveBeenCalled();
            });

            it('a ramp drag survives the handles unmounting mid-gesture', () => {
                seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
                const view = render(
                    <NotePropertyLane
                        {...defaultProps}
                        setValue={liveSetValue}
                        selectedNoteIds={new Set(['n1', 'n3'])}
                    />
                );
                const handle = view.container.querySelectorAll('div.cursor-ns-resize')[1]!;

                fireEvent.pointerDown(handle, { pointerId: 3, pointerType: 'touch', clientY: 66 });
                fireEvent.pointerMove(handle, { pointerId: 3, clientY: 2 });
                expect(readVelocity('n3')).toBe(127);

                // Selection drops to one note, so both handles — and anything bound to them — unmount.
                view.rerender(
                    <NotePropertyLane {...defaultProps} setValue={liveSetValue} selectedNoteIds={new Set(['n1'])} />
                );
                expect(view.container.querySelectorAll('div.cursor-ns-resize')).toHaveLength(0);

                // The release now lands on the lane itself; it must still commit the gesture.
                fireEvent.pointerUp(screen.getByRole('group'), { pointerId: 3, clientY: 2 });

                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity ramp',
                    expect.any(Function),
                    expect.any(Function)
                );
            });

            it('a paint drag still accepts a release that lands on the lane, not the canvas', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

                fireEvent.pointerDown(getCanvas(), { pointerId: 1, clientX: 10, clientY: 2 });
                fireEvent.pointerUp(screen.getByRole('group'), { pointerId: 1, clientX: 10, clientY: 2 });

                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity',
                    expect.any(Function),
                    expect.any(Function)
                );
            });

            it('losing capture without a release finalizes the gesture', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
                fireEvent.lostPointerCapture(canvas, { pointerId: 1 });

                expect(pushUndoEntry).toHaveBeenCalledTimes(1);

                liveSetValue.mockClear();
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 10, clientY: 129 });
                expect(liveSetValue).not.toHaveBeenCalled();
            });

            it('paints from a pen pointer and follows it across notes', () => {
                seedNotes([makeNote('n1', 0, 100), makeNote('n2', 2, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 9, pointerType: 'pen', clientX: 10, clientY: 2 });
                fireEvent.pointerMove(canvas, { pointerId: 9, pointerType: 'pen', clientX: 90, clientY: 129 });

                expect(readVelocity('n1')).toBe(127);
                expect(readVelocity('n2')).toBe(0);
            });

            it('pointercancel ends the paint drag, commits the undo entry, and stops further painting', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
                // clientY 66 → (1 - 64/127) * 127 = 63
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 10, clientY: 66 });
                expect(readVelocity('n1')).toBe(63);

                fireEvent.pointerCancel(canvas, { pointerId: 1 });
                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity',
                    expect.any(Function),
                    expect.any(Function)
                );

                liveSetValue.mockClear();
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 10, clientY: 129 });
                expect(liveSetValue).not.toHaveBeenCalled();

                // The trailing pointerup the browser still delivers must not commit a second entry.
                fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 129 });
                expect(pushUndoEntry).toHaveBeenCalledTimes(1);
            });

            it('commits the drag even when releasing capture throws', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });

                // Browsers throw InvalidPointerId when capture was already dropped (e.g. on cancel).
                const release = vi.spyOn(canvas, 'releasePointerCapture').mockImplementation(() => {
                    throw new DOMException('InvalidPointerId', 'NotFoundError');
                });
                fireEvent.pointerCancel(canvas, { pointerId: 1 });
                release.mockRestore();

                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity',
                    expect.any(Function),
                    expect.any(Function)
                );
            });

            it('hiding the tab finalizes a latched paint drag', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
                expect(readVelocity('n1')).toBe(127);

                setVisibility('hidden');
                fireEvent(document, new Event('visibilitychange'));
                setVisibility('visible');

                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity',
                    expect.any(Function),
                    expect.any(Function)
                );

                liveSetValue.mockClear();
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 10, clientY: 129 });
                expect(liveSetValue).not.toHaveBeenCalled();
            });

            it('a still-visible tab firing visibilitychange leaves the drag running', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
                setVisibility('visible');
                fireEvent(document, new Event('visibilitychange'));

                expect(pushUndoEntry).not.toHaveBeenCalled();

                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 10, clientY: 129 });
                expect(readVelocity('n1')).toBe(0);
            });

            it('losing window focus finalizes a latched paint drag', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 2 });
                fireEvent(window, new Event('blur'));

                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity',
                    expect.any(Function),
                    expect.any(Function)
                );

                liveSetValue.mockClear();
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 10, clientY: 129 });
                expect(liveSetValue).not.toHaveBeenCalled();
            });

            it('a second finger releasing does not end the drag owned by the first', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 2 });
                fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 129 });

                expect(pushUndoEntry).not.toHaveBeenCalled();

                fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 129 });
                expect(readVelocity('n1')).toBe(0);
            });

            it('a second finger moving does not steer the drag owned by the first', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 2 });
                fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 129 });

                expect(readVelocity('n1')).toBe(127);
            });

            it('a second pointerdown while a drag is live does not restart the gesture', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 2 });
                fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 129 });

                // The second contact must not have painted, nor taken ownership of the gesture.
                expect(readVelocity('n1')).toBe(127);

                fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 66 });
                expect(readVelocity('n1')).toBe(63);
            });

            // jsdom's setPointerCapture is a no-op stub (src/setupTests.ts:163), so these two
            // establish only that the call is made with the gesture's pointer id — no test in
            // this repo can prove the browser actually retargets events.
            it('calls setPointerCapture on the canvas with the pressing pointer id', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                const capture = vi.spyOn(HTMLElement.prototype, 'setPointerCapture');
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

                fireEvent.pointerDown(getCanvas(), { pointerId: 4, clientX: 10, clientY: 2 });

                expect(capture).toHaveBeenCalledWith(4);
                capture.mockRestore();
            });

            it('pointercancel ends a ramp-handle drag and commits the undo entry', () => {
                seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
                const { container } = render(
                    <NotePropertyLane
                        {...defaultProps}
                        setValue={liveSetValue}
                        selectedNoteIds={new Set(['n1', 'n3'])}
                    />
                );
                const handle = container.querySelectorAll('div.cursor-ns-resize')[1]!;

                fireEvent.pointerDown(handle, { pointerId: 3, pointerType: 'touch', clientY: 66 });
                fireEvent.pointerMove(handle, { pointerId: 3, pointerType: 'touch', clientY: 2 });
                expect(readVelocity('n3')).toBe(127);

                fireEvent.pointerCancel(handle, { pointerId: 3 });
                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity ramp',
                    expect.any(Function),
                    expect.any(Function)
                );

                liveSetValue.mockClear();
                fireEvent.pointerMove(handle, { pointerId: 3, pointerType: 'touch', clientY: 129 });
                expect(liveSetValue).not.toHaveBeenCalled();
            });

            it('a second handle pressed mid-drag does not steal the gesture from the first', () => {
                seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
                const { container } = render(
                    <NotePropertyLane
                        {...defaultProps}
                        setValue={liveSetValue}
                        selectedNoteIds={new Set(['n1', 'n3'])}
                    />
                );
                const handles = container.querySelectorAll('div.cursor-ns-resize');

                fireEvent.pointerDown(handles[0]!, { pointerId: 3, pointerType: 'touch', clientY: 66 });
                fireEvent.pointerDown(handles[1]!, { pointerId: 4, pointerType: 'touch', clientY: 66 });

                // Still the left handle's gesture: dragging pointer 3 to the top lifts n1, not n3.
                fireEvent.pointerMove(handles[0]!, { pointerId: 3, pointerType: 'touch', clientY: 2 });
                expect(readVelocity('n1')).toBe(127);
                expect(readVelocity('n3')).toBe(100);
            });

            it('calls setPointerCapture on the ramp handle that was pressed, not the canvas', () => {
                seedNotes([makeNote('n1', 0, 100), makeNote('n3', 4, 100)]);
                const { container } = render(
                    <NotePropertyLane
                        {...defaultProps}
                        setValue={liveSetValue}
                        selectedNoteIds={new Set(['n1', 'n3'])}
                    />
                );
                const handle = container.querySelectorAll('div.cursor-ns-resize')[0]!;
                const capture = vi.spyOn(handle, 'setPointerCapture');

                fireEvent.pointerDown(handle, { pointerId: 5, clientY: 66 });

                expect(capture).toHaveBeenCalledWith(5);
                capture.mockRestore();

                // …and the left handle finalizes on cancel just like the right one.
                fireEvent.pointerMove(handle, { pointerId: 5, clientY: 2 });
                expect(readVelocity('n1')).toBe(127);

                fireEvent.pointerCancel(handle, { pointerId: 5 });
                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity ramp',
                    expect.any(Function),
                    expect.any(Function)
                );

                liveSetValue.mockClear();
                fireEvent.pointerMove(handle, { pointerId: 5, clientY: 129 });
                expect(liveSetValue).not.toHaveBeenCalled();
            });

            it('moving over the lane without pressing writes nothing', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

                fireEvent.pointerMove(getCanvas(), { pointerId: 1, clientX: 10, clientY: 2 });

                expect(liveSetValue).not.toHaveBeenCalled();
            });

            it('unmounting mid-drag commits the undo entry rather than dropping it', () => {
                seedNotes([makeNote('n1', 0, 100)]);
                const view = render(<NotePropertyLane {...defaultProps} setValue={liveSetValue} />);

                fireEvent.pointerDown(getCanvas(), { pointerId: 1, clientX: 10, clientY: 2 });
                expect(pushUndoEntry).not.toHaveBeenCalled();

                view.unmount();

                expect(pushUndoEntry).toHaveBeenCalledWith(
                    'Change velocity',
                    expect.any(Function),
                    expect.any(Function)
                );
            });
        });
    });
});
