import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { NotificationToast } from '../NotificationToast';

const notifyHandlerRef: {
    current: null | ((payload: { message: string; level: 'warning' | 'error' | 'info' | 'success' }) => void);
} = { current: null };

vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
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
    },
}));

describe('NotificationToast', () => {
    it('should show a toast when ui.notify fires', async () => {
        notifyHandlerRef.current = null;
        render(<NotificationToast />);
        await waitFor(() => {
            expect(notifyHandlerRef.current).not.toBeNull();
        });
        act(() => {
            notifyHandlerRef.current!({ message: 'Hello', level: 'warning' });
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Hello');
    });
});
