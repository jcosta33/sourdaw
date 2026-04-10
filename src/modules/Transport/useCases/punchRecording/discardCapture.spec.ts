import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { discardCapture } from './discardCapture';

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

describe('discardCapture', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('removes capture', () => {
        const set = vi.fn();
        injectDependencies(discardCapture, {
            punchRecordingStore: {
                value: baseState({
                    captures: [
                        {
                            id: 'c1',
                            trackId: 't',
                            startBeat: 0,
                            endBeat: 4,
                            recording: false,
                            punchRegions: [],
                        },
                    ],
                }),
                set,
            } as never,
        });
        discardCapture('c1');
        const next = set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures).toHaveLength(0);
    });
});
