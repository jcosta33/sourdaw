import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { pushUndoEntry } from '#/modules/Command/useCases';
import { addMidiCC, removeMidiCC, moveMidiCC } from '#/modules/MIDI/useCases';

import { type MidiCC } from '../../../../models/MidiNoteViewTypes';
import { CCLane } from '../CCLane';

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title, description }: { title: string; description: string }) => (
        <div data-testid="blocked-state">
            <span>{title}</span>
            <span>{description}</span>
        </div>
    ),
}));

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) {
                        classes.push(key);
                    }
                }
            }
        }
        return classes.join(' ');
    },
}));

const laneMocks = vi.hoisted(() => {
    const ccByClipId: Record<string, MidiCC[]> = {};
    return { midiState: { ccByClipId } };
});

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return laneMocks.midiState;
        },
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    addMidiCC: vi.fn((clipId: string, controller: number, value: number, beat: number, channel: number = 0): MidiCC => {
        const cc: MidiCC = { id: `cc-${controller}-${beat}-${value}`, controller, value, beat, channel };
        const existing = laneMocks.midiState.ccByClipId[clipId] ?? [];
        laneMocks.midiState.ccByClipId[clipId] = [...existing, cc];
        return cc;
    }),
    removeMidiCC: vi.fn((clipId: string, ccId: string): void => {
        const existing = laneMocks.midiState.ccByClipId[clipId] ?? [];
        laneMocks.midiState.ccByClipId[clipId] = existing.filter((point) => point.id !== ccId);
    }),
    moveMidiCC: vi.fn((clipId: string, ccId: string, beat: number, value: number): void => {
        const existing = laneMocks.midiState.ccByClipId[clipId] ?? [];
        laneMocks.midiState.ccByClipId[clipId] = existing.map((point) =>
            point.id === ccId ? { ...point, beat, value } : point
        );
    }),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => store.value ?? fallback),
}));

// Mirrors CCLane's private coordinate math so expected draw positions are derived,
// never hand-computed magic numbers.
const beatToX = (beat: number, beatWidth: number): number => beat * beatWidth + 8;
const valueToY = (value: number, height: number): number => height - (value / 127) * (height - 8) - 4;
const beatFromX = (x: number, beatWidth: number): number => Math.max(0, (x - 8) / beatWidth);
const valueFromY = (y: number, height: number): number =>
    Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

