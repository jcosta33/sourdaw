import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { startPlayheadScheduler, stopPlayheadScheduler } from './playheadScheduler';

function createPlayheadSchedulerMocks() {
    return {
        transportStore: { value: null },
        playheadPositionRef: { current: 0 },
        tempoMapStore: { value: { changes: [] } },
        getTempoAtBeat: vi.fn(() => 120),
        trackStore: { value: { tracks: [] } },
        takeLaneStore: { value: { lanes: [] } },
        addTakeLane: vi.fn(),
        addTake: vi.fn(),
        evaluateFollowActions: vi.fn(() => ({ jumpToPosition: null as number | null, shouldStop: false })),
        stopAllScheduled: vi.fn(),
        audioBufferCache: { set: vi.fn(), get: vi.fn() },
        startAudioRecording: vi.fn(),
        stopAudioRecording: vi.fn(),
        startRecording: vi.fn(() => []),
        stopRecording: vi.fn(),
        getAudioContext: vi.fn(
            () =>
                ({
                    currentTime: 0,
                    createGain: vi.fn(() => ({
                        gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
                        connect: vi.fn(),
                        disconnect: vi.fn(),
                    })),
                }) as unknown as AudioContext
        ),
        resetMetronomeBeat: vi.fn(),
        scheduleMetronome: vi.fn(),
        scheduleMidiNotes: vi.fn(),
        scheduleAudioClips: vi.fn(),
        applyVcaGains: vi.fn(),
        applyAutomation: vi.fn(),
        startAutomationRecording: vi.fn(),
        stopAutomationRecording: vi.fn(),
    };
}

describe('startPlayheadScheduler', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not start automation recording when transport state is missing', () => {
        const mocks = createPlayheadSchedulerMocks();
        const startAutomationRecording = vi.fn();
        injectDependencies(startPlayheadScheduler, {
            ...mocks,
            startAutomationRecording,
        });

        startPlayheadScheduler();

        expect(startAutomationRecording).not.toHaveBeenCalled();
    });
});

describe('stopPlayheadScheduler', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('stops automation recording', () => {
        const mocks = createPlayheadSchedulerMocks();
        const stopAutomationRecording = vi.fn();
        injectDependencies(stopPlayheadScheduler, {
            ...mocks,
            stopAutomationRecording,
        });

        stopPlayheadScheduler();

        expect(stopAutomationRecording).toHaveBeenCalled();
    });
});
