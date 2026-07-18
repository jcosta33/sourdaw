import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PromptPayload } from '#/utils/Notification/notificationEventBus';

import { onPrompt } from '../onPrompt';
import { PromptDialog } from '../PromptDialog';

const promptHandlerRef: {
    current: null | ((payload: PromptPayload) => void);
} = { current: null };

const mockEventBus = {
    on: (event: string, handler: (payload: PromptPayload) => void) => {
        if (event === 'ui.prompt') {
            promptHandlerRef.current = handler;
        }
        return () => {};
    },
    emit: vi.fn(),
};

function makePayload(overrides: Partial<PromptPayload>): PromptPayload {
    return {
        id: 'prompt-1',
        message: 'New track name',
        resolve: vi.fn(),
        ...overrides,
    };
}

async function renderAndGetHandler(): Promise<(payload: PromptPayload) => void> {
    promptHandlerRef.current = null;
    render(<PromptDialog />);
    await waitFor(() => {
        expect(promptHandlerRef.current).not.toBeNull();
    });
    return promptHandlerRef.current!;
}

describe('PromptDialog', () => {
    beforeEach(() => {
        injectDependencies(onPrompt, { eventBus: mockEventBus });
    });

    it('renders nothing until a ui.prompt event arrives, then shows the dialog with the prefilled initial value', async () => {
        const fire = await renderAndGetHandler();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        act(() => {
            fire(makePayload({ title: 'Rename Track', initialValue: 'Old Track' }));
        });

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Rename Track')).toBeInTheDocument();
        expect(screen.getByText('New track name')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('Old Track');
    });

    it('submits the trimmed input value on Enter and closes', async () => {
        const fire = await renderAndGetHandler();
        const resolve = vi.fn();
        act(() => {
            fire(makePayload({ resolve }));
        });

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: '  New Name  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(resolve).toHaveBeenCalledWith('New Name');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('resolves null on Escape and closes', async () => {
        const fire = await renderAndGetHandler();
        const resolve = vi.fn();
        act(() => {
            fire(makePayload({ resolve, initialValue: 'Old Track' }));
        });

        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

        expect(resolve).toHaveBeenCalledWith(null);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('resolves null when submitted with a whitespace-only value', async () => {
        const fire = await renderAndGetHandler();
        const resolve = vi.fn();
        act(() => {
            fire(makePayload({ resolve }));
        });

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(resolve).toHaveBeenCalledWith(null);
    });

    it('auto-resolves a pending prompt to null when a second ui.prompt overlaps, and shows the new prompt', async () => {
        const fire = await renderAndGetHandler();
        const firstResolve = vi.fn();
        const secondResolve = vi.fn();

        act(() => {
            fire(makePayload({ id: 'prompt-1', message: 'First prompt', resolve: firstResolve }));
        });
        act(() => {
            fire(
                makePayload({
                    id: 'prompt-2',
                    message: 'Second prompt',
                    initialValue: 'Second value',
                    resolve: secondResolve,
                })
            );
        });

        expect(firstResolve).toHaveBeenCalledWith(null);
        expect(secondResolve).not.toHaveBeenCalled();
        expect(screen.getByText('Second prompt')).toBeInTheDocument();
        expect(screen.queryByText('First prompt')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('Second value');
    });
});
