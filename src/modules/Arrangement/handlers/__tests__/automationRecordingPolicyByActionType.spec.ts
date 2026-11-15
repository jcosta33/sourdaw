import { describe, expect, it } from 'vitest';

import {
    automationRecordingPolicyByActionType,
    getActionAutomationRecordingPolicy,
} from '../automationRecordingPolicyByActionType';

describe('automationRecordingPolicyByActionType', () => {
    it('gives exactly the three static parameter edits a policy reader', () => {
        const readers = Object.entries(automationRecordingPolicyByActionType)
            .filter(([, read]) => read !== automationRecordingPolicyByActionType.addTrack)
            .map(([type]) => type);

        expect(readers.toSorted()).toEqual(['setDeviceParameter', 'setTrackGain', 'setTrackPan']);
    });

    it.each([
        {
            name: 'setDeviceParameter',
            action: {
                type: 'setDeviceParameter',
                payload: { deviceId: 'd', paramId: 'p', value: 1, automationRecordingPolicy: 'suppressed' },
            },
        },
        {
            name: 'setTrackGain',
            action: {
                type: 'setTrackGain',
                payload: { trackId: 't', gain: 1, expectedGain: 1, automationRecordingPolicy: 'suppressed' },
            },
        },
        {
            name: 'setTrackPan',
            action: {
                type: 'setTrackPan',
                payload: { trackId: 't', pan: 0, expectedPan: 0, automationRecordingPolicy: 'suppressed' },
            },
        },
    ] as const)('reads the policy $name carries', ({ action }) => {
        expect(getActionAutomationRecordingPolicy(action)).toBe('suppressed');
    });

    it('reads no policy from a static edit that carries none', () => {
        expect(
            getActionAutomationRecordingPolicy({
                type: 'setTrackPan',
                payload: { trackId: 't', pan: 0, expectedPan: 0 },
            })
        ).toBeUndefined();
    });

    it('reads no policy from any other action', () => {
        expect(getActionAutomationRecordingPolicy({ type: 'removeAllTracks' })).toBeUndefined();
    });
});
