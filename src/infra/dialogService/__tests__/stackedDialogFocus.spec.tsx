import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ConfirmPayload, type PromptPayload } from '#/utils/Notification/notificationEventBus';

import { ConfirmDialog } from '../ConfirmDialog';
import { onConfirmation } from '../onConfirmation';
import { PromptDialog } from '../PromptDialog';

const handlers: {
    confirm: null | ((payload: ConfirmPayload) => void);
    prompt: null | ((payload: PromptPayload) => void);
} = { confirm: null, prompt: null };

// Both producers resolve the same event-bus dependency, so one bus serves both channels.
const sharedBus = {
    on: (event: string, handler: (payload: ConfirmPayload | PromptPayload) => void) => {
        if (event === 'ui.confirm') {
            handlers.confirm = handler;
        }
        if (event === 'ui.prompt') {
            handlers.prompt = handler;
        }
        return () => {};
    },
    emit: vi.fn(),
};

describe('stacked confirmation and prompt dialogs', () => {
    beforeEach(() => {
        handlers.confirm = null;
        handlers.prompt = null;
        injectDependencies(onConfirmation, { eventBus: sharedBus });
    });

    it('leaves the prompt field and its caret alone when a confirmation replaces another beneath it', async () => {
        render(
            <>
                <ConfirmDialog />
                <PromptDialog />
            </>
        );
        await waitFor(() => {
            expect(handlers.confirm).not.toBeNull();
            expect(handlers.prompt).not.toBeNull();
        });
        const confirm = handlers.confirm!;
        const prompt = handlers.prompt!;

        act(() => {
            confirm({ id: 'c1', message: 'First question', variant: 'danger', resolve: vi.fn() });
        });
        act(() => {
            prompt({ id: 'p1', message: 'Track name', resolve: vi.fn() });
        });
        const field = await screen.findByRole<HTMLInputElement>('textbox');
        await waitFor(() => expect(field).toHaveFocus());
        fireEvent.change(field, { target: { value: 'abc' } });
        field.setSelectionRange(3, 3);

        act(() => {
            confirm({ id: 'c2', message: 'Second question', variant: 'danger', resolve: vi.fn() });
        });

        await screen.findByText('Second question');
        expect(field).toHaveFocus();
        expect(field.selectionStart).toBe(3);
        expect(field.selectionEnd).toBe(3);
    });
});
