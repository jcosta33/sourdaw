import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyVcaGains } from '../applyAutomation/applyVcaGains';
import { applyAutomation } from '../applyAutomation/applyAutomation';
import { setTrackGain } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...mod,
        trackStore: { value: { tracks: [] } },
    };
});
vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { value: { lanes: [] } },
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...mod,
        getEffectiveGain: vi.fn((_, g) => g),
    };
});
vi.mock('#/modules/Automation/stores', () => ({
    getAutomationValueAtBeat: vi.fn(),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        setTrackGain: vi.fn(),
        setTrackPan: vi.fn(),
        updateDeviceParam: vi.fn(),
    };
});

describe('applyVcaGains', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not change gain when there are no tracks', () => {
        applyVcaGains();
        expect(setTrackGain).not.toHaveBeenCalled();
    });
});

describe('applyAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not touch the engine when automation state is missing', () => {
        automationStore.value = null as any;
        applyAutomation(0);
        expect(setTrackGain).not.toHaveBeenCalled();
    });
});
