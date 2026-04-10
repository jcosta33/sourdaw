import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type PunchRecordingState } from '#/modules/Transport/stores/punchRecordingStore';
import { updateCapturePosition } from './updateCapturePosition';

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

describe('updateCapturePosition', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('updates endBeat', () => {
        const set = vi.fn();
        injectDependencies(updateCapturePosition, {
            punchRecordingStore: {
                value: baseState({
                    captures: [
                        {
                            id: 'c1',
                            trackId: 't',
                            startBeat: 0,
                            endBeat: 2,
                            recording: true,
                            punchRegions: [],
                        },
                    ],
                }),
                set,
            } as never,
        });
        updateCapturePosition('c1', 16);
        const next = set.mock.calls[0]![0] as PunchRecordingState;
        expect(next.captures[0]!.endBeat).toBe(16);
    });
});
