import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ArrangementSelector } from '../ArrangementSelector';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        arrangements: [
            { id: 'arr-1', name: 'Arrangement 1' },
            { id: 'arr-2', name: 'Arrangement 2' },
        ],
        activeArrangementId: 'arr-1',
    })),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn() },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('../../../stores/arrangementStore', () => ({
    arrangementStore: { name: 'arrangementStore', value: null },
    defaultArrangementStoreState: { arrangements: [], activeArrangementId: 'default-arrangement' },
}));

vi.mock('../../../useCases/arrangement/renameArrangement', () => ({
    renameArrangement: vi.fn(),
}));

vi.mock('../../../useCases/arrangement/duplicateArrangement', () => ({
    duplicateArrangement: vi.fn(),
}));

vi.mock('../../../useCases/arrangement/createArrangement', () => ({
    createArrangement: vi.fn(),
}));

vi.mock('#/modules/Project/useCases/arrangement/switchArrangement', () => ({
    switchArrangement: vi.fn(),
}));

// Mock UI components
vi.mock('#/components/daw/DawCompactInput', () => ({
    DawCompactInput: ({
        value,
        onChange,
        onKeyDown,
        ref,
    }: {
        value?: string;
        onChange?: React.ChangeEventHandler<HTMLInputElement>;
        onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
        ref?: React.Ref<HTMLInputElement>;
    }) => <input ref={ref} value={value} onChange={onChange} onKeyDown={onKeyDown} data-testid="compact-input" />,
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuSectionLabel: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="menu-section-label">{children}</div>
    ),
    DawMenuSeparator: () => <hr data-testid="menu-separator" />,
}));

