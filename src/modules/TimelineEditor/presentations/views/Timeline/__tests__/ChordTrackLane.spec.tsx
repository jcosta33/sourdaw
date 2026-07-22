import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChordTrackLane } from '../ChordTrackLane';

let mockChordState: { enabled: boolean; events: Array<Record<string, unknown>> } = { enabled: false, events: [] };

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => mockChordState),
}));

const { executeAppAction } = vi.hoisted(() => ({
    executeAppAction: vi.fn<typeof import('#/modules/Command/useCases').executeAppAction>(),
}));

vi.mock('#/modules/Command/useCases', async () => ({
    ...(await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases')),
    executeAppAction: (action: Parameters<typeof executeAppAction>[0]) => executeAppAction(action),
}));

const oneEvent = { id: 'c1', beat: 4, duration: 4, root: 0, quality: 'major' };

function renderChordLane() {
    mockChordState = { enabled: false, events: [oneEvent] };
    return render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
}

function getChordBlock(): HTMLElement {
    const block = screen.getByRole('button', { name: 'C chord at beat 4' });
    Object.defineProperties(block, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    return block;
}

function expectAction(action: Parameters<typeof executeAppAction>[0]): void {
    expect(executeAppAction).toHaveBeenCalledWith(action);
}

async function runAndSettle(interaction: () => void): Promise<void> {
    await act(async () => {
        interaction();
        await Promise.resolve();
    });
}

describe('ChordTrackLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        executeAppAction.mockReturnValue(new Promise<void>(() => {}));
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

    it('dispatches toggle and clear actions through Command', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        fireEvent.click(screen.getByLabelText('Enable harmonic following'));
        expect(executeAppAction).toHaveBeenCalledWith({ type: 'toggleChordTrack', payload: { enabled: true } });

        renderChordLane();
        fireEvent.click(screen.getByLabelText('Clear all chords'));
        expect(executeAppAction).toHaveBeenCalledWith({ type: 'clearChordTrack' });
    });

    it('opens the add-chord popover and quick-adds after the last event', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));

        fireEvent.click(screen.getByRole('button', { name: 'C' }));

        expectAction({ type: 'addChordEvent', payload: { beat: 8, root: 0, quality: 'major', duration: 4 } });
    });

    it('quick-adds at beat 0 when there are no existing events', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));
        fireEvent.click(screen.getByRole('button', { name: 'C' }));
        expectAction({ type: 'addChordEvent', payload: { beat: 0, root: 0, quality: 'major', duration: 4 } });
    });

    it('right-clicking empty space opens the quick-add root menu at the clicked beat', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        region.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 26 }) as DOMRect);

        fireEvent.contextMenu(region, { clientX: 200, clientY: 10 });

        expect(screen.getByText('Beat 12')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Add C'));
        expectAction({ type: 'addChordEvent', payload: { beat: 12, root: 0, quality: 'major', duration: 4 } });
    });

    it('right-clicking an existing chord opens its quality/root/delete menu', async () => {
        executeAppAction.mockResolvedValue(undefined);
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        region.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 26 }) as DOMRect);

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });

        expect(screen.getByText('Quality')).toBeInTheDocument();
        expect(screen.getByText('Root')).toBeInTheDocument();

        await runAndSettle(() => fireEvent.click(screen.getByText('min7')));
        expectAction({ type: 'updateChordEvent', payload: { eventId: 'c1', quality: 'min7' } });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });
        await runAndSettle(() => fireEvent.click(screen.getByRole('menuitem', { name: 'D' })));
        expectAction({ type: 'updateChordEvent', payload: { eventId: 'c1', root: 2 } });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });
        await runAndSettle(() => fireEvent.click(screen.getByText('Delete Chord')));
        expectAction({ type: 'removeChordEvent', payload: { eventId: 'c1' } });
    });

    it('keeps a stable drag preview on lane exit without committing', () => {
        renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 7 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 7 });
        fireEvent.pointerLeave(block, { clientX: 120, pointerId: 7 });

        expect(block).toHaveStyle({ left: '96px' });
        expect(block.setPointerCapture).toHaveBeenCalledWith(7);
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('commits once when captured pointer-up occurs outside the lane', async () => {
        renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 8 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 8 });
        fireEvent.pointerLeave(block, { clientX: 120, pointerId: 8 });
        fireEvent.pointerUp(block, { clientX: 120, pointerId: 8 });

        await waitFor(() => {
            expect(executeAppAction).toHaveBeenCalledTimes(1);
        });
        expectAction({ type: 'moveChordEvent', payload: { eventId: 'c1', beat: 6 } });
    });

    it('cancels pointer-cancel, lost-capture, and unmount drags without committing', () => {
        const view = renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 9 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 9 });
        fireEvent.pointerCancel(block, { pointerId: 9 });
        expect(block).toHaveStyle({ left: '64px' });

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 10 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 10 });
        fireEvent.lostPointerCapture(block, { pointerId: 10 });

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 11 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 11 });
        view.unmount();
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('supports keyboard focus, movement, context-menu actions, and direct delete', async () => {
        executeAppAction.mockResolvedValue(undefined);
        renderChordLane();
        const block = getChordBlock();
        block.focus();
        expect(block).toHaveFocus();

        await runAndSettle(() => fireEvent.keyDown(block, { key: 'ArrowRight' }));
        expectAction({ type: 'moveChordEvent', payload: { eventId: 'c1', beat: 4.25 } });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        executeAppAction.mockClear();
        fireEvent.keyDown(block, { key: 'F10', shiftKey: true });
        const deleteItem = screen.getByRole('menuitem', { name: 'Delete Chord' });
        deleteItem.focus();
        await runAndSettle(() => fireEvent.click(deleteItem, { detail: 0 }));
        await waitFor(() => {
            expect(executeAppAction).toHaveBeenCalledWith({ type: 'removeChordEvent', payload: { eventId: 'c1' } });
        });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        executeAppAction.mockClear();
        executeAppAction.mockReturnValue(new Promise<void>(() => {}));
        fireEvent.keyDown(block, { key: 'Delete' });
        expect(executeAppAction).toHaveBeenCalledWith({ type: 'removeChordEvent', payload: { eventId: 'c1' } });
    });

    it('shows pending then rolls back preview with an alert when drag dispatch rejects', async () => {
        let rejectAction: (reason: unknown) => void = () => {};
        executeAppAction.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectAction = reject;
                })
        );
        renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 12 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 12 });
        fireEvent.pointerUp(block, { clientX: 96, pointerId: 12 });
        expect(screen.getByRole('status')).toHaveTextContent('Applying chord change');

        rejectAction(new Error('move failed'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Chord change failed');
        expect(block).toHaveStyle({ left: '64px' });
    });

    it('keeps the keyboard-opened menu visible and alerts when its action rejects', async () => {
        executeAppAction.mockRejectedValueOnce(new Error('menu failed'));
        renderChordLane();
        const block = getChordBlock();

        fireEvent.keyDown(block, { key: 'F10', shiftKey: true });
        fireEvent.click(screen.getByRole('menuitem', { name: 'min7' }), { detail: 0 });

        expect(await screen.findByRole('alert')).toHaveTextContent('Chord change failed');
        expect(screen.getByRole('menu', { name: 'Chord actions for C' })).toBeInTheDocument();
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
