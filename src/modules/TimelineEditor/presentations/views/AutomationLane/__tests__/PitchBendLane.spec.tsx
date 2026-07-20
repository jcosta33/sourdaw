import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { pushUndoEntry } from '#/modules/Command/useCases';
import { addPitchBend, removePitchBend, movePitchBend } from '#/modules/MIDI/useCases';

import { type MidiPitchBend } from '../../../../models/MidiNoteViewTypes';
import { PitchBendLane } from '../PitchBendLane';

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
    const pitchBendByClipId: Record<string, MidiPitchBend[]> = {};
    return { midiState: { pitchBendByClipId } };
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
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    addPitchBend: vi.fn((clipId: string, value: number, beat: number, channel: number = 0): MidiPitchBend => {
        const pb: MidiPitchBend = { id: `pb-${beat}-${value}`, value, beat, channel };
        const existing = laneMocks.midiState.pitchBendByClipId[clipId] ?? [];
        laneMocks.midiState.pitchBendByClipId[clipId] = [...existing, pb];
        return pb;
    }),
    removePitchBend: vi.fn((clipId: string, pbId: string): void => {
        const existing = laneMocks.midiState.pitchBendByClipId[clipId] ?? [];
        laneMocks.midiState.pitchBendByClipId[clipId] = existing.filter((point) => point.id !== pbId);
    }),
    movePitchBend: vi.fn((clipId: string, pbId: string, beat: number, value: number): void => {
        const existing = laneMocks.midiState.pitchBendByClipId[clipId] ?? [];
        laneMocks.midiState.pitchBendByClipId[clipId] = existing.map((point) =>
            point.id === pbId ? { ...point, beat, value } : point
        );
    }),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => store.value ?? fallback),
}));

vi.mock('../../../helpers/laneConstants', () => ({
    PITCH_BEND_CENTER: 64,
}));

// Mirrors PitchBendLane's private coordinate math so expected draw positions are derived,
// never hand-computed magic numbers.
const beatToX = (beat: number, beatWidth: number): number => beat * beatWidth + 8;
const valueToY = (value: number, height: number): number => height - (value / 127) * (height - 8) - 4;
const beatFromX = (x: number, beatWidth: number): number => Math.max(0, (x - 8) / beatWidth);
const valueFromY = (y: number, height: number): number =>
    Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

