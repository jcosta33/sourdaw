import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setlistStore, type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { addSetlistItem } from '../../../useCases/setlist/addSetlistItem';
import { getRemainingDuration } from '../../../useCases/setlist/getRemainingDuration';
import { getSetlistProgress } from '../../../useCases/setlist/getSetlistProgress';
import { goToItem } from '../../../useCases/setlist/goToItem';
import { nextItem } from '../../../useCases/setlist/nextItem';
import { previousItem } from '../../../useCases/setlist/previousItem';
import { removeSetlistItem } from '../../../useCases/setlist/removeSetlistItem';
import { renameSetlist } from '../../../useCases/setlist/renameSetlist';
import { reorderSetlistItems } from '../../../useCases/setlist/reorderSetlistItems';
import { setCountIn } from '../../../useCases/setlist/setCountIn';
import { toggleAutoAdvance } from '../../../useCases/setlist/toggleAutoAdvance';
import { updateSetlistItem } from '../../../useCases/setlist/updateSetlistItem';
import { SetlistPanel } from '../SetlistPanel';

// Mock the mutation use cases so we assert the panel wires callbacks to the
// correct handlers, without depending on DI/undo machinery. The read-side
// (getSetlistProgress / getRemainingDuration) stays real so computed labels
// are asserted against actual derived values. Vitest hoists vi.mock calls
// above the imports, so the imported references resolve to the mocked fns.
vi.mock('../../../useCases/setlist/addSetlistItem', () => ({
    addSetlistItem: vi.fn(),
}));
vi.mock('../../../useCases/setlist/removeSetlistItem', () => ({
    removeSetlistItem: vi.fn(),
}));
vi.mock('../../../useCases/setlist/reorderSetlistItems', () => ({
    reorderSetlistItems: vi.fn(),
}));
vi.mock('../../../useCases/setlist/updateSetlistItem', () => ({
    updateSetlistItem: vi.fn(),
}));
vi.mock('../../../useCases/setlist/renameSetlist', () => ({
    renameSetlist: vi.fn(),
}));
vi.mock('../../../useCases/setlist/setCountIn', () => ({
    setCountIn: vi.fn(),
}));
vi.mock('../../../useCases/setlist/toggleAutoAdvance', () => ({
    toggleAutoAdvance: vi.fn(),
}));
vi.mock('../../../useCases/setlist/nextItem', () => ({
    nextItem: vi.fn(),
}));
vi.mock('../../../useCases/setlist/previousItem', () => ({
    previousItem: vi.fn(),
}));
vi.mock('../../../useCases/setlist/goToItem', () => ({
    goToItem: vi.fn(),
}));
// Wrap (rather than replace) the real implementations so existing readout
// assertions keep exercising real computed values while F11's regression
// test can additionally assert these are never called during render.
vi.mock('../../../useCases/setlist/getSetlistProgress', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../useCases/setlist/getSetlistProgress')>();
    return { getSetlistProgress: vi.fn(actual.getSetlistProgress) };
});
vi.mock('../../../useCases/setlist/getRemainingDuration', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../useCases/setlist/getRemainingDuration')>();
    return { getRemainingDuration: vi.fn(actual.getRemainingDuration) };
});

function makeItem(overrides: Partial<SetlistItem> = {}): SetlistItem {
    return {
        id: `item-${Math.random().toString(36).slice(2)}`,
        name: 'Song',
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration: 0,
        notes: '',
        programChange: null,
        color: '#ff0000',
        autoStop: false,
        gapSeconds: 0,
        markers: [],
        ...overrides,
    };
}

function seed(overrides: Partial<SetlistState> = {}): void {
    setlistStore.set({
        name: 'Untitled Setlist',
        items: [],
        currentIndex: 0,
        autoAdvance: false,
        countInBars: 1,
        totalDuration: 0,
        ...overrides,
    });
}

