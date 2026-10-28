import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { pushUndoEntry } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    addMidiCC,
    removeMidiCC,
    moveMidiCC,
    restoreMidiCCPoints,
    revisitHandEditedCCReturns,
} from '#/modules/MIDI/useCases';

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
    return { midiState: { ccByClipId }, useActualStore: false };
});

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return {
        ...original,
        midiStore: {
            get value() {
                if (laneMocks.useActualStore) {
                    return original.midiStore.value;
                }
                return laneMocks.midiState;
            },
            set: original.midiStore.set,
        },
    };
});

vi.mock('#/modules/Command/useCases', () => ({
    getExecutableAppActionEffect: vi.fn(() => null),
    executeUserAppAction: vi.fn(),
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    addMidiCC: vi.fn(
        (clipId: string, controller: number, value: number, beat: number, channel: number = 0, id?: string): MidiCC => {
            const created: MidiCC = { id: `cc-${controller}-${beat}-${value}`, controller, value, beat, channel };
            // Undo/redo re-adds under the captured id; every other call mints one.
            const cc: MidiCC = id === undefined ? created : { ...created, id };
            const existing = laneMocks.midiState.ccByClipId[clipId] ?? [];
            // Mirrors the real use case: a point is keyed by (beat, channel, controller)
            // and replaces the point already sitting at that key.
            const deduped = existing.filter(
                (point) => !(point.beat === beat && point.channel === channel && point.controller === controller)
            );
            laneMocks.midiState.ccByClipId[clipId] = [...deduped, cc];
            return cc;
        }
    ),
    removeMidiCC: vi.fn((clipId: string, ccId: string): void => {
        const existing = laneMocks.midiState.ccByClipId[clipId] ?? [];
        laneMocks.midiState.ccByClipId[clipId] = existing.filter((point) => point.id !== ccId);
    }),
    restoreMidiCCPoints: vi.fn((clipId: string, points: readonly MidiCC[]): void => {
        // Mirrors the real use case: inserts each captured row missing by id and
        // never removes or reorders rows the gesture did not touch.
        const existing = laneMocks.midiState.ccByClipId[clipId] ?? [];
        const restored = [...existing];
        for (const point of points) {
            if (!restored.some((row) => row.id === point.id)) {
                restored.push(point);
            }
        }
        laneMocks.midiState.ccByClipId[clipId] = restored;
    }),
    moveMidiCC: vi.fn((clipId: string, ccId: string, beat: number, value: number): void => {
        const existing = laneMocks.midiState.ccByClipId[clipId] ?? [];
        laneMocks.midiState.ccByClipId[clipId] = existing.map((point) =>
            point.id === ccId ? { ...point, beat, value } : point
        );
    }),
    revisitHandEditedCCReturns: vi.fn(),
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

            expect(addMidiCC).toHaveBeenCalledWith('clip-1', 1, value, beat, 0);
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

            // Redo must re-add the point under its own id, so the undo side's
            // remove keeps naming a point the store holds.
            const addedCC = vi.mocked(addMidiCC).mock.results[0]?.value;
            expect(addedCC).toBeDefined();

            vi.mocked(addMidiCC).mockClear();
            redoFn!();
            expect(addMidiCC).toHaveBeenCalledWith(
                'clip-1',
                1,
                valueFromY(76, 80),
                beatFromX(48, defaultProps.beatWidth),
                0,
                addedCC?.id
            );
        });

        it('should restore the replaced point on undo when the click lands on an occupied key (#4840)', () => {
            // The lane already holds a point at beat 1 (value 40), written by an
            // earlier route. The click below lands on that exact key, so addMidiCC
            // replaces it under a fresh id.
            laneMocks.midiState.ccByClipId['clip-1'] = [
                { id: 'cc-original', controller: 1, value: 40, beat: 1, channel: 0 },
            ];
            render(<CCLane {...defaultProps} />);
            const value = valueFromY(40, 80);

            fireEvent.click(screen.getByRole('group'), { clientX: 48, clientY: 40 });

            // The click replaced the musician's point rather than stacking a second one.
            const afterAdd = laneMocks.midiState.ccByClipId['clip-1'] ?? [];
            expect(afterAdd).toHaveLength(1);
            const clickedId = afterAdd[0]?.id;
            expect(clickedId).not.toBe('cc-original');

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            expect(undoFn).toBeDefined();
            expect(redoFn).toBeDefined();

            undoFn!();
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([
                { id: 'cc-original', controller: 1, value: 40, beat: 1, channel: 0 },
            ]);

            redoFn!();
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([
                { id: clickedId, controller: 1, value, beat: 1, channel: 0 },
            ]);

            // The cycle keeps holding: a second undo restores the musician's point again.
            undoFn!();
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([
                { id: 'cc-original', controller: 1, value: 40, beat: 1, channel: 0 },
            ]);
        });

        it('restores the points a doubly-occupied key held before the click replaced them (#4840)', () => {
            // moveMidiCC maps without a key dedupe, so a drag can strand two
            // points on one (beat, channel, controller) key; seeding writes
            // them the way the store actually holds them. The click below
            // replaces BOTH, and undo must return the clip to this exact
            // pre-click array.
            const preClick = [
                { id: 'cc-first', controller: 1, value: 40, beat: 1, channel: 0 },
                { id: 'cc-second', controller: 1, value: 60, beat: 1, channel: 0 },
            ];
            laneMocks.midiState.ccByClipId['clip-1'] = [...preClick];
            render(<CCLane {...defaultProps} />);

            fireEvent.click(screen.getByRole('group'), { clientX: 48, clientY: 40 });

            // The click replaced the whole key rather than stacking a third point.
            const afterAdd = laneMocks.midiState.ccByClipId['clip-1'] ?? [];
            expect(afterAdd).toHaveLength(1);
            const clickedId = afterAdd[0]?.id;

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            expect(undoFn).toBeDefined();
            expect(redoFn).toBeDefined();

            undoFn!();
            // Undo removes the gesture's written point, then re-inserts the
            // captured rows by id — the FULL pre-click array comes back under
            // its original ids. Re-adding through addMidiCC would re-trigger its
            // per-key dedupe and strand all but the last point; that collapsed
            // state is what this assertion discriminates against.
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual(preClick);

            redoFn!();
            // Redo re-adds the clicked point through the deduping add path, so
            // the restored pair collapses back to the clicked point.
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([
                { id: clickedId, controller: 1, value: valueFromY(40, 80), beat: 1, channel: 0 },
            ]);

            // The cycle keeps holding: the second undo restores both points again.
            undoFn!();
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual(preClick);
        });

        it('restores a row the add displaced on another key, such as a return a split wrote, on undo', () => {
            const returnRow = {
                id: 'cc-split:right:rpn-after-carried-0',
                controller: 6,
                value: 2,
                beat: 0.001,
                channel: 0,
            };
            const unrelated = { id: 'cc-peer', controller: 11, value: 50, beat: 2, channel: 0 };
            laneMocks.midiState.ccByClipId['clip-1'] = [returnRow, unrelated];
            // The real use case drops a split's return row beside the clicked key; the lane's undo must put it back.
            vi.mocked(addMidiCC).mockImplementationOnce((clipId, controller, value, beat, channel = 0): MidiCC => {
                const cc: MidiCC = { id: 'clicked', controller, value, beat, channel };
                laneMocks.midiState.ccByClipId[clipId] = [unrelated, cc];
                return cc;
            });
            render(<CCLane {...defaultProps} controller={6} />);

            fireEvent.click(screen.getByRole('group'), { clientX: 8, clientY: 40 });

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            expect(undoFn).toBeDefined();

            undoFn!();

            // The lane hands the use case the pre-click list, so the return goes back to its own position
            // (the use case's spec pins the placement; this mock only appends).
            expect(restoreMidiCCPoints).toHaveBeenCalledWith('clip-1', [returnRow], [returnRow, unrelated]);
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([unrelated, returnRow]);
        });

        it('restores the changed return row and the pre-gesture value on undo', () => {
            const returnRow = {
                id: 'cc-split:right:rpn-after-carried-0',
                controller: 6,
                value: 2,
                beat: 0.001,
                channel: 0,
            };
            const unrelated = { id: 'cc-peer', controller: 11, value: 50, beat: 2, channel: 0 };
            // The real rewrite reuses the standing family's ids, so the rewritten row keeps the
            // pre-gesture id and only its value changes.
            const rewrittenReturn = { ...returnRow, value: 7 };
            laneMocks.midiState.ccByClipId['clip-1'] = [returnRow, unrelated];
            vi.mocked(addMidiCC).mockImplementationOnce((clipId, controller, value, beat, channel = 0): MidiCC => {
                const cc: MidiCC = { id: 'clicked', controller, value, beat, channel };
                laneMocks.midiState.ccByClipId[clipId] = [rewrittenReturn, unrelated, cc];
                return cc;
            });
            render(<CCLane {...defaultProps} controller={6} />);

            fireEvent.click(screen.getByRole('group'), { clientX: 8, clientY: 40 });
            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            undoFn!();

            expect(vi.mocked(removeMidiCC).mock.calls.map(([, id]) => id)).toEqual([returnRow.id, 'clicked']);
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([unrelated, returnRow]);
            expect(restoreMidiCCPoints).toHaveBeenCalledWith('clip-1', [returnRow], [returnRow, unrelated]);
            expect(pushUndoEntry).toHaveBeenCalledTimes(1);
        });

        it('leaves a row deleted between the gesture and the undo deleted when undoing an add', () => {
            // The seeded row sits on another key AND another controller, so the
            // gesture never displaced it. A collaborator's merged delete removes
            // it after the click; the undo captured only the clicked key's rows
            // and must not resurrect what that delete removed.
            laneMocks.midiState.ccByClipId['clip-1'] = [
                { id: 'cc-peer', controller: 11, value: 50, beat: 2, channel: 0 },
            ];
            render(<CCLane {...defaultProps} />);

            // The click lands on an empty key (beat 1, controller 1).
            fireEvent.click(screen.getByRole('group'), { clientX: 48, clientY: 76 });

            // A merged peer delete removes the unrelated row from the store.
            removeMidiCC('clip-1', 'cc-peer');

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            expect(undoFn).toBeDefined();
            expect(redoFn).toBeDefined();

            undoFn!();
            // The peer's delete stands, and the clicked key held nothing pre-click.
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([]);

            const addedCC = vi.mocked(addMidiCC).mock.results[0]?.value;
            expect(addedCC).toBeDefined();

            redoFn!();
            // Redo restores the gesture's own point; the unrelated row stays gone.
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([
                {
                    id: addedCC?.id,
                    controller: 1,
                    value: valueFromY(76, 80),
                    beat: beatFromX(48, defaultProps.beatWidth),
                    channel: 0,
                },
            ]);
        });

        it('restores the sibling when undoing a double-click removal on a doubly-occupied key', () => {
            // The double-click undo re-inserts just the removed row by id; it must
            // not re-add through the deduping add path, which would delete the
            // sibling still sitting at the same key.
            const preRemoval = [
                { id: 'cc-first', controller: 1, value: 40, beat: 1, channel: 0 },
                { id: 'cc-second', controller: 1, value: 60, beat: 1, channel: 0 },
            ];
            laneMocks.midiState.ccByClipId['clip-1'] = [...preRemoval];
            const { container } = render(<CCLane {...defaultProps} />);
            // Array order is render order: the first point is cc-first.
            const removed = container.querySelector('[data-cc-point="true"]');
            expect(removed).not.toBeNull();

            fireEvent.doubleClick(removed!);

            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([preRemoval[1]]);

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            expect(undoFn).toBeDefined();
            expect(redoFn).toBeDefined();

            undoFn!();
            // The captured row re-appends after the sibling that survived the removal.
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([preRemoval[1], preRemoval[0]]);

            redoFn!();
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([preRemoval[1]]);
        });

        it('preserves sibling-controller rows when undoing a double-click removal', () => {
            // The pre-double-click capture used to be the controller-FILTERED lane
            // view; restoring it wholesale deleted every other controller's rows
            // from the clip.
            const modRow = { id: 'cc-mod', controller: 1, value: 40, beat: 1, channel: 0 };
            const exprRows = [
                { id: 'cc-expr-1', controller: 11, value: 10, beat: 0, channel: 0 },
                { id: 'cc-expr-2', controller: 11, value: 90, beat: 3, channel: 0 },
            ];
            laneMocks.midiState.ccByClipId['clip-1'] = [modRow, ...exprRows];
            const { container } = render(<CCLane {...defaultProps} />);
            const removed = container.querySelector('[data-cc-point="true"]');
            expect(removed).not.toBeNull();

            fireEvent.doubleClick(removed!);

            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual(exprRows);

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            expect(undoFn).toBeDefined();
            expect(redoFn).toBeDefined();

            undoFn!();
            // Every row survives exactly once; the restored row re-appends after
            // the rows that never left the clip.
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([...exprRows, modRow]);
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
            expect(laneMocks.midiState.ccByClipId['clip-1']).toEqual([
                { id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 },
            ]);

            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            vi.mocked(moveMidiCC).mockClear();
            redoFn!();
            expect(moveMidiCC).toHaveBeenCalledWith('clip-1', 'cc-a', draggedBeat, draggedValue);
        });

        it('revisits the head the point left and the one it joined when a drag commits, and in both replay directions', () => {
            seedPoint();
            const { container } = render(<CCLane {...defaultProps} />);
            const point = getPoint(container);

            fireEvent.pointerDown(point, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
            fireEvent.pointerMove(point, { pointerId: 2, clientX: 88, clientY: 20 });
            fireEvent.pointerUp(point, { pointerId: 2, clientX: 88, clientY: 20 });

            expect(revisitHandEditedCCReturns).toHaveBeenCalledWith(
                'clip-1',
                { channel: 0, beat: 0 },
                { editedController: 1, editedRowId: 'cc-a' }
            );
            expect(revisitHandEditedCCReturns).toHaveBeenCalledWith(
                'clip-1',
                { channel: 0, beat: draggedBeat },
                { editedController: 1, editedRowId: 'cc-a' }
            );

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            // Undo restores the gesture's changed rows; reconciliation is not an inverse.
            vi.mocked(revisitHandEditedCCReturns).mockClear();
            undoFn!();
            expect(restoreMidiCCPoints).toHaveBeenCalledWith(
                'clip-1',
                [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }],
                [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }]
            );
            expect(revisitHandEditedCCReturns).not.toHaveBeenCalled();
            redoFn!();
            expect(revisitHandEditedCCReturns).toHaveBeenCalledWith(
                'clip-1',
                { channel: 0, beat: draggedBeat },
                { editedController: 1, editedRowId: 'cc-a' }
            );
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
            vi.mocked(restoreMidiCCPoints).mockClear();
            undoFn!();
            // The undo re-inserts just the removed row by id, ahead of the same-beat
            // follower it preceded (the pre-delete order rides the undo) — a sibling
            // sharing the key survives, and rows other controllers hold are never touched.
            expect(restoreMidiCCPoints).toHaveBeenCalledWith(
                'clip-1',
                [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }],
                [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }]
            );
        });

        it('revisits the removed point head on delete and in both replay directions', () => {
            laneMocks.midiState.ccByClipId['clip-1'] = [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }];
            const { container } = render(<CCLane {...defaultProps} />);
            const point = container.querySelector('[data-cc-point="true"]');

            fireEvent.doubleClick(point!);

            expect(revisitHandEditedCCReturns).toHaveBeenCalledWith(
                'clip-1',
                { channel: 0, beat: 0 },
                { editedController: 1, editedRowId: 'cc-a' }
            );

            // Undo restores the gesture's removed row without re-deriving the returns.
            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            vi.mocked(revisitHandEditedCCReturns).mockClear();
            undoFn!();
            expect(restoreMidiCCPoints).toHaveBeenCalledWith(
                'clip-1',
                [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }],
                [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }]
            );
            expect(revisitHandEditedCCReturns).not.toHaveBeenCalled();
            redoFn!();
            expect(revisitHandEditedCCReturns).toHaveBeenCalledWith(
                'clip-1',
                { channel: 0, beat: 0 },
                { editedController: 1, editedRowId: 'cc-a' }
            );
        });
    });
});