describe('CCLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        controller: 1,
        beatWidth: 40,
        contentWidth: 800,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        laneMocks.midiState = { ccByClipId: {} };
    });

    it('should render without crashing with clipId', () => {
        render(<CCLane {...defaultProps} />);
        expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('should render blocked state when clipId is null', () => {
        render(<CCLane {...defaultProps} clipId={null} />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
        expect(screen.getByText('No clip selected')).toBeInTheDocument();
    });

    it('should render with correct aria-label', () => {
        render(<CCLane {...defaultProps} />);
        expect(screen.getByLabelText('CC 1 automation lane')).toBeInTheDocument();
    });

    it('should render add hint when no points exist', () => {
        render(<CCLane {...defaultProps} />);
        expect(screen.getByText('Click to add CC points')).toBeInTheDocument();
    });

    describe('point rendering', () => {
        it('should render only points matching the controller, sorted by beat', () => {
            laneMocks.midiState.ccByClipId['clip-1'] = [
                { id: 'cc-b', controller: 1, value: 90, beat: 3, channel: 0 },
                { id: 'cc-other', controller: 2, value: 10, beat: 1, channel: 0 },
                { id: 'cc-a', controller: 1, value: 20, beat: 1, channel: 0 },
            ];
            const { container } = render(<CCLane {...defaultProps} />);
            const points = container.querySelectorAll('[data-cc-point="true"]');
            expect(points).toHaveLength(2);
            expect(points[0]).toHaveAttribute('title', 'Beat 1.00: 20');
            expect(points[1]).toHaveAttribute('title', 'Beat 3.00: 90');
        });

        it('should draw a connecting polyline once more than one point exists', () => {
            laneMocks.midiState.ccByClipId['clip-1'] = [
                { id: 'cc-a', controller: 1, value: 0, beat: 0, channel: 0 },
                { id: 'cc-b', controller: 1, value: 127, beat: 2, channel: 0 },
            ];
            const { container } = render(<CCLane {...defaultProps} />);
            const polyline = container.querySelector('polyline');
            expect(polyline).not.toBeNull();
            // containerRef.current is still null during the render that produces this JSX (refs
            // attach after commit), so the component's `?? 80` fallback governs the height — not
            // any DOM layout — on every fresh mount.
            const expectedPoints = `${beatToX(0, 40)},${valueToY(0, 80)} ${beatToX(2, 40)},${valueToY(127, 80)}`;
            expect(polyline).toHaveAttribute('points', expectedPoints);
        });

        it('should not draw a polyline with zero or one point', () => {
            laneMocks.midiState.ccByClipId['clip-1'] = [{ id: 'cc-a', controller: 1, value: 10, beat: 0, channel: 0 }];
            const { container } = render(<CCLane {...defaultProps} />);
            expect(container.querySelector('polyline')).toBeNull();
        });
    });

    describe('adding a point', () => {
        beforeEach(() => {
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 80));
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should add a CC point at the clicked beat/value on container click', () => {
            render(<CCLane {...defaultProps} />);
            const beat = beatFromX(48, defaultProps.beatWidth);
            const value = valueFromY(76, 80);

            fireEvent.click(screen.getByRole('group'), { clientX: 48, clientY: 76 });

            expect(addMidiCC).toHaveBeenCalledWith('clip-1', 1, value, beat);
            expect(pushUndoEntry).toHaveBeenCalledWith('Add CC point', expect.any(Function), expect.any(Function));
        });

        it('should wire undo/redo for an added point to remove/re-add it', () => {
            render(<CCLane {...defaultProps} />);
            fireEvent.click(screen.getByRole('group'), { clientX: 48, clientY: 76 });

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            expect(undoFn).toBeDefined();
            expect(redoFn).toBeDefined();

            vi.mocked(removeMidiCC).mockClear();
            undoFn!();
            expect(removeMidiCC).toHaveBeenCalledWith('clip-1', expect.any(String));

            vi.mocked(addMidiCC).mockClear();
            redoFn!();
            expect(addMidiCC).toHaveBeenCalledWith(
                'clip-1',
                1,
                valueFromY(76, 80),
                beatFromX(48, defaultProps.beatWidth)
            );
        });

        it('should not add a point when the click target is an existing CC point', () => {
            laneMocks.midiState.ccByClipId['clip-1'] = [{ id: 'cc-a', controller: 1, value: 10, beat: 0, channel: 0 }];
            const { container } = render(<CCLane {...defaultProps} />);
            const point = container.querySelector('[data-cc-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.click(point!, { clientX: 48, clientY: 76 });

            expect(addMidiCC).not.toHaveBeenCalled();
        });
    });

    describe('dragging a point', () => {
        beforeEach(() => {
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 80));
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        const seedPoint = (): void => {
            laneMocks.midiState.ccByClipId['clip-1'] = [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }];
        };

        const readPoint = (): MidiCC | undefined =>
            (laneMocks.midiState.ccByClipId['clip-1'] ?? []).find((entry) => entry.id === 'cc-a');

        const getPoint = (container: HTMLElement): HTMLElement => {
            const point = container.querySelector<HTMLElement>('[data-cc-point="true"]');
            expect(point).not.toBeNull();
            return point!;
        };

        // Drag target: x 88 → beat 2, y 20 → value 99. Derived, never hand-written.
        const draggedBeat = beatFromX(88, 40);
        const draggedValue = valueFromY(20, 80);

        it('should move a point via drag and push a Move undo entry on release when changed', () => {
            seedPoint();
            const { container } = render(<CCLane {...defaultProps} />);
            const point = getPoint(container);

            fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
            fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });

            expect(moveMidiCC).toHaveBeenCalledWith('clip-1', 'cc-a', draggedBeat, draggedValue);

            fireEvent.pointerUp(point, { pointerId: 2, clientX: 88, clientY: 20 });

            expect(pushUndoEntry).toHaveBeenCalledWith('Move CC point', expect.any(Function), expect.any(Function));
            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            vi.mocked(moveMidiCC).mockClear();
            undoFn!();
            expect(moveMidiCC).toHaveBeenCalledWith('clip-1', 'cc-a', 0, 20);

            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            vi.mocked(moveMidiCC).mockClear();
            redoFn!();
            expect(moveMidiCC).toHaveBeenCalledWith('clip-1', 'cc-a', draggedBeat, draggedValue);
        });

        it('should not push a Move undo entry when the drag ends without changing the point', () => {
            seedPoint();
            const { container } = render(<CCLane {...defaultProps} />);
            const point = getPoint(container);

            fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
            fireEvent.pointerUp(point, { pointerId: 2, clientX: 8, clientY: 76 });

            expect(pushUndoEntry).not.toHaveBeenCalled();
        });

        describe('touch, pen, and interrupted drags', () => {
            const setVisibility = (state: 'visible' | 'hidden'): void => {
                Object.defineProperty(document, 'visibilityState', {
                    configurable: true,
                    get: () => state,
                });
            };

            afterEach(() => {
                // Restoring a *value* would leave the own accessor shadowing jsdom's real
                // Document.prototype getter for the rest of the file; delete the property.
                Reflect.deleteProperty(document, 'visibilityState');
            });

            it('moves a point from a touch pointer, not only from a mouse', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 7, pointerType: 'touch', clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 7, pointerType: 'touch', clientX: 88, clientY: 20 });

                expect(readPoint()).toEqual(expect.objectContaining({ beat: draggedBeat, value: draggedValue }));
            });

            it('moves a point from a pen pointer and commits the move on release', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 9, pointerType: 'pen', clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 9, pointerType: 'pen', clientX: 88, clientY: 20 });

                expect(readPoint()?.value).toBe(draggedValue);

                fireEvent.pointerUp(point, { pointerId: 9, pointerType: 'pen', clientX: 88, clientY: 20 });
                expect(pushUndoEntry).toHaveBeenCalledWith('Move CC point', expect.any(Function), expect.any(Function));
            });

            it('opts the lane and its point handles out of the browser pan/zoom gesture', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);

                // Without touch-action: none the browser claims the stroke for panning and
                // cancels it mid-gesture, so a touch drag never completes.
                expect(screen.getByRole('group').style.touchAction).toBe('none');
                expect(getPoint(container).style.touchAction).toBe('none');
            });

            it('takes pointer capture on the pressed point handle with the gesture pointer id', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);
                const capture = vi.spyOn(point, 'setPointerCapture');

                fireEvent.pointerDown(point, { pointerId: 6, button: 0, clientX: 8, clientY: 76 });

                // jsdom's setPointerCapture is a no-op stub (src/setupTests.ts:163), so this
                // establishes only that the call is made on the pressed handle with the gesture's
                // pointer id — no test in this repo can prove the browser retargets events.
                expect(capture).toHaveBeenCalledWith(6);
            });

            it('arms no drag when taking pointer capture fails', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);
                const capture = vi.spyOn(point, 'setPointerCapture').mockImplementation(() => {
                    throw new DOMException('NotAllowed', 'NotAllowedError');
                });

                // React re-dispatches a throwing handler as a window error event; swallow it in
                // the capture phase so this deliberate throw is not reported as a suite error.
                // try/finally so a later failing assertion cannot leak the global listener.
                const swallow = (event: Event): void => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                };
                window.addEventListener('error', swallow, true);
                try {
                    fireEvent.pointerDown(point, { pointerId: 3, button: 0, clientX: 8, clientY: 76 });
                } finally {
                    window.removeEventListener('error', swallow, true);
                }

                // Capture is taken before the session is armed, so a capture the browser refused
                // leaves nothing latched.
                fireEvent.pointerMove(point, { pointerId: 3, clientX: 88, clientY: 20 });
                expect(moveMidiCC).not.toHaveBeenCalled();

                // Arming first would leave a session with no capture, and the live-session guard
                // would then refuse every later press — the lane would be dead until it remounts.
                capture.mockRestore();
                fireEvent.pointerDown(point, { pointerId: 4, button: 0, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 4, clientX: 88, clientY: 20 });
                expect(readPoint()?.beat).toBe(draggedBeat);
            });

            it('ignores a right-button press so the context menu is not also an edit', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 4, button: 2, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 4, clientX: 88, clientY: 20 });

                expect(moveMidiCC).not.toHaveBeenCalled();

                // …and no gesture was latched, so the next primary press still drags.
                fireEvent.pointerDown(point, { pointerId: 5, button: 0, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 5, clientX: 88, clientY: 20 });
                expect(readPoint()?.beat).toBe(draggedBeat);
            });

            it('pointercancel ends the drag, commits the undo entry, and stops further movement', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });
                expect(readPoint()?.value).toBe(draggedValue);

                fireEvent.pointerCancel(point, { pointerId: 2 });
                expect(pushUndoEntry).toHaveBeenCalledWith('Move CC point', expect.any(Function), expect.any(Function));

                vi.mocked(moveMidiCC).mockClear();
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 208, clientY: 40 });
                expect(moveMidiCC).not.toHaveBeenCalled();

                // The trailing pointerup the browser still delivers must not commit a second entry.
                fireEvent.pointerUp(point, { pointerId: 2, clientX: 208, clientY: 40 });
                expect(pushUndoEntry).toHaveBeenCalledTimes(1);
            });

            it('losing window focus finalizes a latched drag', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });

                fireEvent(window, new Event('blur'));

                expect(pushUndoEntry).toHaveBeenCalledWith('Move CC point', expect.any(Function), expect.any(Function));

                vi.mocked(moveMidiCC).mockClear();
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 208, clientY: 40 });
                expect(moveMidiCC).not.toHaveBeenCalled();
            });

            it('hiding the tab finalizes a latched drag', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });

                setVisibility('hidden');
                fireEvent(document, new Event('visibilitychange'));

                expect(pushUndoEntry).toHaveBeenCalledWith('Move CC point', expect.any(Function), expect.any(Function));

                vi.mocked(moveMidiCC).mockClear();
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 208, clientY: 40 });
                expect(moveMidiCC).not.toHaveBeenCalled();
            });

            it('a still-visible tab firing visibilitychange leaves the drag running', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
                setVisibility('visible');
                fireEvent(document, new Event('visibilitychange'));

                expect(pushUndoEntry).not.toHaveBeenCalled();

                fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });
                expect(readPoint()?.value).toBe(draggedValue);
            });

            it('losing capture without a release finalizes the gesture', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });
                fireEvent.lostPointerCapture(point, { pointerId: 2 });

                expect(pushUndoEntry).toHaveBeenCalledTimes(1);

                vi.mocked(moveMidiCC).mockClear();
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 208, clientY: 40 });
                expect(moveMidiCC).not.toHaveBeenCalled();
            });

            it('a drag survives the pressed point handle unmounting mid-gesture', () => {
                seedPoint();
                const view = render(<CCLane {...defaultProps} />);
                const point = getPoint(view.container);

                fireEvent.pointerDown(point, { pointerId: 2, pointerType: 'touch', clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });
                expect(readPoint()?.value).toBe(draggedValue);

                // Switching the lane to another controller unmounts every handle for this one.
                view.rerender(<CCLane {...defaultProps} controller={2} />);
                expect(view.container.querySelector('[data-cc-point="true"]')).toBeNull();

                // The release now lands on the lane itself; it must still commit the gesture.
                fireEvent.pointerUp(screen.getByRole('group'), { pointerId: 2, clientX: 88, clientY: 20 });

                expect(pushUndoEntry).toHaveBeenCalledWith('Move CC point', expect.any(Function), expect.any(Function));
            });

            it('a second finger releasing does not end the drag owned by the first', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 1, pointerType: 'touch', clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 1, clientX: 88, clientY: 20 });
                fireEvent.pointerUp(point, { pointerId: 2, pointerType: 'touch', clientX: 208, clientY: 40 });

                expect(pushUndoEntry).not.toHaveBeenCalled();

                fireEvent.pointerMove(point, { pointerId: 1, clientX: 48, clientY: 40 });
                expect(readPoint()?.beat).toBe(beatFromX(48, 40));
            });

            it('a second finger moving does not steer the drag owned by the first', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 1, pointerType: 'touch', clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 2, pointerType: 'touch', clientX: 88, clientY: 20 });

                expect(readPoint()?.beat).toBe(0);

                // …and pointer 1 still owns the gesture, so the drag was ignored, not killed.
                fireEvent.pointerMove(point, { pointerId: 1, clientX: 88, clientY: 20 });
                expect(readPoint()?.beat).toBe(draggedBeat);
            });

            it('a second pointerdown while a drag is live does not steal the gesture', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 1, pointerType: 'touch', clientX: 8, clientY: 76 });
                fireEvent.pointerDown(point, { pointerId: 2, pointerType: 'touch', clientX: 208, clientY: 40 });

                // Pointer 1 still owns the gesture, so its move is the one that lands.
                fireEvent.pointerMove(point, { pointerId: 1, clientX: 88, clientY: 20 });
                expect(readPoint()?.value).toBe(draggedValue);
            });

            it('moving over the lane without pressing writes nothing', () => {
                seedPoint();
                render(<CCLane {...defaultProps} />);

                fireEvent.pointerMove(screen.getByRole('group'), { pointerId: 1, clientX: 88, clientY: 20 });

                expect(moveMidiCC).not.toHaveBeenCalled();
            });

            it('unmounting mid-drag commits the undo entry rather than dropping it', () => {
                seedPoint();
                const view = render(<CCLane {...defaultProps} />);
                const point = getPoint(view.container);

                fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });
                expect(pushUndoEntry).not.toHaveBeenCalled();

                view.unmount();

                expect(pushUndoEntry).toHaveBeenCalledWith('Move CC point', expect.any(Function), expect.any(Function));
            });

            it('commits the drag even when releasing capture throws', () => {
                seedPoint();
                const { container } = render(<CCLane {...defaultProps} />);
                const point = getPoint(container);

                fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
                fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });

                // Browsers throw InvalidPointerId when capture was already dropped (e.g. on cancel).
                vi.spyOn(point, 'releasePointerCapture').mockImplementation(() => {
                    throw new DOMException('InvalidPointerId', 'NotFoundError');
                });
                fireEvent.pointerCancel(point, { pointerId: 2 });

                expect(pushUndoEntry).toHaveBeenCalledWith('Move CC point', expect.any(Function), expect.any(Function));
            });
        });
    });

    describe('removing a point', () => {
        it('should remove a point on double-click and push a Remove undo entry', () => {
            laneMocks.midiState.ccByClipId['clip-1'] = [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }];
            const { container } = render(<CCLane {...defaultProps} />);
            const point = container.querySelector('[data-cc-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.doubleClick(point!);

            expect(removeMidiCC).toHaveBeenCalledWith('clip-1', 'cc-a');
            expect(pushUndoEntry).toHaveBeenCalledWith('Remove CC point', expect.any(Function), expect.any(Function));

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            vi.mocked(addMidiCC).mockClear();
            undoFn!();
            expect(addMidiCC).toHaveBeenCalledWith('clip-1', 1, 20, 0, 0);
        });
    });
});
