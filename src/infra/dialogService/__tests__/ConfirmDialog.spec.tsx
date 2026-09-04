import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ConfirmPayload } from '#/utils/Notification/notificationEventBus';

import { ConfirmDialog } from '../ConfirmDialog';
import { onConfirmation } from '../onConfirmation';

const confirmHandlerRef: {
    current: null | ((payload: ConfirmPayload) => void);
} = { current: null };

const mockEventBus = {
    on: (event: string, handler: (payload: ConfirmPayload) => void) => {
        if (event === 'ui.confirm') {
            confirmHandlerRef.current = handler;
        }
        return () => {};
    },
    emit: vi.fn(),
};

function makePayload(overrides: Partial<ConfirmPayload>): ConfirmPayload {
    return {
        id: 'confirm-1',
        message: 'Are you sure?',
        resolve: vi.fn(),
        ...overrides,
    };
}

async function renderAndGetHandler(): Promise<(payload: ConfirmPayload) => void> {
    confirmHandlerRef.current = null;
    render(<ConfirmDialog />);
    await waitFor(() => {
        expect(confirmHandlerRef.current).not.toBeNull();
    });
    return confirmHandlerRef.current!;
}

describe('ConfirmDialog', () => {
    beforeEach(() => {
        injectDependencies(onConfirmation, { eventBus: mockEventBus });
    });

    it('renders nothing until a ui.confirm event arrives, then shows the dialog', async () => {
        const fire = await renderAndGetHandler();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        act(() => {
            fire(makePayload({ title: 'Delete Track', message: 'This cannot be undone.' }));
        });

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Delete Track')).toBeInTheDocument();
        expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    });

    it('renders default OK/Cancel labels when none are provided', async () => {
        const fire = await renderAndGetHandler();
        act(() => {
            fire(makePayload({}));
        });

        expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('renders custom confirm/cancel labels when provided', async () => {
        const fire = await renderAndGetHandler();
        act(() => {
            fire(makePayload({ confirmLabel: 'Delete', cancelLabel: 'Keep it' }));
        });

        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
    });

    it('renders without a title when none is provided', async () => {
        const fire = await renderAndGetHandler();
        act(() => {
            fire(makePayload({ message: 'No title here' }));
        });

        expect(screen.queryByRole('heading')).not.toBeInTheDocument();
        expect(screen.getByText('No title here')).toBeInTheDocument();
    });

    it('clicking confirm resolves true and closes the dialog', async () => {
        const fire = await renderAndGetHandler();
        const resolve = vi.fn();
        act(() => {
            fire(makePayload({ resolve }));
        });

        fireEvent.click(screen.getByRole('button', { name: 'OK' }));

        expect(resolve).toHaveBeenCalledWith(true);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('clicking cancel resolves false and closes the dialog', async () => {
        const fire = await renderAndGetHandler();
        const resolve = vi.fn();
        act(() => {
            fire(makePayload({ resolve }));
        });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(resolve).toHaveBeenCalledWith(false);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('pressing Enter confirms and pressing Escape cancels', async () => {
        const fire = await renderAndGetHandler();
        const firstResolve = vi.fn();
        act(() => {
            fire(makePayload({ resolve: firstResolve }));
        });

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
        expect(firstResolve).toHaveBeenCalledWith(true);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        const secondResolve = vi.fn();
        act(() => {
            fire(makePayload({ resolve: secondResolve }));
        });

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(secondResolve).toHaveBeenCalledWith(false);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('ignores keys other than Enter and Escape', async () => {
        const fire = await renderAndGetHandler();
        const resolve = vi.fn();
        act(() => {
            fire(makePayload({ resolve }));
        });

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });

        expect(resolve).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('stops Delete from reaching the window shortcut layer while pending (#3602)', async () => {
        const fire = await renderAndGetHandler();
        const resolve = vi.fn();
        act(() => {
            fire(makePayload({ variant: 'danger', confirmLabel: 'Delete', resolve }));
        });
        const windowKeyDown = vi.fn();
        window.addEventListener('keydown', windowKeyDown);
        // Focus sits on the portaled dialog's own button: the keystroke must
        // be cut before window, where the global layer would delete the
        // selected arrangement clips with no confirmation.
        fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Delete' });
        expect(windowKeyDown).not.toHaveBeenCalled();
        window.removeEventListener('keydown', windowKeyDown);
        expect(resolve).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('stops Backspace from reaching the window shortcut layer while pending (#3602)', async () => {
        const fire = await renderAndGetHandler();
        const resolve = vi.fn();
        act(() => {
            fire(makePayload({ variant: 'danger', confirmLabel: 'Delete', resolve }));
        });
        const windowKeyDown = vi.fn();
        window.addEventListener('keydown', windowKeyDown);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Backspace' });
        expect(windowKeyDown).not.toHaveBeenCalled();
        window.removeEventListener('keydown', windowKeyDown);
        expect(resolve).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('auto-resolves an overlapping pending confirmation to false when a second ui.confirm arrives', async () => {
        const fire = await renderAndGetHandler();
        const firstResolve = vi.fn();
        const secondResolve = vi.fn();

        act(() => {
            fire(makePayload({ id: 'confirm-1', message: 'First', resolve: firstResolve }));
        });
        act(() => {
            fire(makePayload({ id: 'confirm-2', message: 'Second', resolve: secondResolve }));
        });

        expect(firstResolve).toHaveBeenCalledWith(false);
        expect(secondResolve).not.toHaveBeenCalled();
        expect(screen.getByText('Second')).toBeInTheDocument();
        expect(screen.queryByText('First')).not.toBeInTheDocument();
    });

    it('applies the danger border styling for a danger variant', async () => {
        const fire = await renderAndGetHandler();
        act(() => {
            fire(makePayload({ variant: 'danger', message: 'Danger message' }));
        });

        const dialogPanel = screen.getByText('Danger message').closest('div');
        expect(dialogPanel?.className).toContain('border-[var(--color-state-danger)]/40');
    });
});
