import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { setPostRoll } from './setPostRoll';

function baseState(overrides: Partial<PunchRecordingState> = {}): PunchRecordingState {
    return {
        captures: [],
        defaultPreRoll: 4,
        defaultPostRoll: 2,
        defaultCrossfade: 0.25,
        enabled: false,
        ...overrides,
    };
}

describe('setPostRoll', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('writes defaultPostRoll', () => {
        const set = vi.fn();
        injectDependencies(setPostRoll, {
            punchRecordingStore: { value: baseState(), set } as never,
        });
        setPostRoll(6);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ defaultPostRoll: 6 }));
    });
});
