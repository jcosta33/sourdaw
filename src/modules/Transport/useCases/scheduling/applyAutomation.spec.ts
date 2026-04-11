import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { applyVcaGains } from './applyAutomation/applyVcaGains';
import { applyAutomation } from './applyAutomation/applyAutomation';

function createApplyAutomationMocks() {
    return {
        trackStore: { value: { tracks: [] } },
        automationStore: { value: { lanes: [] } },
        getAutomationValueAtBeat: vi.fn(),
        isRecordingAutomation: vi.fn(() => false),
        getEffectiveGain: vi.fn((_, g: number) => g),
        engineSetTrackGain: vi.fn(),
        engineSetTrackPan: vi.fn(),
        updateDeviceParam: vi.fn(),
    };
}

describe('applyVcaGains', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not change gain when there are no tracks', () => {
        const mocks = createApplyAutomationMocks();
        injectDependencies(applyVcaGains, mocks);

        applyVcaGains();

        expect(mocks.engineSetTrackGain).not.toHaveBeenCalled();
    });
});

describe('applyAutomation', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not touch the engine when automation state is missing', () => {
        const mocks = createApplyAutomationMocks();
        injectDependencies(applyAutomation, {
            ...mocks,
            automationStore: { value: null },
        });

        applyAutomation(0);

        expect(mocks.engineSetTrackGain).not.toHaveBeenCalled();
        expect(mocks.engineSetTrackPan).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });
});