describe('SetlistPanel', () => {
    beforeEach(() => {
        seed();
        vi.clearAllMocks();
    });

    describe('empty state', () => {
        it('renders the empty-state readout "0 of 0" and "0:00 remaining" when there are no items', () => {
            render(<SetlistPanel />);
            expect(screen.getByText('0 of 0')).toBeTruthy();
            expect(screen.getByText('0:00 remaining')).toBeTruthy();
        });

        it('renders the DawEmptyState with an Add-first-item action and no item list', () => {
            render(<SetlistPanel />);
            expect(screen.getByText('No setlist items')).toBeTruthy();
            expect(screen.getByRole('button', { name: 'Add first item' })).toBeTruthy();
            expect(screen.queryByRole('list')).toBeNull();
        });

        it('calls addSetlistItem with a "Song N" name based on current item count from the empty-state action', () => {
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Add first item' }));
            expect(addSetlistItem).toHaveBeenCalledWith('Song 1');
            expect(addSetlistItem).toHaveBeenCalledTimes(1);
        });
    });

    describe('transport controls disabled state', () => {
        it('disables Previous and Next when there are no items', () => {
            render(<SetlistPanel />);
            expect(screen.getByRole('button', { name: 'Previous item' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Next item' })).toBeDisabled();
        });
    });

    describe('item list rendering', () => {
        it('renders a listitem for each entry and the computed progress readout', () => {
            seed({
                items: [
                    makeItem({ id: 'a', name: 'Opener', estimatedDuration: 120 }),
                    makeItem({ id: 'b', name: 'Closer', estimatedDuration: 65, gapSeconds: 5 }),
                ],
                currentIndex: 1,
            });
            render(<SetlistPanel />);
            const items = screen.getAllByRole('listitem');
            expect(items).toHaveLength(2);
            // currentIndex 1 of 2 items → "2 of 2"
            expect(screen.getByText('2 of 2')).toBeTruthy();
        });

        it('formats each item duration as m:ss', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener', estimatedDuration: 125 })],
            });
            render(<SetlistPanel />);
            expect(screen.getByText('2:05')).toBeTruthy();
        });

        it('clamps negative/NaN durations to 0:00 via formatDuration', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener', estimatedDuration: -40 })],
            });
            render(<SetlistPanel />);
            expect(screen.getByText('0:00')).toBeTruthy();
        });

        it('renders the remaining duration across items from currentIndex onward', () => {
            seed({
                items: [
                    makeItem({ id: 'a', name: 'Past', estimatedDuration: 100, gapSeconds: 0 }),
                    makeItem({ id: 'b', name: 'Now', estimatedDuration: 60, gapSeconds: 3 }),
                    makeItem({ id: 'c', name: 'Next', estimatedDuration: 57, gapSeconds: 3 }),
                ],
                currentIndex: 1,
            });
            render(<SetlistPanel />);
            // remaining = 60 + 3 + 57 + 3 = 123s → 2:03
            expect(screen.getByText('2:03 remaining')).toBeTruthy();
        });

        it('derives the progress/remaining readout from the subscribed state, not a fresh store read (F11)', () => {
            // Regression: buildProgressDisplay called getSetlistProgress() /
            // getRemainingDuration(), both of which read setlistStore.value
            // directly instead of the `state` already subscribed via useStore —
            // a non-reactive read path. The panel should derive these values
            // from `state` and never call the store-reading use cases.
            seed({
                items: [makeItem({ id: 'a', name: 'Opener', estimatedDuration: 120 })],
            });
            render(<SetlistPanel />);
            expect(getSetlistProgress).not.toHaveBeenCalled();
            expect(getRemainingDuration).not.toHaveBeenCalled();
            // The readout is still computed correctly via the inline derivation.
            expect(screen.getByText('1 of 1')).toBeTruthy();
        });
    });

    describe('current-item marker', () => {
        it('shows the Play icon for the current item and the index number for others', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
                currentIndex: 0,
            });
            render(<SetlistPanel />);
            // item 0 is current → its numeric slot is replaced by the Play svg.
            expect(screen.queryByText('1')).toBeNull();
            // item 1 is not current → shows its 1-based index.
            expect(screen.getByText('2')).toBeTruthy();
        });
    });

    describe('move-button disabled states', () => {
        it('disables Move up on the first item and Move down on the last item', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            const moveUpButtons = screen.getAllByRole('button', { name: 'Move up' });
            const moveDownButtons = screen.getAllByRole('button', { name: 'Move down' });
            expect(moveUpButtons[0]).toBeDisabled();
            expect(moveDownButtons[1]).toBeDisabled();
            expect(moveUpButtons[1]).not.toBeDisabled();
            expect(moveDownButtons[0]).not.toBeDisabled();
        });

        it('invokes reorderSetlistItems(index, index-1) on Move up and (index, index+1) on Move down', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]!);
            expect(reorderSetlistItems).toHaveBeenCalledWith(1, 0);
            fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]!);
            expect(reorderSetlistItems).toHaveBeenCalledWith(0, 1);
        });
    });

    describe('auto-advance toggle', () => {
        it('reflects autoAdvance off in aria-pressed/aria-label and variant', () => {
            seed({ autoAdvance: false });
            render(<SetlistPanel />);
            const toggle = screen.getByRole('button', { name: 'Auto-advance: off' });
            expect(toggle.getAttribute('aria-pressed')).toBe('false');
            // ghost variant maps to the muted text-text-secondary token (no filled bg)
            expect(toggle.className).toContain('text-text-secondary');
        });

        it('reflects autoAdvance on in aria-pressed/aria-label and variant', () => {
            seed({ autoAdvance: true });
            render(<SetlistPanel />);
            const toggle = screen.getByRole('button', { name: 'Auto-advance: on' });
            expect(toggle.getAttribute('aria-pressed')).toBe('true');
            // secondary variant maps to a filled surface with light text
            expect(toggle.className).toContain('text-white');
        });

        it('calls toggleAutoAdvance when clicked', () => {
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Auto-advance: off' }));
            expect(toggleAutoAdvance).toHaveBeenCalledTimes(1);
        });
    });

    describe('count-in control', () => {
        it('reflects the store countInBars value in the spinbutton', () => {
            seed({ countInBars: 4 });
            render(<SetlistPanel />);
            const input = screen.getByRole('spinbutton', { name: 'Count-in bars' }) as HTMLInputElement;
            expect(input.value).toBe('4');
        });

        it('commits an in-range value through setCountIn', () => {
            seed({ countInBars: 2 });
            render(<SetlistPanel />);
            const input = screen.getByLabelText('Count-in bars') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '5' } });
            expect(setCountIn).toHaveBeenCalledWith(5);
        });

        it('rejects out-of-range and non-numeric values without calling setCountIn', () => {
            seed({ countInBars: 2 });
            render(<SetlistPanel />);
            const input = screen.getByLabelText('Count-in bars') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '9' } });
            fireEvent.change(input, { target: { value: 'abc' } });
            expect(setCountIn).not.toHaveBeenCalled();
        });

        it('keeps the typed out-of-range text visible instead of silently snapping back (F12)', () => {
            // Regression: the input was controlled directly on state.countInBars,
            // so an invalid keystroke was dropped with no feedback and the field
            // just reverted to the last committed value.
            seed({ countInBars: 2 });
            render(<SetlistPanel />);
            const input = screen.getByLabelText('Count-in bars') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '9' } });
            expect(input.value).toBe('9');
            expect(setCountIn).not.toHaveBeenCalled();
        });

        it('reverts the field to the last committed value on blur when still invalid', () => {
            seed({ countInBars: 2 });
            render(<SetlistPanel />);
            const input = screen.getByLabelText('Count-in bars') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '9' } });
            fireEvent.blur(input);
            expect(input.value).toBe('2');
        });
    });

    describe('setlist name editing', () => {
        it('renders the setlist name as a button and enters edit mode on click', () => {
            seed({ name: 'Tour 2026' });
            render(<SetlistPanel />);
            const nameButton = screen.getByRole('button', { name: 'Tour 2026' });
            fireEvent.click(nameButton);
            // editing reveals a textbox seeded with the current name
            expect(screen.getByRole('textbox')).toBeTruthy();
        });

        it('commits a trimmed non-empty name via renameSetlist on blur', () => {
            seed({ name: 'Tour 2026' });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Tour 2026' }));
            const input = screen.getByRole('textbox') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '  Encore  ' } });
            fireEvent.blur(input);
            expect(renameSetlist).toHaveBeenCalledWith('Encore');
        });

        it('does not commit a blank/whitespace name', () => {
            seed({ name: 'Tour 2026' });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Tour 2026' }));
            const input = screen.getByRole('textbox') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '   ' } });
            fireEvent.blur(input);
            expect(renameSetlist).not.toHaveBeenCalled();
        });

        it('Escape cancels editing without committing', () => {
            seed({ name: 'Tour 2026' });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Tour 2026' }));
            const input = screen.getByRole('textbox') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Discarded' } });
            fireEvent.keyDown(input, { key: 'Escape' });
            expect(renameSetlist).not.toHaveBeenCalled();
        });
    });

    describe('per-item name editing', () => {
        it('enters edit mode via the item name button and commits a trimmed name via updateSetlistItem', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener' })] });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
            const input = screen.getByRole('textbox') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '  New Title  ' } });
            fireEvent.blur(input);
            expect(updateSetlistItem).toHaveBeenCalledWith('a', { name: 'New Title' });
        });

        it('does not commit a blank item name', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener' })] });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
            const input = screen.getByRole('textbox') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '' } });
            fireEvent.blur(input);
            expect(updateSetlistItem).not.toHaveBeenCalled();
        });

        it('commits a trimmed name on Enter and exits edit mode', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener' })] });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
            const input = screen.getByRole('textbox') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '  Encore  ' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(updateSetlistItem).toHaveBeenCalledWith('a', { name: 'Encore' });
            // editing exited → textbox unmounts and the name button returns to
            // the (mocked, unmutated) store name
            expect(screen.queryByRole('textbox')).toBeNull();
            expect(screen.getByRole('button', { name: 'Opener' })).toBeTruthy();
        });

        it('cancels editing on Escape without committing', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener' })] });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
            const input = screen.getByRole('textbox') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Discarded' } });
            fireEvent.keyDown(input, { key: 'Escape' });
            expect(updateSetlistItem).not.toHaveBeenCalled();
            // original name is preserved
            expect(screen.getByRole('button', { name: 'Opener' })).toBeTruthy();
        });
    });

    describe('per-item autoStop toggle', () => {
        it('reflects autoStop off via aria-pressed false and muted styling class', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener', autoStop: false })] });
            render(<SetlistPanel />);
            const toggle = screen.getByRole('button', { name: 'Auto-stop: off' });
            expect(toggle.getAttribute('aria-pressed')).toBe('false');
            expect(toggle.className).not.toContain('accent-mint');
        });

        it('reflects autoStop on via aria-pressed true and mint styling class', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener', autoStop: true })] });
            render(<SetlistPanel />);
            const toggle = screen.getByRole('button', { name: 'Auto-stop: on' });
            expect(toggle.getAttribute('aria-pressed')).toBe('true');
            expect(toggle.className).toContain('accent-mint');
        });

        it('flips autoStop through updateSetlistItem when clicked', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener', autoStop: false })] });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Auto-stop: off' }));
            expect(updateSetlistItem).toHaveBeenCalledWith('a', { autoStop: true });
        });

        it('names the setting it actually controls (F9) — not "Count-in", which the click handler never touches', () => {
            // Regression: aria-label previously read "Count-in before: …" while
            // aria-pressed and the click handler both act on item.autoStop
            // (documented in setlistStore.ts as "Auto-stop after this item
            // finishes"). A screen-reader user was told the wrong setting.
            seed({ items: [makeItem({ id: 'a', name: 'Opener', autoStop: false })] });
            render(<SetlistPanel />);
            expect(screen.queryByRole('button', { name: /Count-in before/i })).toBeNull();
        });
    });

    describe('remove item', () => {
        it('calls removeSetlistItem with the item id from its accessible name', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener' })] });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Remove Opener' }));
            expect(removeSetlistItem).toHaveBeenCalledWith('a');
        });
    });

    describe('add item from header', () => {
        it('names the new item using the 1-based next index', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener' })] });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Add setlist item' }));
            expect(addSetlistItem).toHaveBeenCalledWith('Song 2');
        });
    });

    describe('item row navigation', () => {
        it('calls goToItem with the clicked index when the row itself (not a button child) is clicked', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            const items = screen.getAllByRole('listitem');
            // Clicking the color bar span (aria-hidden, not a button) lets the
            // event bubble to the row onClick, which triggers goToItem. The item
            // name button calls stopPropagation to enter edit mode instead.
            const colorBar = items[1]!.querySelector('span[style]');
            fireEvent.click(colorBar!);
            expect(goToItem).toHaveBeenCalledWith(1);
        });

        it('calls nextItem / previousItem from the transport buttons', () => {
            seed({ items: [makeItem({ id: 'a', name: 'Opener' })] });
            render(<SetlistPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Next item' }));
            expect(nextItem).toHaveBeenCalledTimes(1);
            fireEvent.click(screen.getByRole('button', { name: 'Previous item' }));
            expect(previousItem).toHaveBeenCalledTimes(1);
        });
    });

    describe('drag-and-drop reordering', () => {
        // jsdom does not provide a DataTransfer on synthetic drag events; the
        // component reads effectAllowed/dropEffect/setData, so we supply a stub.
        const dataTransfer = () => ({
            effectAllowed: 'move',
            dropEffect: 'move',
            setData: vi.fn(),
            getData: vi.fn(() => ''),
        });

        it('reorders via dragStart → dragOver → drop, calling reorderSetlistItems(from, to)', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            const items = screen.getAllByRole('listitem');
            fireEvent.dragStart(items[0]!, { dataTransfer: dataTransfer() });
            fireEvent.dragOver(items[1]!, { dataTransfer: dataTransfer() });
            fireEvent.drop(items[1]!, { dataTransfer: dataTransfer() });
            expect(reorderSetlistItems).toHaveBeenCalledWith(0, 1);
        });

        it('marks the drop target with the ring border class during drag-over', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            const items = screen.getAllByRole('listitem');
            expect(items[1]!.className).not.toContain('border-t-ring');
            fireEvent.dragStart(items[0]!, { dataTransfer: dataTransfer() });
            fireEvent.dragOver(items[1]!, { dataTransfer: dataTransfer() });
            expect(items[1]!.className).toContain('border-t-2');
            expect(items[1]!.className).toContain('border-t-ring');
        });

        it('clears the drag-over indicator after drop', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            const items = screen.getAllByRole('listitem');
            fireEvent.dragStart(items[0]!, { dataTransfer: dataTransfer() });
            fireEvent.dragOver(items[1]!, { dataTransfer: dataTransfer() });
            fireEvent.drop(items[1]!, { dataTransfer: dataTransfer() });
            expect(items[1]!.className).not.toContain('border-t-ring');
        });

        it('does not reorder when dropping an item onto its own index', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            const items = screen.getAllByRole('listitem');
            fireEvent.dragStart(items[0]!, { dataTransfer: dataTransfer() });
            fireEvent.dragOver(items[0]!, { dataTransfer: dataTransfer() });
            fireEvent.drop(items[0]!, { dataTransfer: dataTransfer() });
            expect(reorderSetlistItems).not.toHaveBeenCalled();
        });

        it('does not reorder when drop fires without a preceding dragStart', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            const items = screen.getAllByRole('listitem');
            fireEvent.drop(items[1]!, { dataTransfer: dataTransfer() });
            expect(reorderSetlistItems).not.toHaveBeenCalled();
        });

        it('clears drag state on dragEnd without reordering', () => {
            seed({
                items: [makeItem({ id: 'a', name: 'Opener' }), makeItem({ id: 'b', name: 'Closer' })],
            });
            render(<SetlistPanel />);
            const items = screen.getAllByRole('listitem');
            fireEvent.dragStart(items[0]!, { dataTransfer: dataTransfer() });
            fireEvent.dragOver(items[1]!, { dataTransfer: dataTransfer() });
            fireEvent.dragEnd(items[0]!);
            expect(items[1]!.className).not.toContain('border-t-ring');
            expect(reorderSetlistItems).not.toHaveBeenCalled();
        });
    });
});
