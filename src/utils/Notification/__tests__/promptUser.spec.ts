import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { promptUser } from '../promptUser';

const emit = vi.hoisted(() => vi.fn());

describe('promptUser', () => {
    beforeEach(() => {
        injectDependencies(promptUser, { eventBus: { emit } });
        emit.mockClear();
    });

    it('emits ui.prompt with message, optional fields, an id, and a resolve callback', async () => {
        const promise = promptUser({
            message: 'New name',
            title: 'Rename Track',
            initialValue: 'Old',
            placeholder: 'Track name',
            confirmLabel: 'Rename',
            cancelLabel: 'Keep',
        });

        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(
            'ui.prompt',
            expect.objectContaining({
                message: 'New name',
                title: 'Rename Track',
                initialValue: 'Old',
                placeholder: 'Track name',
                confirmLabel: 'Rename',
                cancelLabel: 'Keep',
            })
        );

        const payload = emit.mock.calls[0]![1] as {
            id: string;
            resolve: (value: string | null) => void;
        };
        expect(typeof payload.id).toBe('string');
        expect(payload.id.length).toBeGreaterThan(0);

        payload.resolve('New Track');
        await expect(promise).resolves.toBe('New Track');
    });

    it('resolves null when the dialog is cancelled', async () => {
        const promise = promptUser({ message: 'Name?' });
        const payload = emit.mock.calls[0]![1] as { resolve: (value: string | null) => void };
        payload.resolve(null);
        await expect(promise).resolves.toBeNull();
    });
});
