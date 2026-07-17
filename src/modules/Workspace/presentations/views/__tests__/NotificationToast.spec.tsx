import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { onNotification } from '../../../useCases/onNotification';
import { NotificationToast } from '../NotificationToast';

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
        expect(screen.getByRole('alert')).toHaveTextContent('Hello');
    });
});
