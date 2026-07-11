import { describe, it, expect, vi } from 'vitest';

import { type Dso } from '../../../models/DsoTypes';
import { validateDsos } from '../validateDsos';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null } as { value: unknown },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

function trackState(tracks: Array<{ id: string; name: string }>) {
    return {
        tracks: tracks.map((t) => ({
            id: t.id,
            name: t.name,
            kind: 'audio',
            clips: [],
            devices: [],
        })),
        selectedTrackId: null,
    };
}

describe('validateDsos', () => {
    it('should reject time signature denominators unsupported by Transport validation', () => {
        mocks.trackStoreValue.value = trackState([]);
        const dso: Dso = { op: 'set_time_signature', numerator: 7, denominator: 3 };

        const errors = validateDsos([dso]);

        expect(errors).toEqual([
            {
                dso,
                reason: 'Time signature denominator 3 must be one of 2, 4, 8, or 16',
            },
        ]);
    });
});