describe('PitchBendLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        beatWidth: 40,
        contentWidth: 800,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        laneMocks.midiState = { pitchBendByClipId: {} };
    });

    it('should render without crashing with clipId', () => {
        render(<PitchBendLane {...defaultProps} />);
        expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('should render blocked state when clipId is null', () => {
        render(<PitchBendLane {...defaultProps} clipId={null} />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
        expect(screen.getByText('No clip selected')).toBeInTheDocument();
    });

    it('should render with correct aria-label', () => {
        render(<PitchBendLane {...defaultProps} />);
        expect(screen.getByLabelText('Pitch bend automation lane')).toBeInTheDocument();
    });

    it('should render add hint when no points exist', () => {
        render(<PitchBendLane {...defaultProps} />);
        expect(screen.getByText(/Click to add pitch bend points/)).toBeInTheDocument();
    });

    describe('point rendering', () => {
        it('should render points for the clip sorted by beat', () => {
            laneMocks.midiState.pitchBendByClipId['clip-1'] = [
                { id: 'pb-b', value: 90, beat: 3, channel: 0 },
                { id: 'pb-a', value: 20, beat: 1, channel: 0 },
            ];
            const { container } = render(<PitchBendLane {...defaultProps} />);
            const points = container.querySelectorAll('[data-pb-point="true"]');
            expect(points).toHaveLength(2);
            expect(points[0]).toHaveAttribute('title', 'Beat 1.00: 20 (center: 64)');
            expect(points[1]).toHaveAttribute('title', 'Beat 3.00: 90 (center: 64)');
        });

        it('should always draw the center reference line at the pitch-bend-center value', () => {
            const { container } = render(<PitchBendLane {...defaultProps} />);
            const centerLine = container.querySelector('svg line');
            expect(centerLine).not.toBeNull();
            // containerRef.current is still null during the render that produces this JSX (refs
            // attach after commit), so the `?? 80` fallback governs the height on every fresh mount.
            expect(centerLine).toHaveAttribute('y1', String(valueToY(64, 80)));
            expect(centerLine).toHaveAttribute('y2', String(valueToY(64, 80)));
        });

        it('should draw a connecting polyline once more than one point exists', () => {
            laneMocks.midiState.pitchBendByClipId['clip-1'] = [
                { id: 'pb-a', value: 0, beat: 0, channel: 0 },
                { id: 'pb-b', value: 127, beat: 2, channel: 0 },
            ];
            const { container } = render(<PitchBendLane {...defaultProps} />);
            const polyline = container.querySelector('polyline');
            expect(polyline).not.toBeNull();
            const expectedPoints = `${beatToX(0, 40)},${valueToY(0, 80)} ${beatToX(2, 40)},${valueToY(127, 80)}`;
            expect(polyline).toHaveAttribute('points', expectedPoints);
        });

        it('should not draw a polyline with zero or one point', () => {
            laneMocks.midiState.pitchBendByClipId['clip-1'] = [{ id: 'pb-a', value: 10, beat: 0, channel: 0 }];
            const { container } = render(<PitchBendLane {...defaultProps} />);
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

        it('should add a pitch bend point at the clicked beat/value on container click', () => {
            render(<PitchBendLane {...defaultProps} />);
            const beat = beatFromX(48, defaultProps.beatWidth);
            const value = valueFromY(76, 80);

            fireEvent.click(screen.getByRole('group'), { clientX: 48, clientY: 76 });

            expect(addPitchBend).toHaveBeenCalledWith('clip-1', value, beat);
            expect(pushUndoEntry).toHaveBeenCalledWith(
                'Add pitch bend point',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('should wire undo/redo for an added point to remove/re-add it', () => {
            render(<PitchBendLane {...defaultProps} />);
            fireEvent.click(screen.getByRole('group'), { clientX: 48, clientY: 76 });

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            expect(undoFn).toBeDefined();
            expect(redoFn).toBeDefined();

            vi.mocked(removePitchBend).mockClear();
            undoFn!();
            expect(removePitchBend).toHaveBeenCalledWith('clip-1', expect.any(String));

            vi.mocked(addPitchBend).mockClear();
            redoFn!();
            expect(addPitchBend).toHaveBeenCalledWith(
                'clip-1',
                valueFromY(76, 80),
                beatFromX(48, defaultProps.beatWidth)
            );
        });

        it('should not add a point when the click target is an existing pitch bend point', () => {
            laneMocks.midiState.pitchBendByClipId['clip-1'] = [{ id: 'pb-a', value: 10, beat: 0, channel: 0 }];
            const { container } = render(<PitchBendLane {...defaultProps} />);
            const point = container.querySelector('[data-pb-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.click(point!, { clientX: 48, clientY: 76 });

            expect(addPitchBend).not.toHaveBeenCalled();
        });
    });

    describe('dragging a point', () => {
        beforeEach(() => {
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 80));
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should move a point via drag and push a Move undo entry on release when changed', () => {
            laneMocks.midiState.pitchBendByClipId['clip-1'] = [{ id: 'pb-a', value: 20, beat: 0, channel: 0 }];
            const { container } = render(<PitchBendLane {...defaultProps} />);
            const point = container.querySelector('[data-pb-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.mouseDown(point!, { clientX: 8, clientY: 76 });
            fireEvent(window, new MouseEvent('mousemove', { clientX: 88, clientY: 20, bubbles: true }));

            const expectedBeat = beatFromX(88, defaultProps.beatWidth);
            const expectedValue = valueFromY(20, 80);
            expect(movePitchBend).toHaveBeenCalledWith('clip-1', 'pb-a', expectedBeat, expectedValue);

            fireEvent(window, new MouseEvent('mouseup', { bubbles: true }));

            expect(pushUndoEntry).toHaveBeenCalledWith(
                'Move pitch bend point',
                expect.any(Function),
                expect.any(Function)
            );
            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            vi.mocked(movePitchBend).mockClear();
            undoFn!();
            expect(movePitchBend).toHaveBeenCalledWith('clip-1', 'pb-a', 0, 20);

            const redoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[2];
            vi.mocked(movePitchBend).mockClear();
            redoFn!();
            expect(movePitchBend).toHaveBeenCalledWith('clip-1', 'pb-a', expectedBeat, expectedValue);
        });

        it('should not push a Move undo entry when the drag ends without changing the point', () => {
            laneMocks.midiState.pitchBendByClipId['clip-1'] = [{ id: 'pb-a', value: 20, beat: 0, channel: 0 }];
            const { container } = render(<PitchBendLane {...defaultProps} />);
            const point = container.querySelector('[data-pb-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.mouseDown(point!, { clientX: 8, clientY: 76 });
            fireEvent(window, new MouseEvent('mouseup', { bubbles: true }));

            expect(pushUndoEntry).not.toHaveBeenCalled();
        });
    });

    describe('removing a point', () => {
        it('should remove a point on double-click and push a Remove undo entry', () => {
            laneMocks.midiState.pitchBendByClipId['clip-1'] = [{ id: 'pb-a', value: 20, beat: 0, channel: 0 }];
            const { container } = render(<PitchBendLane {...defaultProps} />);
            const point = container.querySelector('[data-pb-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.doubleClick(point!);

            expect(removePitchBend).toHaveBeenCalledWith('clip-1', 'pb-a');
            expect(pushUndoEntry).toHaveBeenCalledWith(
                'Remove pitch bend point',
                expect.any(Function),
                expect.any(Function)
            );

            const undoFn = vi.mocked(pushUndoEntry).mock.calls[0]?.[1];
            vi.mocked(addPitchBend).mockClear();
            undoFn!();
            expect(addPitchBend).toHaveBeenCalledWith('clip-1', 20, 0, 0);
        });
    });
});
