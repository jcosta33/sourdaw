import { describe, it, expect, vi } from 'vitest';
import { setTrackStoreState } from '../setTrackStoreState';
import { trackStore } from '../../stores/trackStore';

vi.mock('../../stores/trackStore', () => ({
    trackStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('setTrackStoreState', () => {
    it('delegates to the injected track store set', () => {
        const nextState = { tracks: [], selectedTrackId: null as string | null } as any;
        
        setTrackStoreState(nextState);

        expect(trackStore.set).toHaveBeenCalledTimes(1);
        expect(trackStore.set).toHaveBeenCalledWith(nextState);
    });
});
