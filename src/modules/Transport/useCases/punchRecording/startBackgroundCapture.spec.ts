import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { startBackgroundCapture } from './startBackgroundCapture';

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

describe('startBackgroundCapture', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('appends capture when enabled', () => {
        const set = vi.fn();
        injectDependencies(startBackgroundCapture, {
            punchRecordingStore: {
                value: baseState({ enabled: true }),
                set,
            } as never,
            getNextCaptureId: () => 'cap-1',
        });
        startBackgroundCapture('t1', 0);
        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures).toHaveLength(1);
        expect(next.captures[0]!.trackId).toBe('t1');
    });
});
