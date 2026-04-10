import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { definePunchRegion } from './definePunchRegion';

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

describe('definePunchRegion', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('appends a punch region to the capture', () => {
        const set = vi.fn();
        injectDependencies(definePunchRegion, {
            punchRecordingStore: {
                value: baseState({
                    captures: [
                        {
                            id: 'cap1',
                            trackId: 't1',
                            startBeat: 0,
                            endBeat: 8,
                            recording: false,
                            punchRegions: [],
                        },
                    ],
                }),
                set,
            } as never,
            getNextPunchId: () => 'punch-1',
        });
        definePunchRegion('cap1', 2, 6);
        const next = set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures[0]!.punchRegions).toHaveLength(1);
        expect(next.captures[0]!.punchRegions[0]!.punchInBeat).toBe(2);
    });
});