vi.mock('#/components/daw/DawPickerRow', () => ({
    DawPickerRow: ({
        heading,
        active,
        onClick,
        endSlot,
    }: {
        heading?: React.ReactNode;
        active?: boolean;
        onClick?: React.MouseEventHandler<HTMLDivElement>;
        endSlot?: React.ReactNode;
    }) => (
        <div data-testid="picker-row" data-active={active} onClick={onClick}>
            {heading}
            {endSlot}
        </div>
    ),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { useStore } = await import('#/infra/store/useStore');
const { logger } = await import('#/infra/logger/appLogger');
const { switchArrangement } = await import('#/modules/Project/useCases/arrangement/switchArrangement');
const { notifyUser } = await import('#/utils/Notification/notifyUser');

describe('ArrangementSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(switchArrangement).mockResolvedValue(undefined);
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [
                { id: 'arr-1', name: 'Arrangement 1' },
                { id: 'arr-2', name: 'Arrangement 2' },
            ],
            activeArrangementId: 'arr-1',
        });
    });

    it('should render null when there is only one arrangement', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [{ id: 'arr-1', name: 'Arrangement 1' }],
            activeArrangementId: 'arr-1',
        });

        const { container } = render(<ArrangementSelector />);
        expect(container.firstChild).toBeNull();
    });

    it('should render selector when multiple arrangements exist', () => {
        const { container } = render(<ArrangementSelector />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('should display current arrangement name', () => {
        render(<ArrangementSelector />);
        expect(screen.getByText(/Arrangement 1/i)).toBeInTheDocument();
    });

    it('should show dropdown when clicked', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render all arrangements in dropdown', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        // Use getAllByText since arrangement name appears in both selector and dropdown
        expect(screen.getAllByText('Arrangement 1').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Arrangement 2')).toBeInTheDocument();
    });

    it('should call switchArrangement when arrangement is clicked', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        const arrangement2 = screen.getAllByTestId('picker-row')[1];
        if (!arrangement2) {
            throw new Error('expected a second picker row');
        }
        fireEvent.click(arrangement2);
        expect(switchArrangement).toHaveBeenCalledWith('arr-2');
    });

    it('switches the focused arrangement with Enter or Space', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const arrangement = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });

        // Roving tab stop: only the checked row is tabbable; focus still lands
        // on inactive rows through arrow navigation or a direct focus().
        expect(arrangement).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('menuitemradio', { name: /Arrangement 1/i })).toHaveAttribute('tabindex', '0');
        arrangement.focus();
        expect(arrangement).toHaveFocus();

        fireEvent.keyDown(arrangement, { key: 'Enter' });
        fireEvent.keyDown(arrangement, { key: ' ' });

        expect(switchArrangement).toHaveBeenCalledTimes(2);
        expect(switchArrangement).toHaveBeenNthCalledWith(1, 'arr-2');
        expect(switchArrangement).toHaveBeenNthCalledWith(2, 'arr-2');
    });

    it('marks the checked arrangement and leaves the others unchecked', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));

        expect(screen.getByRole('menuitemradio', { name: /Arrangement 1/i })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('menuitemradio', { name: /Arrangement 2/i })).toHaveAttribute('aria-checked', 'false');
    });

    it('moves focus with ArrowUp and ArrowDown without switching arrangements', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const first = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        const second = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        first.focus();

        fireEvent.keyDown(first, { key: 'ArrowDown' });
        expect(second).toHaveFocus();
        expect(switchArrangement).not.toHaveBeenCalled();

        fireEvent.keyDown(second, { key: 'ArrowUp' });
        expect(first).toHaveFocus();
        expect(switchArrangement).not.toHaveBeenCalled();
    });

    it('keeps the rename action a sibling of its radio, not a descendant', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const radio = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        const rename = screen.getByRole('button', { name: 'Rename Arrangement 2' });

        expect(radio.contains(rename)).toBe(false);
        expect(rename.parentElement).toBe(radio.parentElement);
    });

    it('reveals the rename action on keyboard focus of an inactive row', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const rename = screen.getByRole('button', { name: 'Rename Arrangement 2' });

        rename.focus();
        expect(rename).toHaveFocus();
        expect(rename).toHaveClass('opacity-0', 'group-hover:opacity-100', 'focus-visible:opacity-100');
    });

    it('leaves Enter and Space on a rename action to its own button', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const rename = screen.getByRole('button', { name: 'Rename Arrangement 2' });

        const enterNotCancelled = fireEvent.keyDown(rename, { key: 'Enter', cancelable: true });
        const spaceNotCancelled = fireEvent.keyDown(rename, { key: ' ', cancelable: true });

        // jsdom does not synthesize a click from Enter on a button, so the
        // editor itself stays covered by the click case below.
        expect(enterNotCancelled).toBe(true);
        expect(spaceNotCancelled).toBe(true);
        expect(switchArrangement).not.toHaveBeenCalled();
    });

    it('names each rename action after its arrangement', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));

        fireEvent.click(screen.getByRole('button', { name: 'Rename Arrangement 2' }));

        expect(screen.getByTestId('compact-input')).toHaveValue('Arrangement 2');
    });

    it('should surface switchArrangement failures', async () => {
        const failure = new Error('recording flush failed');
        vi.mocked(switchArrangement).mockRejectedValueOnce(failure);
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));

        const failingRow = screen.getAllByTestId('picker-row')[1];
        if (!failingRow) {
            throw new Error('expected a second picker row');
        }
        fireEvent.click(failingRow);

        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Failed to switch arrangement "arr-2"',
                    cause: failure,
                })
            );
            expect(notifyUser).toHaveBeenCalledWith('Failed to switch to "Arrangement 2"', 'error');
        });
    });

    it('portals its menu out of the desktop titlebar drag region so rows stay clickable', () => {
        // The transport header is the window's drag region. A menu rendered
        // inside that row would need an app-region no-drag ancestor; this menu
        // is portaled to document.body so the window manager never sees the
        // press as a drag.
        render(
            <div className="desktop-titlebar-region--overlay">
                <ArrangementSelector />
            </div>
        );
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));

        const arrangementRow = screen.getAllByTestId('picker-row')[1];
        if (!arrangementRow) {
            throw new Error('expected a second picker row');
        }

        expect(arrangementRow.closest('.desktop-titlebar-region--overlay')).toBeNull();
        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
    });

    it('portals its menu into document body outside the trigger container', () => {
        render(<ArrangementSelector />);
        const trigger = screen.getByLabelText(/Arrangement selector/i);
        const triggerContainer = trigger.parentElement;
        if (!triggerContainer) {
            throw new Error('expected an arrangement selector container');
        }

        fireEvent.click(trigger);

        const menu = screen.getByRole('menu', { name: 'Arrangement menu' });
        expect(menu).toBeInTheDocument();
        expect(triggerContainer.contains(menu)).toBe(false);
        expect(document.body.contains(menu)).toBe(true);
    });

    it('consumes Escape to dismiss the menu', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const menu = screen.getByRole('menu', { name: 'Arrangement menu' });
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

        act(() => {
            menu.dispatchEvent(escape);
        });

        expect(screen.queryByRole('menu', { name: 'Arrangement menu' })).toBeNull();
        expect(escape.defaultPrevented).toBe(true);
    });

    it('consumes the first Escape to cancel a rename without closing the menu', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        fireEvent.click(screen.getByRole('button', { name: 'Rename Arrangement 1' }));
        const input = screen.getByTestId('compact-input');
        const parentDismiss = vi.fn();
        window.addEventListener('keydown', parentDismiss);
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

        act(() => {
            input.dispatchEvent(escape);
        });

        expect(screen.queryByTestId('compact-input')).toBeNull();
        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
        expect(escape.defaultPrevented).toBe(true);
        expect(parentDismiss).not.toHaveBeenCalled();
        window.removeEventListener('keydown', parentDismiss);
    });

    it('should have New Arrangement button', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        expect(screen.getByText(/New Arrangement/i)).toBeInTheDocument();
    });

    it('should have Duplicate Current button', () => {
        render(<ArrangementSelector />);
        const button = screen.getByLabelText(/Arrangement selector/i);
        fireEvent.click(button);
        expect(screen.getByText(/Duplicate Current/i)).toBeInTheDocument();
    });
});