const actualMidiUseCases = await vi.importActual<typeof import('#/modules/MIDI/useCases')>('#/modules/MIDI/useCases');

describe('CCLane return-family history with real MIDI edits', () => {
    const tick = 1 / 960;
    const props = { clipId: 'clip-1', controller: 6, beatWidth: 40, contentWidth: 800 };

    function headRows(beat: number, key: string): MidiCC[] {
        return [
            { id: `${key}:rpn-0`, controller: 101, value: 0, beat, channel: 0 },
            { id: `${key}:rpn-1`, controller: 100, value: 0, beat, channel: 0 },
            ...(
                [
                    [101, 0],
                    [100, 0],
                    [6, 2],
                    [38, 0],
                    [99, 1],
                    [98, 1],
                ] as const
            ).map(([controller, value], index) => ({
                id: `${key}:rpn-after-carried-${index}`,
                controller,
                value,
                beat: beat + tick,
                channel: 0,
            })),
        ];
    }

    function rows(): MidiCC[] {
        return midiStore.value?.ccByClipId['clip-1'] ?? [];
    }

    function seed(controlChanges: MidiCC[]): void {
        midiStore.set({ notesByClipId: {}, ccByClipId: { 'clip-1': controlChanges }, pitchBendByClipId: {} });
    }

    function rangeAt(beat: number): number | undefined {
        return actualMidiUseCases.projectChannelBend({
            clips: [
                {
                    clip: { startBeat: 0, endBeat: 8 },
                    controlChanges: rows(),
                    pitchBends: [{ id: 'later-bend', value: 4096, beat, channel: 0 }],
                },
            ],
            frameAtBeat: (value) => value * 24_000,
        })[0]?.rangeSemitones;
    }

    function replay(): { undo: () => void; redo: () => void } {
        const entry = vi.mocked(pushUndoEntry).mock.calls.at(-1);
        expect(entry).toBeDefined();
        return { undo: entry![1], redo: entry![2] };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        laneMocks.useActualStore = true;
        seed([]);
        vi.mocked(addMidiCC).mockImplementation(actualMidiUseCases.addMidiCC);
        vi.mocked(moveMidiCC).mockImplementation(actualMidiUseCases.moveMidiCC);
        vi.mocked(removeMidiCC).mockImplementation(actualMidiUseCases.removeMidiCC);
        vi.mocked(restoreMidiCCPoints).mockImplementation(actualMidiUseCases.restoreMidiCCPoints);
        vi.mocked(revisitHandEditedCCReturns).mockImplementation(actualMidiUseCases.revisitHandEditedCCReturns);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 80));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        laneMocks.useActualStore = false;
    });

    it.each(
        (['split', 'glue'] as const).flatMap((producer) => [
            { producer, selection: 'NRPN', selectors: [[99, 1]] as const, coarseFirst: true },
            {
                producer,
                selection: 'Null RPN',
                selectors: [
                    [101, 127],
                    [100, 127],
                ] as const,
                coarseFirst: true,
            },
            { producer, selection: 'NRPN', selectors: [[99, 1]] as const, coarseFirst: false },
            {
                producer,
                selection: 'Null RPN',
                selectors: [
                    [101, 127],
                    [100, 127],
                ] as const,
                coarseFirst: false,
            },
        ])
    )(
        'moves a range onto a produced $producer head with $selection selected later, coarse first: $coarseFirst',
        ({ producer, selectors, coarseFirst }) => {
            const declaredRange = (key: string, beat: number, value: number): MidiCC[] =>
                (
                    [
                        [101, 0],
                        [100, 0],
                        [6, value],
                        [38, 0],
                    ] as const
                ).map(([controller, data], index) => ({
                    id: `${key}-${index}`,
                    controller,
                    value: data,
                    beat,
                    channel: 0,
                }));
            midiStore.set({
                notesByClipId: {},
                ccByClipId: { source: [...declaredRange('held', 0.1, 12), ...declaredRange('cut', 1.3, 2)] },
                pitchBendByClipId: { source: [{ id: 'held-bend', value: 8191, beat: 1.2, channel: 0 }] },
            });
            if (producer === 'split') {
                const plan = actualMidiUseCases.prepareMidiClipSplit({
                    sourceClipId: 'source',
                    rightClipId: 'clip-1',
                    splitBeat: 2,
                    splitNotes: true,
                });
                expect(plan).not.toBeNull();
                seed([...plan!.nextRight.controlChanges.value]);
            } else {
                const plan = actualMidiUseCases.prepareMidiClipGlueState({
                    sources: [
                        { clipId: 'source', visibleStartBeat: 2, visibleEndBeat: 4, beatOffset: -2 },
                        { clipId: 'neighbor', visibleStartBeat: 0, visibleEndBeat: 2, beatOffset: 2 },
                    ],
                    targetClipId: 'clip-1',
                });
                expect(plan).not.toBeNull();
                const glued = plan!.next.clips.find(({ clipId }) => clipId === 'clip-1');
                expect(glued).toBeDefined();
                seed([...glued!.data.controlChanges.value]);
            }
            expect(rangeAt(0)).toBe(12);
            expect(rangeAt(0.5)).toBe(2);
            const addCoarse = () => actualMidiUseCases.addMidiCC('clip-1', 6, 9, 1, 0, 'hand-coarse');
            if (coarseFirst) {
                addCoarse();
            }
            for (const [controller, value] of selectors) {
                // Move the selectors too, preserving the producer's opening declaration and list order.
                const selector = actualMidiUseCases.addMidiCC('clip-1', controller, value, 0.5, 0);
                actualMidiUseCases.moveMidiCC('clip-1', selector.id, 0, selector.value);
                actualMidiUseCases.revisitHandEditedCCReturns(
                    'clip-1',
                    { channel: 0, beat: 0.5 },
                    {
                        editedController: selector.controller,
                        editedRowId: selector.id,
                    }
                );
                actualMidiUseCases.revisitHandEditedCCReturns(
                    'clip-1',
                    { channel: 0, beat: 0 },
                    {
                        editedController: selector.controller,
                        editedRowId: selector.id,
                    }
                );
            }
            if (!coarseFirst) {
                addCoarse();
            }
            const before = [...rows()];
            const view = render(<CCLane {...props} />);
            const point = view.container.querySelector('[title="Beat 1.00: 9"]');
            expect(point).not.toBeNull();
            fireEvent.pointerDown(point!, { pointerId: 1, button: 0, clientX: 48, clientY: valueToY(9, 80) });
            fireEvent.pointerMove(point!, { pointerId: 1, clientX: 8, clientY: valueToY(9, 80) });
            fireEvent.pointerUp(point!, { pointerId: 1 });
            expect(rows().find(({ id }) => id === 'hand-coarse')?.beat).toBe(0);
            // The coarse writes only when RPN 0 is selected at its own arrival, regardless of the final selector.
            expect(rangeAt(0)).toBe(coarseFirst ? 9 : 12);
            expect(rangeAt(0.5)).toBe(coarseFirst ? 9 : 2);
            const committed = [...rows()];
            const { undo, redo } = replay();
            undo();
            expect(rows()).toEqual(before);
            expect(rangeAt(0.5)).toBe(2);
            redo();
            expect(rows()).toEqual(committed);
            expect(rangeAt(0.5)).toBe(coarseFirst ? 9 : 2);
        }
    );

    it('restores exact rows and same-beat order after adding, undoing and redoing a hand range', () => {
        seed([
            ...headRows(0, 'cc-split:right'),
            { id: 'other-channel', controller: 6, value: 11, beat: 0, channel: 1 },
        ]);
        const before = [...rows()];
        render(<CCLane {...props} />);
        fireEvent.click(screen.getByRole('group'), { clientX: 8, clientY: valueToY(7, 80) });
        const committed = [...rows()];
        expect(committed).not.toEqual(before);
        expect(rangeAt(3)).toBe(7);
        const { undo, redo } = replay();
        undo();
        expect(rows()).toEqual(before);
        expect(rangeAt(3)).toBe(2);
        redo();
        expect(rows()).toEqual(committed);
        expect(rangeAt(3)).toBe(7);
    });

    it('restores both heads exactly when a hand range moves between carried return families', () => {
        seed([...headRows(0, 'cc-glue:first'), ...headRows(2, 'cc-glue:second')]);
        actualMidiUseCases.addMidiCC('clip-1', 6, 7, 0, 0, 'hand-coarse');
        const before = [...rows()];
        const view = render(<CCLane {...props} />);
        const point = view.container.querySelector('[title="Beat 0.00: 7"]');
        expect(point).not.toBeNull();
        fireEvent.pointerDown(point!, { pointerId: 1, button: 0, clientX: 8, clientY: valueToY(7, 80) });
        fireEvent.pointerMove(point!, { pointerId: 1, clientX: 88, clientY: valueToY(9, 80) });
        fireEvent.pointerUp(point!, { pointerId: 1 });
        const committed = [...rows()];
        expect(committed).not.toEqual(before);
        const { undo, redo } = replay();
        undo();
        expect(rows()).toEqual(before);
        redo();
        expect(rows()).toEqual(committed);
    });

    it('restores exact rows after deleting a hand range and redoes the committed family', () => {
        seed([
            ...headRows(0, 'cc-split:right'),
            { id: 'other-channel', controller: 6, value: 11, beat: 0, channel: 1 },
        ]);
        actualMidiUseCases.addMidiCC('clip-1', 6, 7, 0, 0, 'hand-coarse');
        actualMidiUseCases.addMidiCC('clip-1', 38, 50, 0, 0, 'hand-fine');
        const before = [...rows()];
        const view = render(<CCLane {...props} />);
        const point = view.container.querySelector('[title="Beat 0.00: 7"]');
        expect(point).not.toBeNull();
        fireEvent.doubleClick(point!);
        const committed = [...rows()];
        expect(committed).not.toEqual(before);
        const { undo, redo } = replay();
        undo();
        expect(rows()).toEqual(before);
        redo();
        expect(rows()).toEqual(committed);
    });

    it('restores rows a shortened rewritten family no longer holds when the add is undone', () => {
        const head = headRows(0, 'cc-split:right');
        seed([
            ...head,
            { id: 'cc-split:right:rpn-after-carried-6', controller: 99, value: 1, beat: tick, channel: 0 },
            { id: 'cc-split:right:rpn-after-carried-7', controller: 98, value: 1, beat: tick, channel: 0 },
            { id: 'peer-controller', controller: 11, value: 64, beat: tick, channel: 0 },
        ]);
        const before = [...rows()];
        render(<CCLane {...props} />);
        fireEvent.click(screen.getByRole('group'), { clientX: 8, clientY: valueToY(7, 80) });
        const committed = [...rows()];
        expect(actualMidiUseCases.getHandEditedReturnFamily(committed, { channel: 0, beat: 0 })).toHaveLength(6);
        const { undo, redo } = replay();
        undo();
        expect(rows()).toEqual(before);
        redo();
        expect(rows()).toEqual(committed);
    });

    it('restores the order of a family initially interleaved with another controller', () => {
        const family = headRows(0, 'cc-split:right');
        const peer: MidiCC = { id: 'peer', controller: 11, value: 80, beat: tick, channel: 0 };
        seed([...family.slice(0, 4), peer, ...family.slice(4)]);
        const before = [...rows()];
        render(<CCLane {...props} />);
        fireEvent.click(screen.getByRole('group'), { clientX: 8, clientY: valueToY(7, 80) });
        const committed = [...rows()];
        expect(committed.indexOf(peer)).not.toBe(before.indexOf(peer));
        const { undo, redo } = replay();
        undo();
        expect(rows()).toEqual(before);
        redo();
        expect(rows()).toEqual(committed);
    });

    it.each([
        { gesture: 'add', independent: 'update' },
        { gesture: 'add', independent: 'delete' },
        { gesture: 'move', independent: 'update' },
        { gesture: 'move', independent: 'delete' },
        { gesture: 'remove', independent: 'update' },
        { gesture: 'remove', independent: 'delete' },
    ] as const)(
        'preserves a later independent family $independent when undoing an unrelated $gesture',
        ({ gesture, independent }) => {
            const expression: MidiCC = { id: 'expression', controller: 11, value: 7, beat: 0, channel: 0 };
            seed([...headRows(0, 'cc-split:right'), expression]);
            const view = render(<CCLane {...props} controller={11} />);
            if (gesture === 'add') {
                fireEvent.click(screen.getByRole('group'), { clientX: 8, clientY: valueToY(8, 80) });
            } else {
                const point = view.container.querySelector('[title="Beat 0.00: 7"]');
                expect(point).not.toBeNull();
                if (gesture === 'move') {
                    fireEvent.pointerDown(point!, { pointerId: 1, button: 0 });
                    fireEvent.pointerMove(point!, { pointerId: 1, clientX: 48, clientY: valueToY(9, 80) });
                    fireEvent.pointerUp(point!, { pointerId: 1 });
                } else {
                    fireEvent.doubleClick(point!);
                }
            }
            const { undo, redo } = replay();
            const familyId = 'cc-split:right:rpn-after-carried-2';
            if (independent === 'update') {
                actualMidiUseCases.moveMidiCC('clip-1', familyId, tick, 9);
            } else {
                actualMidiUseCases.removeMidiCC('clip-1', familyId);
            }
            const independentFamily = actualMidiUseCases.getHandEditedReturnFamily(rows(), { channel: 0, beat: 0 });
            undo();
            expect(actualMidiUseCases.getHandEditedReturnFamily(rows(), { channel: 0, beat: 0 })).toEqual(
                independentFamily
            );
            expect(rows().find(({ id }) => id === expression.id)).toEqual(expression);
            redo();
            expect(actualMidiUseCases.getHandEditedReturnFamily(rows(), { channel: 0, beat: 0 })).toEqual(
                independentFamily
            );
        }
    );
});
