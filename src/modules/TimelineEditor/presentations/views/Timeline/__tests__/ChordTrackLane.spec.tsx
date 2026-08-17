import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createAppActionCommittedError } from '#/modules/Command/useCases';

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
    return render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
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
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        expect(screen.getByText(/Right-click to add chords/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Clear all chords')).not.toBeInTheDocument();
    });

    it('renders a chord block with its formatted name and title, and shows the clear button', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        expect(screen.getByText('C')).toBeInTheDocument();
        expect(screen.getByTitle('C — 4 beats')).toBeInTheDocument();
        expect(screen.getByLabelText('Clear all chords')).toBeInTheDocument();
    });

    it('culls chord blocks that scroll off-screen', () => {
        mockChordState = {
            enabled: false,
            events: [oneEvent, { id: 'c2', beat: 1000, duration: 1, root: 2, quality: 'min7' }],
        };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        expect(screen.getByText('C')).toBeInTheDocument();
        expect(screen.queryByText('Dmin7')).not.toBeInTheDocument();
    });

    it('culls against the real viewport width instead of a fixed guess', () => {
        // Beat 300 at pixelsPerBeat=16 → x=4800: past a hard-coded 4000px cull,
        // but well inside a 6000px-wide viewport (#2039).
        mockChordState = {
            enabled: false,
            events: [{ id: 'wide', beat: 300, duration: 1, root: 0, quality: 'major' }],
        };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={6000} />);
        expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('reflects the enabled flag on the power toggle', () => {
        mockChordState = { enabled: true, events: [] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        const power = screen.getByLabelText('Disable harmonic following');
        expect(power).toHaveAttribute('aria-pressed', 'true');
        expect(power).toHaveAttribute('title', 'Harmonic following ON');
    });

    it('dispatches toggle and clear actions through Command', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        fireEvent.click(screen.getByLabelText('Enable harmonic following'));
        expect(executeAppAction).toHaveBeenCalledWith({ type: 'toggleChordTrack', payload: { enabled: true } });

        renderChordLane();
        fireEvent.click(screen.getByLabelText('Clear all chords'));
        expect(executeAppAction).toHaveBeenCalledWith({ type: 'clearChordTrack' });
    });

    it('opens the add-chord popover and quick-adds after the last event', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));

        fireEvent.click(screen.getByRole('button', { name: 'C' }));

        expectAction({ type: 'addChordEvent', payload: { beat: 8, root: 0, quality: 'major', duration: 4 } });
    });

    it('quick-adds at beat 0 when there are no existing events', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));
        fireEvent.click(screen.getByRole('button', { name: 'C' }));
        expectAction({ type: 'addChordEvent', payload: { beat: 0, root: 0, quality: 'major', duration: 4 } });
    });

    it('right-clicking empty space opens the quick-add root menu at the clicked beat', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
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
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        region.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 26 }) as DOMRect);

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });

        expect(screen.getByText('Quality')).toBeInTheDocument();
        expect(screen.getByText('Root')).toBeInTheDocument();

        await runAndSettle(() => fireEvent.click(screen.getByText('min7')));
        expectAction({ type: 'updateChordEvent', payload: { eventId: 'c1', quality: 'min7' } });
        expect(screen.queryByText('Delete Chord')).not.toBeInTheDocument();

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });
        await runAndSettle(() => fireEvent.click(screen.getByRole('menuitemradio', { name: 'D' })));
        expectAction({ type: 'updateChordEvent', payload: { eventId: 'c1', root: 2 } });
        expect(screen.queryByText('Delete Chord')).not.toBeInTheDocument();

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

    it('cancels a pointer-cancel drag without committing', () => {
        renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 9 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 9 });
        fireEvent.pointerCancel(block, { pointerId: 9 });

        expect(block).toHaveStyle({ left: '64px' });
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('resets a lost-capture preview and prevents a later commit', () => {
        renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 10 });
        expect(block.setPointerCapture).toHaveBeenCalledWith(10);
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 10 });
        expect(block).toHaveStyle({ left: '96px' });
        fireEvent.lostPointerCapture(block, { pointerId: 10 });
        expect(block).toHaveStyle({ left: '64px' });
        fireEvent.pointerUp(block, { clientX: 96, pointerId: 10 });

        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('starts capture before an unmount and never commits the abandoned drag', () => {
        const view = renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 11 });
        expect(block.setPointerCapture).toHaveBeenCalledWith(11);
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 11 });
        expect(block).toHaveStyle({ left: '96px' });
        view.unmount();

        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('ignores a secondary-button drag without capture, preview, or dispatch', () => {
        renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 2, clientX: 64, pointerId: 16 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 16 });
        fireEvent.pointerUp(block, { clientX: 96, pointerId: 16 });

        expect(block.setPointerCapture).not.toHaveBeenCalled();
        expect(block).toHaveStyle({ left: '64px' });
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('rejects a second pointer without losing the original drag', () => {
        renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 13 });
        fireEvent.pointerDown(block, { button: 0, clientX: 80, pointerId: 14 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 13 });
        fireEvent.pointerUp(block, { clientX: 96, pointerId: 13 });

        expect(block.setPointerCapture).toHaveBeenCalledTimes(1);
        expectAction({ type: 'moveChordEvent', payload: { eventId: 'c1', beat: 6 } });
    });

    it('clears a drag when pointer-up finds another action pending', () => {
        renderChordLane();
        const block = getChordBlock();

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 15 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 15 });
        fireEvent.keyDown(block, { key: 'ArrowRight' });
        fireEvent.pointerUp(block, { clientX: 96, pointerId: 15 });

        expect(block).toHaveStyle({ left: '64px' });
        expect(executeAppAction).toHaveBeenCalledTimes(1);
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
        const status = screen.getByRole('status');
        const alert = screen.getByRole('alert');
        expect(status).toBeEmptyDOMElement();
        expect(alert).toBeEmptyDOMElement();
        expect(status).toHaveAttribute('aria-atomic', 'true');
        expect(alert).toHaveAttribute('aria-atomic', 'true');

        fireEvent.pointerDown(block, { button: 0, clientX: 64, pointerId: 12 });
        fireEvent.pointerMove(block, { clientX: 96, pointerId: 12 });
        fireEvent.pointerUp(block, { clientX: 96, pointerId: 12 });
        expect(status).toHaveTextContent('Applying chord change');

        rejectAction(new Error('move failed'));
        await waitFor(() => expect(alert).toHaveTextContent('Chord change failed'));
        expect(block).toHaveStyle({ left: '64px' });
    });

    it('treats a committed action error as applied and closes the add popover', async () => {
        executeAppAction.mockRejectedValueOnce(
            createAppActionCommittedError({ actionType: 'addChordEvent', cause: new Error('history failed') })
        );
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));
        fireEvent.click(screen.getByRole('button', { name: 'C' }));

        const alert = screen.getByRole('alert');
        await waitFor(() => expect(alert).toHaveTextContent(/applied/i));
        expect(alert).not.toHaveTextContent(/try again/i);
        expect(screen.queryByRole('button', { name: 'C' })).not.toBeInTheDocument();
    });

    it('gates a newer menu while an older menu action is pending', async () => {
        let resolveAction: () => void = () => {};
        executeAppAction.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveAction = resolve)));
        renderChordLane();
        const region = screen.getByRole('region', { name: 'Chord track' });
        region.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 26 }) as DOMRect);

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });
        fireEvent.click(screen.getByText('min7'));
        fireEvent.contextMenu(region, { clientX: 200, clientY: 10 });

        expect(screen.queryByText('Beat 12')).not.toBeInTheDocument();
        resolveAction();
        await waitFor(() => expect(screen.queryByText('Delete Chord')).not.toBeInTheDocument());
    });

    it('implements APG menu navigation, dismissal, and opener focus restoration', () => {
        renderChordLane();
        const block = getChordBlock();
        block.focus();
        expect(block).toHaveAttribute('aria-haspopup', 'menu');
        expect(block).toHaveAttribute('aria-expanded', 'false');

        fireEvent.keyDown(block, { key: 'F10', shiftKey: true });
        const menu = screen.getByRole('menu', { name: 'Chord actions for C' });
        expect(block).toHaveAttribute('aria-expanded', 'true');
        expect(within(menu).getByRole('menuitemradio', { name: 'major' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(within(menu).getByRole('menuitemradio', { name: 'minor' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'End' });
        expect(within(menu).getByRole('menuitem', { name: 'Delete Chord' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'Home' });
        expect(within(menu).getByRole('menuitemradio', { name: 'major' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'Escape' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(block).toHaveFocus();
    });

    it('keeps menu items out of the tab sequence and traverses the page in either direction', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(
            <div>
                <button type="button">Before lane</button>
                <ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />
                <button type="button">After lane</button>
            </div>
        );
        const block = getChordBlock();

        block.focus();
        fireEvent.keyDown(block, { key: 'Enter' });
        let menu = screen.getByRole('menu');
        expect(menu.querySelectorAll('[role^="menuitem"][tabindex="-1"]')).toHaveLength(
            menu.querySelectorAll('[role^="menuitem"]').length
        );
        fireEvent.keyDown(menu, { key: 'Tab' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'After lane' })).toHaveFocus();

        block.focus();
        fireEvent.keyDown(block, { key: 'Enter' });
        menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'Tab', shiftKey: true });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear all chords' })).toHaveFocus();
    });

    it('contains chord opener and menu keys before global shortcuts observe them', () => {
        const globalShortcutEffect = vi.fn();
        window.addEventListener('keydown', globalShortcutEffect);
        renderChordLane();
        const block = getChordBlock();

        block.focus();
        fireEvent.keyDown(block, { key: 'Enter' });
        let menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'Home' });
        fireEvent.keyDown(menu, { key: 'End' });
        fireEvent.keyDown(document.activeElement!, { key: ' ' });
        fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
        fireEvent.keyDown(menu, { key: 'Tab' });

        block.focus();
        fireEvent.keyDown(block, { key: ' ' });
        menu = screen.getByRole('menu');
        fireEvent.keyDown(menu, { key: 'Escape' });
        window.removeEventListener('keydown', globalShortcutEffect);

        expect(globalShortcutEffect).not.toHaveBeenCalled();
    });

    it('restores a nested-label pointer opener on Escape', () => {
        renderChordLane();
        const block = getChordBlock();
        const label = within(block).getByText('C');

        fireEvent.contextMenu(label, { clientX: 64, clientY: 10 });
        const menu = screen.getByRole('menu');
        expect(within(menu).getByRole('menuitemradio', { name: 'major' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'Escape' });

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(block).toHaveFocus();
    });

    it('owns fallback focus for body-active empty-space Tab dismissal', () => {
        render(
            <div>
                <ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />
                <button type="button">After lane</button>
            </div>
        );
        const region = screen.getByRole('region', { name: 'Chord track' });
        const addButton = screen.getByLabelText('Add chord event');

        expect(document.activeElement).toBe(document.body);
        fireEvent.contextMenu(region, { clientX: 200, clientY: 10 });
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
        expect(screen.getByRole('button', { name: 'After lane' })).toHaveFocus();

        screen.getByRole('button', { name: 'After lane' }).blur();
        expect(document.activeElement).toBe(document.body);
        fireEvent.contextMenu(region, { clientX: 200, clientY: 10 });
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab', shiftKey: true });
        expect(screen.getByLabelText('Enable harmonic following')).toHaveFocus();

        addButton.focus();
        fireEvent.contextMenu(region, { clientX: 200, clientY: 10 });
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        expect(addButton).toHaveFocus();

        fireEvent.contextMenu(region, { clientX: 200, clientY: 10 });
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
        expect(screen.getByRole('button', { name: 'After lane' })).toHaveFocus();

        addButton.focus();
        fireEvent.contextMenu(region, { clientX: 200, clientY: 10 });
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab', shiftKey: true });
        expect(screen.getByLabelText('Enable harmonic following')).toHaveFocus();
    });

    it('labels root and quality as checked radio groups', () => {
        renderChordLane();
        fireEvent.contextMenu(screen.getByRole('region', { name: 'Chord track' }), { clientX: 64, clientY: 10 });

        const quality = screen.getByRole('group', { name: 'Quality' });
        expect(within(quality).getByRole('menuitemradio', { name: 'major' })).toHaveAttribute('aria-checked', 'true');
        expect(within(quality).getByRole('menuitemradio', { name: 'minor' })).toHaveAttribute('aria-checked', 'false');
        const root = screen.getByRole('group', { name: 'Root' });
        expect(within(root).getByRole('menuitemradio', { name: 'C' })).toHaveAttribute('aria-checked', 'true');
    });

    it.each(['9', 'min9'] as const)('checks a persisted %s quality outside the quick-add shortlist', (quality) => {
        mockChordState = { enabled: false, events: [{ ...oneEvent, quality }] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        fireEvent.contextMenu(screen.getByRole('region', { name: 'Chord track' }), { clientX: 64, clientY: 10 });

        const qualityGroup = screen.getByRole('group', { name: 'Quality' });
        expect(within(qualityGroup).getByRole('menuitemradio', { name: quality })).toHaveAttribute(
            'aria-checked',
            'true'
        );
    });

    it('announces the destination beat after a successful keyboard move', async () => {
        executeAppAction.mockResolvedValueOnce(undefined);
        renderChordLane();
        const block = getChordBlock();
        const status = screen.getByRole('status');
        const alert = screen.getByRole('alert');
        expect(status).toBeEmptyDOMElement();
        expect(alert).toBeEmptyDOMElement();
        block.focus();

        await runAndSettle(() => fireEvent.keyDown(block, { key: 'ArrowRight' }));

        expectAction({ type: 'moveChordEvent', payload: { eventId: 'c1', beat: 4.25 } });
        expect(status).toHaveTextContent('Moved C chord to beat 4.25');
        expect(alert).toBeEmptyDOMElement();
        expect(block).toHaveFocus();
    });

    it('shows only the committed-error alert after a keyboard move', async () => {
        executeAppAction.mockRejectedValueOnce(
            createAppActionCommittedError({ actionType: 'moveChordEvent', cause: new Error('history failed') })
        );
        renderChordLane();
        const block = getChordBlock();
        const status = screen.getByRole('status');
        const alert = screen.getByRole('alert');

        await runAndSettle(() => fireEvent.keyDown(block, { key: 'ArrowRight' }));

        await waitFor(() => expect(alert).toHaveTextContent(/applied/i));
        expect(status).toBeEmptyDOMElement();
    });

    it('shows only the committed-error alert and restores focus after keyboard delete', async () => {
        executeAppAction.mockRejectedValueOnce(
            createAppActionCommittedError({ actionType: 'removeChordEvent', cause: new Error('history failed') })
        );
        const view = renderChordLane();
        const block = getChordBlock();
        const status = screen.getByRole('status');
        const alert = screen.getByRole('alert');

        await runAndSettle(() => fireEvent.keyDown(block, { key: 'Delete' }));
        mockChordState = { enabled: false, events: [] };
        view.rerender(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);

        await waitFor(() => expect(alert).toHaveTextContent(/applied/i));
        expect(status).toBeEmptyDOMElement();
        expect(screen.getByLabelText('Add chord event')).toHaveFocus();
    });

    it('restores focus and announces a keyboard deletion after rerender', async () => {
        executeAppAction.mockResolvedValueOnce(undefined);
        const view = renderChordLane();
        const block = getChordBlock();
        block.focus();

        await runAndSettle(() => fireEvent.keyDown(block, { key: 'Delete' }));
        mockChordState = { enabled: false, events: [] };
        view.rerender(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);

        expect(screen.getByLabelText('Add chord event')).toHaveFocus();
        expect(screen.getByRole('status')).toHaveTextContent('Removed C chord at beat 4');
    });

    it('closes an open context menu on an outside click', () => {
        mockChordState = { enabled: false, events: [oneEvent] };
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        const region = screen.getByRole('region', { name: 'Chord track' });
        region.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 26 }) as DOMRect);

        fireEvent.contextMenu(region, { clientX: 100, clientY: 10 });
        expect(screen.getByText('Delete Chord')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Delete Chord')).not.toBeInTheDocument();
    });

    it('closes the add-chord popover on an outside click', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} viewportWidth={1000} />);
        fireEvent.click(screen.getByLabelText('Add chord event'));
        expect(screen.getByRole('button', { name: 'C' })).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('button', { name: 'C' })).not.toBeInTheDocument();
    });
});
