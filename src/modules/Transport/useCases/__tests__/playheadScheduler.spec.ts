import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startPlayheadScheduler, stopPlayheadScheduler } from '../playheadScheduler';
import { startAutomationRecording, stopAutomationRecording } from '#/modules/Automation/useCases';
import { transportStore } from '../../stores/transportStore';

vi.mock('../../stores/transportStore', () => ({
    transportStore: { value: null, set: vi.fn() },
}));
vi.mock('../../stores/playheadPositionRef', () => ({
    playheadPositionRef: { current: 0 },
}));
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../models/TempoMap', () => ({
    getTempoAtBeat: vi.fn(() => 120),
}));
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...mod,
        trackStore: { value: { tracks: [] } },
        takeLaneStore: { value: { lanes: [] } },
    };
});
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...mod,
        addTakeLane: vi.fn(),
        addTake: vi.fn(),
        startRecording: vi.fn(() => []),
        stopRecording: vi.fn(),
    };
});
vi.mock('../evaluateFollowActions', () => ({
    evaluateFollowActions: vi.fn(() => ({ jumpToPosition: null, shouldStop: false })),
}));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { set: vi.fn(), get: vi.fn() },
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        stopAllScheduled: vi.fn(),
        startAudioRecording: vi.fn(),
        stopAudioRecording: vi.fn(),
        getAudioContext: vi.fn(() => ({
            currentTime: 0,
            createGain: vi.fn(() => ({
                gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
                connect: vi.fn(),
                disconnect: vi.fn(),
            })),
        })),
    };
});
vi.mock('../scheduling/scheduleMetronome', () => ({
    resetMetronomeBeat: vi.fn(),
    scheduleMetronome: vi.fn(),
}));
vi.mock('../scheduling/scheduleMidiNotes', () => ({
    scheduleMidiNotes: vi.fn(),
}));
vi.mock('../scheduling/scheduleAudioClips', () => ({
    scheduleAudioClips: vi.fn(),
}));
vi.mock('../scheduling/applyAutomation/applyVcaGains', () => ({
    applyVcaGains: vi.fn(),
}));
vi.mock('../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        ...mod,
        startAutomationRecording: vi.fn(),
        stopAutomationRecording: vi.fn(),
    };
});

describe('startPlayheadScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.value = null;
    });

    it('does not start automation recording when transport state is missing', () => {
        startPlayheadScheduler();

        expect(startAutomationRecording).not.toHaveBeenCalled();
    });
});

describe('stopPlayheadScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stops automation recording', () => {
        stopPlayheadScheduler();

        expect(stopAutomationRecording).toHaveBeenCalled();
    });
});
