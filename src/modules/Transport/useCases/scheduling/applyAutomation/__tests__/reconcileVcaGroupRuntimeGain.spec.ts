import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    automationStoreValue: {
        value: {
            lanes: [
                {
                    id: 'lane-automated-gain',
                    trackId: 'automated',
                    parameterId: 'gain',
                    minValue: 0,
                    enabled: true,
                    points: [{ beat: 0, value: 0.7 }],
                },
                {
                    id: 'lane-automated-pan',
                    trackId: 'automated',
                    parameterId: 'pan',
                    minValue: -1,
                    enabled: true,
                    points: [{ beat: 0, value: 0 }],
                },
                {
                    id: 'lane-other-gain',
                    trackId: 'other',
                    parameterId: 'gain',
                    minValue: 0,
                    enabled: true,
                    points: [{ beat: 0, value: 0.9 }],
                },
                {
                    id: 'lane-removed-gain',
                    trackId: 'removed-automated',
                    parameterId: 'gain',
                    minValue: 0,
                    enabled: true,
                    points: [{ beat: 0, value: 0.7 }],
                },
            ],
        },
    },
    deriveVcaMultiplier: vi.fn(({ vcaGroupId }: { vcaGroupId?: string | null }) =>
        vcaGroupId === null || vcaGroupId === undefined ? 1 : 0.5
    ),
    getAutomationValueAtBeat: vi.fn(() => 0.7),
    getCompensationDelay: vi.fn(() => 0.25),
    getCurrentTime: vi.fn(() => 10),
    getVcaGroupsState: vi.fn(() => [
        { id: 'vca-drums', name: 'Drums', gain: 0.5, muted: false, trackIds: ['muted', 'automated', 'static'] },
    ]),
    isRecordingAutomation: vi.fn<(trackId: string, parameterId: string) => boolean>(() => false),
    resolveAutoMatchValue: vi.fn(() => ({ value: 0.7, isReleaseStart: false })),
    scheduleTrackGain: vi.fn(),
    setTrackGain: vi.fn(),
    trackStoreValue: {
        value: {
            tracks: [
                {
                    id: 'muted',
                    vcaGroupId: 'vca-drums',
                    muted: true,
                    gain: 0.4,
                    automationMode: 'read',
                    clips: [],
                },
                {
                    id: 'automated',
                    vcaGroupId: 'vca-drums',
                    muted: false,
                    gain: 0.8,
                    automationMode: 'read',
                    clips: [],
                },
                {
                    id: 'static',
                    vcaGroupId: 'vca-drums',
                    muted: false,
                    gain: 0.6,
                    automationMode: 'read',
                    clips: [],
                },
                {
                    id: 'other',
                    vcaGroupId: 'vca-backing',
                    muted: false,
                    gain: 0.5,
                    automationMode: 'read',
                    clips: [],
                },
                {
                    id: 'removed-static',
                    vcaGroupId: null,
                    muted: true,
                    gain: 0.5,
                    automationMode: 'read',
                    clips: [],
                },
                {
                    id: 'removed-automated',
                    vcaGroupId: null,
                    muted: false,
                    gain: 0.9,
                    automationMode: 'read',
                    clips: [],
                },
            ],
        },
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    deriveVcaMultiplier: mocks.deriveVcaMultiplier,
    getVcaGroupsState: mocks.getVcaGroupsState,
    trackStore: mocks.trackStoreValue,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCompensationDelay: mocks.getCompensationDelay,
    getCurrentTime: mocks.getCurrentTime,
    scheduleTrackGain: mocks.scheduleTrackGain,
    setTrackGain: mocks.setTrackGain,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: mocks.automationStoreValue,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationValueAtBeat: mocks.getAutomationValueAtBeat,
    isRecordingAutomation: mocks.isRecordingAutomation,
    resolveAutoMatchValue: mocks.resolveAutoMatchValue,
}));

import { playheadPositionRef } from '../../../../stores/playheadPositionRef';
import { reconcileVcaGroupRuntimeGain } from '../reconcileVcaGroupRuntimeGain';
import { reconcileVcaRuntimeGain } from '../reconcileVcaRuntimeGain';

describe('reconcileVcaGroupRuntimeGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playheadPositionRef.current = 37;
    });

    it('projects only affected gain lanes and every static member, including muted tracks', () => {
        reconcileVcaGroupRuntimeGain('vca-drums');

        expect(mocks.getAutomationValueAtBeat).toHaveBeenCalledOnce();
        expect(mocks.getAutomationValueAtBeat).toHaveBeenCalledWith('lane-automated-gain', 37);
        expect(mocks.scheduleTrackGain).toHaveBeenCalledWith('automated', 0.35, 10.25);
        expect(mocks.setTrackGain.mock.calls).toEqual([
            ['muted', 0.2],
            ['static', 0.3],
        ]);
    });

    it('falls back to current durable gain while an affected lane is recording', () => {
        mocks.isRecordingAutomation.mockImplementation((trackId: string) => trackId === 'automated');

        reconcileVcaGroupRuntimeGain('vca-drums');

        expect(mocks.scheduleTrackGain).not.toHaveBeenCalled();
        expect(mocks.setTrackGain).toHaveBeenCalledWith('automated', 0.4);
    });

    it('reprojects removed tracks from current durable state, including muted and automated tracks', () => {
        reconcileVcaRuntimeGain({
            groupIds: [],
            trackIds: ['removed-static', 'removed-automated', 'removed-static'],
        });

        expect(mocks.getAutomationValueAtBeat).toHaveBeenCalledOnce();
        expect(mocks.getAutomationValueAtBeat).toHaveBeenCalledWith('lane-removed-gain', 37);
        expect(mocks.scheduleTrackGain).toHaveBeenCalledWith('removed-automated', 0.7, 10.25);
        expect(mocks.setTrackGain).toHaveBeenCalledWith('removed-static', 0.5);
    });

    it('does not touch runtime state when no tracks or groups are affected', () => {
        reconcileVcaRuntimeGain({ groupIds: [], trackIds: [] });

        expect(mocks.getCurrentTime).not.toHaveBeenCalled();
        expect(mocks.setTrackGain).not.toHaveBeenCalled();
        expect(mocks.scheduleTrackGain).not.toHaveBeenCalled();
    });
});
