import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { NotificationToast } from '../NotificationToast';
import { onNotification } from '../onNotification';

const notifyHandlerRef: {
    current: null | ((payload: { message: string; level: 'warning' | 'error' | 'info' | 'success' }) => void);
} = { current: null };

const mockEventBus = {
    on: (
        event: string,
        handler: (payload: { message: string; level: 'warning' | 'error' | 'info' | 'success' }) => void
    ) => {
        if (event === 'ui.notify') {
            notifyHandlerRef.current = handler;
        }
        return () => {};
    },
    emit: vi.fn(),
};

describe('NotificationToast', () => {
    beforeEach(() => {
        injectDependencies(onNotification, { eventBus: mockEventBus });
    });

    it('should show a toast anchored to top-right with inert pass-through when ui.notify fires', async () => {
        notifyHandlerRef.current = null;
        render(<NotificationToast />);
        await waitFor(() => {
            expect(notifyHandlerRef.current).not.toBeNull();
        });
        act(() => {
            notifyHandlerRef.current!({ message: 'Hello', level: 'warning' });
        });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Hello');
        expect(alert.className).toContain('top-14');
        expect(alert.className).toContain('right-4');
        expect(alert.className).toContain('pointer-events-none');
        expect(alert.className).toContain('z-[10000]');

        const dismissButton = screen.getByRole('button', { name: 'Dismiss notification' });
        expect(dismissButton.className).toContain('pointer-events-auto');
    });

    it('dismisses a corrupt MIDI error notification when clicking the dismiss button', async () => {
        notifyHandlerRef.current = null;
        render(<NotificationToast />);
        await waitFor(() => {
            expect(notifyHandlerRef.current).not.toBeNull();
        });
        act(() => {
            notifyHandlerRef.current!({
                message: 'Failed to import "corrupt.mid" - invalid or corrupt MIDI file',
                level: 'error',
            });
        });
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Failed to import "corrupt.mid" - invalid or corrupt MIDI file'
        );

        const dismissButton = screen.getByRole('button', { name: 'Dismiss notification' });
        act(() => {
            fireEvent.click(dismissButton);
        });

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('should advance to the next notification when dismiss is clicked with multiple in queue', async () => {
        notifyHandlerRef.current = null;
        render(<NotificationToast />);
        await waitFor(() => {
            expect(notifyHandlerRef.current).not.toBeNull();
        });
        act(() => {
            notifyHandlerRef.current!({ message: 'First message', level: 'info' });
            notifyHandlerRef.current!({ message: 'Second message', level: 'error' });
        });
        expect(screen.getByRole('alert')).toHaveTextContent('First message');

        const dismissButton = screen.getByRole('button', { name: 'Dismiss notification' });
        act(() => {
            fireEvent.click(dismissButton);
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Second message');
    });

    it('should display the +N more indicator when multiple notifications are queued', async () => {
        notifyHandlerRef.current = null;
        render(<NotificationToast />);
        await waitFor(() => {
            expect(notifyHandlerRef.current).not.toBeNull();
        });
        act(() => {
            notifyHandlerRef.current!({ message: 'Message 1', level: 'info' });
            notifyHandlerRef.current!({ message: 'Message 2', level: 'warning' });
            notifyHandlerRef.current!({ message: 'Message 3', level: 'error' });
        });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Message 1');
        expect(screen.getByText('+2 more')).toBeInTheDocument();
    });

    it('filters retained notifications by severity and clears unread count when opened', async () => {
        notifyHandlerRef.current = null;
        render(<NotificationToast />);
        await waitFor(() => {
            expect(notifyHandlerRef.current).not.toBeNull();
        });
        act(() => {
            notifyHandlerRef.current!({ message: 'First message', level: 'info' });
            notifyHandlerRef.current!({ message: 'Second message', level: 'error' });
        });

        fireEvent.click(screen.getByRole('button', { name: /Notification history/ }));
        expect(screen.getByRole('button', { name: 'Notification history' })).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Filter notifications by severity' }), {
            target: { value: 'error' },
        });

        expect(screen.getByRole('listitem', { name: /Second message/ })).toBeInTheDocument();
        expect(screen.queryByRole('listitem', { name: /First message/ })).not.toBeInTheDocument();
    });
});
