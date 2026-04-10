import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { stopBackgroundCapture } from './stopBackgroundCapture';

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

describe('stopBackgroundCapture', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('sets recording false on matching capture', () => {
        const set = vi.fn();
        injectDependencies(stopBackgroundCapture, {
            punchRecordingStore: {
                value: baseState({
                    captures: [
                        {
                            id: 'c1',
                            trackId: 't',
                            startBeat: 0,
                            endBeat: 4,
                            recording: true,
                            punchRegions: [],
                        },
                    ],
                }),
                set,
            } as never,
        });
        stopBackgroundCapture('c1');
        const next = set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures[0]!.recording).toBe(false);
    });
});
