import { describe, it, expect, vi, beforeEach } from 'vitest';

const emit = vi.hoisted(() => vi.fn());

vi.mock('#/app/registerDependencies', () => ({
    eventBus: { emit },
}));

import { confirmUser } from '../confirmUser';

describe('confirmUser', () => {
    beforeEach(() => {
        emit.mockClear();
    });

    it('should emit ui.confirm with message, optional fields, and resolve callback', async () => {
        const promise = confirmUser({
            message: 'Delete?',
            title: 'Confirm',
            confirmLabel: 'Yes',
            cancelLabel: 'No',
            variant: 'danger',
        });

        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(
            'ui.confirm',
            expect.objectContaining({
                message: 'Delete?',
                title: 'Confirm',
                confirmLabel: 'Yes',
                cancelLabel: 'No',
                variant: 'danger',
            })
        );

        const payload = emit.mock.calls[0]![1] as {
            id: string;
            resolve: (value: boolean) => void;
        };
        expect(typeof payload.id).toBe('string');
        expect(payload.id.length).toBeGreaterThan(0);

        payload.resolve(true);
        await expect(promise).resolves.toBe(true);
    });

    it('should resolve false when the dialog resolves false', async () => {
        const promise = confirmUser({ message: 'Ok?' });
        const payload = emit.mock.calls[0]![1] as { resolve: (value: boolean) => void };
        payload.resolve(false);
        await expect(promise).resolves.toBe(false);
    });
});
