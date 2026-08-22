import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { WindowControls } from '../WindowControls';

const mocks = vi.hoisted(() => ({
    frameless: false,
    minimize: vi.fn<() => Promise<void>>(),
    toggleMaximize: vi.fn<() => Promise<boolean>>(),
    close: vi.fn<() => Promise<void>>(),
    isMaximized: vi.fn<() => Promise<boolean>>(),
    listenMaximized: vi.fn<(callback: (maximized: boolean) => void) => () => void>(),
}));

vi.mock('../../../../useCases/windowChrome', () => ({
    windowChromeControls: () => ({
        frameless: mocks.frameless,
        minimize: mocks.minimize,
        toggleMaximize: mocks.toggleMaximize,
        close: mocks.close,
        isMaximized: mocks.isMaximized,
        listenMaximized: mocks.listenMaximized,
    }),
}));

const renderWithTooltip = () =>
    render(
        <TooltipProvider delayDuration={0}>
            <WindowControls />
        </TooltipProvider>
    );

describe('WindowControls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.frameless = false;
        mocks.minimize.mockResolvedValue(undefined);
        mocks.toggleMaximize.mockResolvedValue(true);
        mocks.close.mockResolvedValue(undefined);
        mocks.isMaximized.mockResolvedValue(false);
        mocks.listenMaximized.mockReturnValue(() => undefined);
    });

    it('renders nothing off the frameless chrome', () => {
        const { container } = renderWithTooltip();

        expect(container).toBeEmptyDOMElement();
        expect(mocks.listenMaximized).not.toHaveBeenCalled();
    });

    it('renders the three window controls on the frameless chrome', async () => {
        mocks.frameless = true;
        renderWithTooltip();

        expect(screen.getByRole('button', { name: 'Minimize window' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Maximize window' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close window' })).toBeInTheDocument();
    });

    it('routes minimize and close to the bridge', () => {
        mocks.frameless = true;
        renderWithTooltip();

        fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close window' }));

        expect(mocks.minimize).toHaveBeenCalledTimes(1);
        expect(mocks.close).toHaveBeenCalledTimes(1);
    });

    it('shows the restore state once maximized', async () => {
        mocks.frameless = true;
        mocks.isMaximized.mockResolvedValue(true);
        renderWithTooltip();

        expect(await screen.findByRole('button', { name: 'Restore window' })).toBeInTheDocument();
    });

    it('toggles maximize and reflects the resulting state', async () => {
        mocks.frameless = true;
        mocks.toggleMaximize.mockResolvedValue(true);
        renderWithTooltip();

        fireEvent.click(await screen.findByRole('button', { name: 'Maximize window' }));

        expect(mocks.toggleMaximize).toHaveBeenCalledTimes(1);
        expect(await screen.findByRole('button', { name: 'Restore window' })).toBeInTheDocument();
    });

    it('keeps the maximize button in step with shell-driven transitions', async () => {
        mocks.frameless = true;
        let listener: ((maximized: boolean) => void) | undefined;
        mocks.listenMaximized.mockImplementation((callback) => {
            listener = callback;
            return () => undefined;
        });
        renderWithTooltip();

        expect(await screen.findByRole('button', { name: 'Maximize window' })).toBeInTheDocument();
        act(() => {
            listener?.(true);
        });

        expect(await screen.findByRole('button', { name: 'Restore window' })).toBeInTheDocument();
    });
});
