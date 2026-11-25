import { describe, expect, it } from 'vitest';

import { automationRecordingDependenciesPort, setAutomationRecordingDependencies } from '../recordingDependencies';

const context = { baseLatency: 0, outputLatency: 0 } as AudioContext;

function getAudioContext(): AudioContext {
    return context;
}

function getCompensationDelay(): number {
    return 0;
}

function otherCompensationDelay(): number {
    return 0.01;
}

describe('recordingDependencies', () => {
    it('throws naming the registrar when read before registration', () => {
        expect(() => automationRecordingDependenciesPort.read()).toThrow(
            'automationRecordingDependenciesPort.read: automation recording dependencies are not registered; call setAutomationRecordingDependencies() from #/app/bootstrap'
        );
    });

    it('returns what was filled', () => {
        setAutomationRecordingDependencies({ getAudioContext, getCompensationDelay });

        expect(automationRecordingDependenciesPort.read().getAudioContext).toBe(getAudioContext);
        expect(automationRecordingDependenciesPort.read().getCompensationDelay).toBe(getCompensationDelay);
    });

    it('replaces the first fill with a second', () => {
        setAutomationRecordingDependencies({ getAudioContext, getCompensationDelay });
        setAutomationRecordingDependencies({ getAudioContext, getCompensationDelay: otherCompensationDelay });

        expect(automationRecordingDependenciesPort.read().getCompensationDelay).toBe(otherCompensationDelay);
    });
});
