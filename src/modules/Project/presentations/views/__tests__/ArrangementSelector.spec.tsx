import { render, screen, fireEvent } from '@testing-library/react';
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
    }: {
        heading?: React.ReactNode;
        active?: boolean;
        onClick?: React.MouseEventHandler<HTMLDivElement>;
    }) => (
        <div data-testid="picker-row" data-active={active} onClick={onClick}>
            {heading}
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

    it('clamps its portaled menu inside the viewport near the right edge', () => {
        render(<ArrangementSelector />);
        const trigger = screen.getByLabelText(/Arrangement selector/i);
        const triggerContainer = trigger.parentElement;
        if (!triggerContainer) {
            throw new Error('expected an arrangement selector container');
        }

        const triggerRect = DOMRect.fromRect({
            x: window.innerWidth - 10,
            y: 40,
            width: 100,
            height: 30,
        });
        const menuRect = DOMRect.fromRect({ width: 224, height: 200 });
        Object.defineProperty(triggerContainer, 'getBoundingClientRect', {
            configurable: true,
            value: () => triggerRect,
        });
        const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(menuRect);

        fireEvent.click(trigger);
        rectSpy.mockRestore();

        const menu = screen.getByRole('menu', { name: 'Arrangement menu' });
        Object.defineProperty(menu, 'getBoundingClientRect', {
            configurable: true,
            value: () => {
                const left = Number.parseFloat(menu.style.left);
                return DOMRect.fromRect({ x: left, width: 224, height: 200 });
            },
        });

        const clampedRect = menu.getBoundingClientRect();
        expect(clampedRect.right).toBeLessThanOrEqual(window.innerWidth);
        expect(clampedRect.left).toBeGreaterThanOrEqual(0);
        expect(clampedRect.left).toBeLessThan(triggerRect.left);
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
