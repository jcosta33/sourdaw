import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { togglePunchRecording } from './togglePunchRecording';

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

describe('togglePunchRecording', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('flips enabled', () => {
        const set = vi.fn();
        injectDependencies(togglePunchRecording, {
            punchRecordingStore: { value: baseState({ enabled: false }), set } as never,
        });
        togglePunchRecording();
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    });
});
