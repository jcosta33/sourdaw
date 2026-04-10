import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { setPreRoll } from './setPreRoll';

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

describe('setPreRoll', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('writes defaultPreRoll', () => {
        const set = vi.fn();
        injectDependencies(setPreRoll, {
            punchRecordingStore: { value: baseState(), set } as never,
        });
        setPreRoll(8);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ defaultPreRoll: 8 }));
    });
});
