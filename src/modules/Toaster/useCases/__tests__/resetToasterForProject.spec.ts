import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordsAtDisposal = vi.hoisted(() => [] as string[][]);

vi.mock('../disposeEveryToasterDevice', async () => {
    const { toasterStore } = await import('../../stores/toasterStore');
    return {
        disposeEveryToasterDevice: vi.fn(() => {
            recordsAtDisposal.push(Object.keys(toasterStore.value ?? {}));
        }),
    };
});

import { defaultToasterState, pendingPadSelectionStore, toasterStore } from '../../stores/toasterStore';
import { resetToasterForProject } from '../resetToasterForProject';

describe('resetToasterForProject', () => {
    beforeEach(() => {
        recordsAtDisposal.length = 0;
    });

    // The graph reset before a switch announces no device removal, so the
    // switch itself ends the outgoing Toasters, reading the records it disposes.
    it('ends the outgoing Toasters before clearing their records', () => {
        toasterStore.set({ 'toast-1': defaultToasterState });

        resetToasterForProject();

        expect(recordsAtDisposal).toEqual([['toast-1']]);
        expect(toasterStore.value).toEqual({});
    });

    it('ends the registration bookkeeping at the project boundary', () => {
        pendingPadSelectionStore.set({ 'toast-1': 3 });

        resetToasterForProject();

        expect(pendingPadSelectionStore.value).toEqual({});
    });
});
