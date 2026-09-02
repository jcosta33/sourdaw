import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

    it('should show a toast when ui.notify fires', async () => {
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
        expect(alert.className).toContain('z-[10000]');
    });
});
