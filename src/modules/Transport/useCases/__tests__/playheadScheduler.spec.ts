import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startAutomationRecording } from '#/modules/Automation/useCases/automationRecording/startAutomationRecording';
import { stopAutomationRecording } from '#/modules/Automation/useCases/automationRecording/stopAutomationRecording';

import { transportStore } from '../../stores/transportStore';
import { startPlayheadScheduler, stopPlayheadScheduler } from '../playheadScheduler';

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
vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: { value: { lanes: [] } },
}));
vi.mock('#/modules/Arrangement/useCases/comping/addTakeLane', () => ({ addTakeLane: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases/comping/addTake', () => ({ addTake: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases/recording/startRecording', () => ({ startRecording: vi.fn(() => []) }));
vi.mock('#/modules/Arrangement/useCases/recording/stopRecording', () => ({ stopRecording: vi.fn() }));
vi.mock('../evaluateFollowActions', () => ({
    evaluateFollowActions: vi.fn(() => ({ jumpToPosition: null, shouldStop: false })),
}));
vi.mock('#/modules/AudioEngine/stores/audioBufferCache', () => ({
    audioBufferCache: { set: vi.fn(), get: vi.fn() },
}));
vi.mock('#/modules/AudioEngine/useCases/scheduling/stopAllScheduled', () => ({ stopAllScheduled: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases/audioRecorder/startAudioRecording', () => ({ startAudioRecording: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases/audioRecorder/stopAudioRecording', () => ({ stopAudioRecording: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases/engineAccess/getAudioContext', () => ({
    getAudioContext: vi.fn(() => ({
        currentTime: 0,
        createGain: vi.fn(() => ({
            gain: {
                value: 1,
                cancelScheduledValues: vi.fn(),
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
            disconnect: vi.fn(),
        })),
    })),
    audioEngine: {},
}));
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
vi.mock('#/modules/Automation/useCases/automationRecording/startAutomationRecording', () => ({
    startAutomationRecording: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases/automationRecording/stopAutomationRecording', () => ({
    stopAutomationRecording: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases/modulation/applyModulation', () => ({
    applyModulation: vi.fn(),
}));

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
