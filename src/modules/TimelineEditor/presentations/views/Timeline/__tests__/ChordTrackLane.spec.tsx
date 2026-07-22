import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChordTrackLane } from '../ChordTrackLane';

let mockChordState: { enabled: boolean; events: Array<Record<string, unknown>> } = { enabled: false, events: [] };

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => mockChordState),
}));

const executeAppAction = vi.fn((_action: unknown) => Promise.resolve());

vi.mock('#/modules/Command/useCases', async () => ({
    ...(await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases')),
    executeAppAction: (action: unknown) => executeAppAction(action),
}));

const oneEvent = { id: 'c1', beat: 4, duration: 4, root: 0, quality: 'major' };

describe('ChordTrackLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockChordState = { enabled: false, events: [] };
    });

    it('shows the empty-state hint and hides the clear button when there are no chords', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        expect(screen.getByText(/Right-click to add chords/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Clear all chords')).not.toBeInTheDocument();
    });

    it('renders a chord block with its formatted name and title, and shows the clear button', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        expect(screen.getByText('C')).toBeInTheDocument();
        expect(screen.getByTitle('C — 4 beats')).toBeInTheDocument();
        expect(screen.getByLabelText('Clear all chords')).toBeInTheDocument();
    });

    it('culls chord blocks that scroll off-screen', () => {
        mockChordState = {
            enabled: false,
            events: [oneEvent, { id: 'c2', beat: 1000, duration: 1, root: 2, quality: 'min7' }],
        };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        expect(screen.getByText('C')).toBeInTheDocument();
        expect(screen.queryByText('Dmin7')).not.toBeInTheDocument();
    });

    it('reflects the enabled flag on the power toggle', () => {
        mockChordState = { enabled: true, events: [] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const power = screen.getByLabelText('Disable harmonic following');
        expect(power).toHaveAttribute('aria-pressed', 'true');
        expect(power).toHaveAttribute('title', 'Harmonic following ON');
    });

    it('dispatches toggleChordTrack when the power button is clicked', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        fireEvent.click(screen.getByLabelText('Enable harmonic following'));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'toggleChordTrack',
            payload: { enabled: true },
        });
    });

    it('dispatches clearChordTrack when the clear button is clicked', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        fireEvent.click(screen.getByLabelText('Clear all chords'));
        expect(executeAppAction).toHaveBeenCalledWith({ type: 'clearChordTrack' });
    });

    it('opens the add-chord popover and quick-adds after the last event', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));

        fireEvent.click(screen.getByRole('button', { name: 'C' }));

        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'addChordEvent',
            payload: { beat: 8, root: 0, quality: 'major', duration: 4 },
        });
    });

    it('quick-adds at beat 0 when there are no existing events', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));
        fireEvent.click(screen.getByRole('button', { name: 'C' }));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'addChordEvent',
            payload: { beat: 0, root: 0, quality: 'major', duration: 4 },
        });
    });

    it('right-clicking empty space opens the quick-add root menu at the clicked beat', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        region.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 26 }) as DOMRect);

        fireEvent.contextMenu(region, { clientX: 200, clientY: 10 });

        expect(screen.getByText('Beat 12')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Add C'));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'addChordEvent',
            payload: { beat: 12, root: 0, quality: 'major', duration: 4 },
        });
    });

    it('right-clicking an existing chord opens its quality/root/delete menu', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        region.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 26 }) as DOMRect);

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });

        expect(screen.getByText('Quality')).toBeInTheDocument();
        expect(screen.getByText('Root')).toBeInTheDocument();

        fireEvent.click(screen.getByText('min7'));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'updateChordEvent',
            payload: { eventId: 'c1', quality: 'min7' },
        });

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });
        fireEvent.click(screen.getByRole('button', { name: 'D' }));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'updateChordEvent',
            payload: { eventId: 'c1', root: 2 },
        });

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });
        fireEvent.click(screen.getByText('Delete Chord'));
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'removeChordEvent',
            payload: { eventId: 'c1' },
        });
    });

    it('drags a chord to a new beat, quantized to a sixteenth note', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        const block = screen.getByTitle('C — 4 beats');

        fireEvent.mouseDown(block, { button: 0, clientX: 64 });
        fireEvent.mouseMove(region, { clientX: 96 });
        expect(executeAppAction).not.toHaveBeenCalled();

        fireEvent.mouseUp(region);
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'moveChordEvent',
            payload: { eventId: 'c1', beat: 6 },
        });
        executeAppAction.mockClear();
        fireEvent.mouseMove(region, { clientX: 200 });
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('ignores non-primary-button mouse down for drag', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        const block = screen.getByTitle('C — 4 beats');

        fireEvent.mouseDown(block, { button: 2, clientX: 64 });
        fireEvent.mouseMove(region, { clientX: 200 });
        fireEvent.mouseUp(region);
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('closes an open context menu on an outside click', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        region.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 26 }) as DOMRect);

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });
        expect(screen.getByText('Delete Chord')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Delete Chord')).not.toBeInTheDocument();
    });

    it('closes the add-chord popover on an outside click', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));
        expect(screen.getByRole('button', { name: 'C' })).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('button', { name: 'C' })).not.toBeInTheDocument();
    });
});
