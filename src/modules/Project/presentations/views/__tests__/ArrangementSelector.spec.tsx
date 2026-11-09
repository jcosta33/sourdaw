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
        onBlur,
        ref,
    }: {
        value?: string;
        onChange?: React.ChangeEventHandler<HTMLInputElement>;
        onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
        onBlur?: React.FocusEventHandler<HTMLInputElement>;
        ref?: React.Ref<HTMLInputElement>;
    }) => (
        <input
            ref={ref}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            data-testid="compact-input"
        />
    ),
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
const { renameArrangement } = await import('../../../useCases/arrangement/renameArrangement');

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

    it('exposes the checked arrangement and exactly one radio tab stop', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const arrangement1 = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        const arrangement2 = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });

        expect(arrangement1).toHaveAttribute('aria-checked', 'true');
        expect(arrangement2).toHaveAttribute('aria-checked', 'false');
        expect(arrangement1).toHaveAttribute('tabindex', '0');
        expect(arrangement2).toHaveAttribute('tabindex', '-1');
    });

    it('focuses the active rendered radio when opening with a non-first arrangement active', async () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [
                { id: 'arr-1', name: 'Arrangement 1' },
                { id: 'arr-2', name: 'Arrangement 2' },
            ],
            activeArrangementId: 'arr-2',
        });
        render(<ArrangementSelector />);

        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));

        const activeRadio = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        await vi.waitFor(() => {
            expect(activeRadio).toHaveFocus();
        });
    });

    it('moves focus through every menu control in DOM order without switching arrangements', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const arrangement1 = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        const rename1 = screen.getByRole('button', { name: 'Rename Arrangement 1' });
        const arrangement2 = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        const rename2 = screen.getByRole('button', { name: 'Rename Arrangement 2' });
        const newArrangement = screen.getByRole('menuitem', { name: 'New Arrangement' });
        const duplicate = screen.getByRole('menuitem', { name: 'Duplicate Current' });
        act(() => {
            arrangement1.focus();
        });

        fireEvent.keyDown(arrangement1, { key: 'ArrowUp' });
        expect(duplicate).toHaveFocus();

        act(() => {
            arrangement1.focus();
        });
        const advance = (from: HTMLElement, to: HTMLElement) => {
            fireEvent.keyDown(from, { key: 'ArrowDown' });
            expect(to).toHaveFocus();
        };
        advance(arrangement1, rename1);
        advance(rename1, arrangement2);
        advance(arrangement2, rename2);
        advance(rename2, newArrangement);
        advance(newArrangement, duplicate);
        advance(duplicate, arrangement1);

        expect(arrangement1).toHaveAttribute('aria-checked', 'true');
        expect(arrangement2).toHaveAttribute('aria-checked', 'false');
        expect(switchArrangement).not.toHaveBeenCalled();
    });

    it('leaves arrow keys in a rename editor without changing selection', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [
                { id: 'arr-1', name: 'Arrangement 1' },
                { id: 'arr-2', name: 'Arrangement 2' },
                { id: 'arr-3', name: 'Arrangement 3' },
            ],
            activeArrangementId: 'arr-1',
        });
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        fireEvent.click(screen.getByRole('button', { name: 'Rename Arrangement 2' }));
        const input = screen.getByTestId('compact-input');
        const arrangement1 = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        const arrangement3 = screen.getByRole('menuitemradio', { name: /Arrangement 3/i });
        expect(input).toHaveFocus();

        fireEvent.keyDown(input, { key: 'ArrowDown' });

        expect(input).toHaveFocus();
        expect(arrangement1).toHaveAttribute('aria-checked', 'true');
        expect(arrangement3).toHaveAttribute('aria-checked', 'false');
        expect(switchArrangement).not.toHaveBeenCalled();
    });

    it('restores focus to a replacement radio after the focused id disappears', () => {
        const { rerender } = render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const disappearingRadio = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        act(() => {
            disappearingRadio.focus();
        });
        expect(disappearingRadio).toHaveAttribute('tabindex', '0');
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [
                { id: 'replacement-1', name: 'Replacement 1' },
                { id: 'replacement-2', name: 'Replacement 2' },
            ],
            activeArrangementId: 'replacement-2',
        });

        rerender(<ArrangementSelector />);

        const replacement1 = screen.getByRole('menuitemradio', { name: /Replacement 1/i });
        const replacement2 = screen.getByRole('menuitemradio', { name: /Replacement 2/i });
        expect(replacement1).toHaveAttribute('tabindex', '-1');
        expect(replacement2).toHaveAttribute('tabindex', '0');
        expect(replacement2).toHaveFocus();

        fireEvent.keyDown(replacement2, { key: 'ArrowUp' });
        fireEvent.keyDown(screen.getByRole('button', { name: 'Rename Replacement 1' }), { key: 'ArrowUp' });

        expect(replacement1).toHaveFocus();
        expect(replacement2).toHaveAttribute('aria-checked', 'true');
        expect(replacement1).toHaveAttribute('aria-checked', 'false');
    });

    it('recovers radio focus when replacement removes the arrangement being renamed', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [
                { id: 'arr-1', name: 'Arrangement 1' },
                { id: 'arr-2', name: 'Arrangement 2' },
                { id: 'arr-3', name: 'Arrangement 3' },
            ],
            activeArrangementId: 'arr-1',
        });
        const { rerender } = render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        fireEvent.click(screen.getByRole('button', { name: 'Rename Arrangement 2' }));
        expect(screen.getByTestId('compact-input')).toHaveFocus();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [
                { id: 'arr-3', name: 'Arrangement 3' },
                { id: 'arr-4', name: 'Arrangement 4' },
            ],
            activeArrangementId: 'arr-3',
        });

        rerender(<ArrangementSelector />);

        expect(screen.queryByTestId('compact-input')).toBeNull();
        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
        const arrangement3 = screen.getByRole('menuitemradio', { name: /Arrangement 3/i });
        const arrangement4 = screen.getByRole('menuitemradio', { name: /Arrangement 4/i });
        expect(arrangement3).toHaveFocus();

        fireEvent.keyDown(arrangement3, { key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByRole('button', { name: 'Rename Arrangement 3' }), { key: 'ArrowDown' });

        expect(arrangement4).toHaveFocus();
        expect(arrangement3).toHaveAttribute('aria-checked', 'true');
        expect(arrangement4).toHaveAttribute('aria-checked', 'false');
    });

    it('recovers radio focus when replacement removes a focused Rename button', () => {
        const { rerender } = render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const rename = screen.getByRole('button', { name: 'Rename Arrangement 2' });
        act(() => {
            rename.focus();
        });
        expect(rename).toHaveFocus();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [
                { id: 'arr-1', name: 'Arrangement 1' },
                { id: 'arr-3', name: 'Arrangement 3' },
            ],
            activeArrangementId: 'arr-1',
        });

        rerender(<ArrangementSelector />);

        const arrangement1 = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        const arrangement3 = screen.getByRole('menuitemradio', { name: /Arrangement 3/i });
        expect(arrangement1).toHaveFocus();

        fireEvent.keyDown(arrangement1, { key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByRole('button', { name: 'Rename Arrangement 1' }), { key: 'ArrowDown' });

        expect(arrangement3).toHaveFocus();
        expect(arrangement1).toHaveAttribute('aria-checked', 'true');
        expect(arrangement3).toHaveAttribute('aria-checked', 'false');
    });

    it('retains focus on the surviving radio when a focused two-arrangement menu falls to one', () => {
        const { rerender } = render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const disappearingRadio = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        act(() => {
            disappearingRadio.focus();
        });
        expect(disappearingRadio).toHaveFocus();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [{ id: 'arr-1', name: 'Arrangement 1' }],
            activeArrangementId: 'arr-1',
        });

        rerender(<ArrangementSelector />);

        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
        const survivingRadio = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        expect(survivingRadio).toBeVisible();
        expect(survivingRadio).toHaveFocus();
        expect(survivingRadio).toHaveAttribute('tabindex', '0');
    });

    it('retains focus on the surviving radio when an active rename editor falls to one arrangement', () => {
        const { rerender } = render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        fireEvent.click(screen.getByRole('button', { name: 'Rename Arrangement 2' }));
        expect(screen.getByTestId('compact-input')).toHaveFocus();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [{ id: 'arr-1', name: 'Arrangement 1' }],
            activeArrangementId: 'arr-1',
        });

        rerender(<ArrangementSelector />);

        expect(screen.queryByTestId('compact-input')).toBeNull();
        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
        const survivingRadio = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        expect(survivingRadio).toBeVisible();
        expect(survivingRadio).toHaveFocus();
        expect(survivingRadio).toHaveAttribute('tabindex', '0');
    });

    it('focuses New Arrangement when a focused two-arrangement menu becomes empty and recovers after growth', () => {
        const { rerender } = render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const disappearingRadio = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        act(() => {
            disappearingRadio.focus();
        });
        expect(disappearingRadio).toHaveFocus();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [],
            activeArrangementId: null,
        });

        rerender(<ArrangementSelector />);

        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
        const newArrangement = screen.getByRole('menuitem', { name: 'New Arrangement' });
        expect(newArrangement).toBeVisible();
        expect(newArrangement).toHaveFocus();

        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [{ id: 'arr-1', name: 'Arrangement 1' }],
            activeArrangementId: 'arr-1',
        });
        rerender(<ArrangementSelector />);

        const duplicate = screen.getByRole('menuitem', { name: 'Duplicate Current' });
        const survivingRadio = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        fireEvent.keyDown(newArrangement, { key: 'ArrowDown' });
        expect(duplicate).toHaveFocus();
        fireEvent.keyDown(duplicate, { key: 'ArrowDown' });
        expect(survivingRadio).toHaveFocus();
        expect(survivingRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('focuses New Arrangement when an active rename editor becomes empty', () => {
        const { rerender } = render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        fireEvent.click(screen.getByRole('button', { name: 'Rename Arrangement 2' }));
        expect(screen.getByTestId('compact-input')).toHaveFocus();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            arrangements: [],
            activeArrangementId: null,
        });

        rerender(<ArrangementSelector />);

        expect(screen.queryByTestId('compact-input')).toBeNull();
        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
        const newArrangement = screen.getByRole('menuitem', { name: 'New Arrangement' });
        expect(newArrangement).toBeVisible();
        expect(newArrangement).toHaveFocus();
    });

    it('switches the focused arrangement with Enter or Space', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const arrangement = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });

        act(() => {
            arrangement.focus();
        });
        expect(arrangement).toHaveFocus();

        fireEvent.keyDown(arrangement, { key: 'Enter' });
        fireEvent.keyDown(arrangement, { key: ' ' });

        expect(switchArrangement).toHaveBeenCalledTimes(2);
        expect(switchArrangement).toHaveBeenNthCalledWith(1, 'arr-2');
        expect(switchArrangement).toHaveBeenNthCalledWith(2, 'arr-2');
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

    it('keeps rename siblings outside menuitemradio semantics while editing', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const arrangement = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        const rename = screen.getByRole('button', { name: 'Rename Arrangement 2' });

        expect(arrangement.parentElement).toBe(rename.parentElement);
        expect(rename.closest('[role="menuitemradio"]')).toBeNull();

        fireEvent.click(rename);

        const input = screen.getByTestId('compact-input');
        expect(input.closest('[role="menuitemradio"]')).toBeNull();
        expect(screen.queryByRole('menuitemradio', { name: /Arrangement 2/i })).not.toBeInTheDocument();
        expect(screen.getByRole('menuitemradio', { name: /Arrangement 1/i })).toHaveAttribute('tabindex', '0');
    });

    it('reveals an inactive rename action when Tab reaches it', async () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const menu = screen.getByRole('menu', { name: 'Arrangement menu' });
        const activeRadio = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        await vi.waitFor(() => {
            expect(activeRadio).toHaveFocus();
        });
        const tabToNext = () => {
            const current = document.activeElement;
            if (!(current instanceof HTMLElement) || !menu.contains(current)) {
                throw new Error('expected focus inside the arrangement menu before Tab');
            }
            const keyDownNotCancelled = fireEvent.keyDown(current, { key: 'Tab', cancelable: true });
            if (!keyDownNotCancelled) {
                return;
            }
            const tabStops = Array.from(menu.querySelectorAll<HTMLElement>('button, [tabindex]')).filter(
                (element) => element.tabIndex >= 0 && !element.hasAttribute('disabled')
            );
            const currentIndex = tabStops.indexOf(current);
            const next = currentIndex === -1 ? undefined : tabStops[(currentIndex + 1) % tabStops.length];
            if (!next) {
                throw new Error('expected a next tab stop inside the arrangement menu');
            }
            next.focus();
            fireEvent.keyUp(next, { key: 'Tab' });
        };

        tabToNext();
        expect(screen.getByRole('button', { name: 'Rename Arrangement 1' })).toHaveFocus();
        tabToNext();

        const rename = screen.getByRole('button', { name: 'Rename Arrangement 2' });
        expect(rename).toHaveFocus();
        expect(rename).toHaveClass('opacity-0', 'group-hover:opacity-100', 'focus-visible:opacity-100');
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

    it.each([
        {
            exit: 'Escape',
            exitRename: (input: HTMLElement) => {
                const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
                act(() => {
                    input.dispatchEvent(escape);
                });
            },
        },
        {
            exit: 'Enter',
            exitRename: (input: HTMLElement) => {
                fireEvent.keyDown(input, { key: 'Enter' });
            },
        },
    ])(
        'restores focus to an inactive arrangement after cancelling or submitting its rename with $exit',
        ({ exit, exitRename }) => {
            render(<ArrangementSelector />);
            fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
            fireEvent.click(screen.getByRole('button', { name: 'Rename Arrangement 2' }));
            const input = screen.getByTestId('compact-input');
            expect(input).toHaveFocus();
            fireEvent.change(input, { target: { value: 'Renamed inactive arrangement' } });

            exitRename(input);

            if (exit === 'Enter') {
                expect(renameArrangement).toHaveBeenCalledExactlyOnceWith('arr-2', 'Renamed inactive arrangement');
            } else {
                expect(renameArrangement).not.toHaveBeenCalled();
            }
            const arrangement2 = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
            expect(screen.queryByTestId('compact-input')).toBeNull();
            expect(arrangement2).toHaveFocus();

            fireEvent.keyDown(arrangement2, { key: 'Enter' });

            expect(switchArrangement).toHaveBeenCalledExactlyOnceWith('arr-2');
        }
    );

    it('consumes the first Escape to cancel a rename and restores radio focus', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        const editButton = screen.getByRole('button', { name: 'Rename Arrangement 1' });
        fireEvent.click(editButton);
        const input = screen.getByTestId('compact-input');
        const parentDismiss = vi.fn();
        window.addEventListener('keydown', parentDismiss);
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

        act(() => {
            input.dispatchEvent(escape);
        });

        window.removeEventListener('keydown', parentDismiss);
        expect(screen.queryByTestId('compact-input')).toBeNull();
        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
        expect(escape.defaultPrevented).toBe(true);
        expect(parentDismiss).not.toHaveBeenCalled();
        const arrangement1 = screen.getByRole('menuitemradio', { name: /Arrangement 1/i });
        const arrangement2 = screen.getByRole('menuitemradio', { name: /Arrangement 2/i });
        expect(arrangement1).toHaveFocus();

        fireEvent.keyDown(arrangement1, { key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByRole('button', { name: 'Rename Arrangement 1' }), { key: 'ArrowDown' });

        expect(arrangement2).toHaveFocus();
    });

    it('does not steal focus when rename blur lands on another menu button', () => {
        render(<ArrangementSelector />);
        fireEvent.click(screen.getByLabelText(/Arrangement selector/i));
        fireEvent.click(screen.getByRole('button', { name: 'Rename Arrangement 1' }));
        const input = screen.getByTestId('compact-input');
        const newArrangement = screen.getByRole('menuitem', { name: 'New Arrangement' });
        expect(input).toHaveFocus();

        act(() => {
            newArrangement.focus();
        });

        expect(screen.queryByTestId('compact-input')).toBeNull();
        expect(newArrangement).toHaveFocus();
        expect(screen.getByRole('menu', { name: 'Arrangement menu' })).toBeInTheDocument();
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
