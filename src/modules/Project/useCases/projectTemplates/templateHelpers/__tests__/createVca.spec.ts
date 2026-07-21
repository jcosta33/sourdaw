import { describe, expect, it } from 'vitest';

import { createVca } from '../createVca';

describe('createVca', () => {
    it('captures dormant canonical control inputs while retaining the legacy handle identity', () => {
        const handle = createVca({
            name: 'Drums',
            members: [{ id: 'track-1' }, { id: 'track-2' }],
            color: '#123456',
            gain: 0.75,
            muted: true,
            soloed: true,
        });

        expect(handle).toMatchObject({
            name: 'Drums',
            memberTrackIds: ['track-1', 'track-2'],
            color: '#123456',
            gain: 0.75,
            muted: true,
            soloed: true,
        });
        expect(handle.id).toMatch(/^vca-/);
    });

    it('uses neutral control defaults for existing template callers', () => {
        expect(createVca({ name: 'Default' })).toMatchObject({
            memberTrackIds: [],
            color: '',
            gain: 1,
            muted: false,
            soloed: false,
        });
    });
});
