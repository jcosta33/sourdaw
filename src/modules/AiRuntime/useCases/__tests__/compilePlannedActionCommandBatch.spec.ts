import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';

const baseContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function compile(actions: readonly AppAction[], context: ProjectContext, protectedTargetIds?: readonly string[]) {
    return compilePlannedActionCommandBatch({
        actions,
        actionLabels: actions.map((action) => action.type),
        autoCommit: true,
        context,
        group: { groupId: 'group-1', groupLabel: 'Prompt action' },
        intent: 'Apply the requested changes',
        projectRevision: 'revision-1',
        protectedTargetIds,
        runId: 'run-1',
    });
}

function track(id: string, soloed: boolean): ProjectContext['tracks'][number] {
    return {
        id,
        name: id,
        kind: 'audio',
        muted: false,
        soloed,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
    };
}

describe('compilePlannedActionCommandBatch', () => {
    beforeEach(() => {
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAutomationHandlers());
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('binds clearSolos to the exact currently soloed track set', () => {
        const result = compile([{ type: 'clearSolos' }], {
            ...baseContext,
            tracks: [track('track-solo-a', true), track('track-safe', false), track('track-solo-b', true)],
        });
        expect([...result.commandBatch.authority.scope.targetIds].sort()).toEqual(['track-solo-a', 'track-solo-b']);
        expect(result.commandBatch.authority.budgets.maxAffectedTracks).toBe(2);
    });

    it('binds whole-lane automation transforms to the current lane size and owners', () => {
        const result = compile([{ type: 'thinAutomation', payload: { laneId: 'lane-1', tolerance: 0.05 } }], {
            ...baseContext,
            tracks: [track('track-1', false)],
            automationLanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    name: 'Gain',
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                    points: [
                        { beat: 0, value: 0.5, curve: 'linear' },
                        { beat: 1, value: 0.6, curve: 'linear' },
                        { beat: 2, value: 0.7, curve: 'linear' },
                    ],
                },
            ],
        });
        expect(result.commandBatch.authority.scope.targetIds).toEqual(
            expect.arrayContaining(['lane-1', 'track-1', 'clip-1'])
        );
        expect(result.commandBatch.authority.budgets).toMatchObject({
            maxAffectedTracks: 1,
            maxAffectedClips: 1,
            maxAutomationPoints: 3,
            maxDeletedObjects: 3,
        });
    });

    it('rejects an automation transform when the current lane cannot prove its bound', () => {
        expect(() =>
            compile([{ type: 'reverseAutomation', payload: { laneId: 'missing-lane' } }], baseContext)
        ).toThrow('Cannot prove automation bounds for lane missing-lane');
    });

    it('materializes derived clip identities so split operations can enter an ordered batch', () => {
        const split: AppAction = { type: 'splitClip', payload: { clipId: 'clip-1', beat: 8 } };

        const result = compile([split], baseContext);

        expect(result.commandBatch.serialized).toContain('splitClip');
        expect(result.commandBatch.authority.grants.create).toBe(true);
    });

    it('represents multiple duplicate operations as one bounded ordered batch', () => {
        const duplicateContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    ...track('track-1', false),
                    clips: [
                        {
                            id: 'clip-1',
                            name: 'Clip 1',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 4,
                            noteCount: 0,
                        },
                        {
                            id: 'clip-2',
                            name: 'Clip 2',
                            type: 'audio',
                            startBeat: 4,
                            endBeat: 8,
                            noteCount: 0,
                        },
                    ],
                    clipCount: 2,
                },
            ],
            automationLanes: [
                {
                    id: 'lane-clip-1',
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    name: 'Clip gain',
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                    points: [
                        { beat: 0, value: 0.5, curve: 'linear' },
                        { beat: 1, value: 0.6, curve: 'linear' },
                    ],
                },
            ],
        };
        const result = compile(
            [
                { type: 'duplicateClip', payload: { clipId: 'clip-1' } },
                { type: 'duplicateClipToNextBar', payload: { clipId: 'clip-2' } },
            ],
            duplicateContext
        );

        expect(result.commandBatch.authority.budgets.maxCommands).toBe(2);
        expect(result.commandBatch.authority.budgets.maxAffectedTracks).toBe(1);
        expect(result.commandBatch.authority.budgets.maxAffectedClips).toBe(4);
        expect(result.commandBatch.authority.budgets.maxAutomationPoints).toBe(2);
        expect(result.commandBatch.authority.grants.create).toBe(true);
        expect(result.commandBatch.serialized).toContain('targetClipId');
    });

    it('binds duplicateTrack to its source clips and automation size before hashing', () => {
        const result = compile([{ type: 'duplicateTrack', payload: { trackId: 'track-1' } }], {
            ...baseContext,
            tracks: [
                {
                    ...track('track-1', false),
                    alternativeClipIds: ['clip-hidden'],
                    clips: [
                        {
                            id: 'clip-active',
                            name: 'Active',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 4,
                            noteCount: 0,
                        },
                    ],
                    clipCount: 1,
                },
            ],
            automationLanes: [
                {
                    id: 'lane-track',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    name: 'Gain',
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                    points: [
                        { beat: 0, value: 0.5, curve: 'linear' },
                        { beat: 4, value: 0.8, curve: 'linear' },
                    ],
                },
            ],
        });

        expect(result.commandBatch.authority.scope.targetIds).toEqual(
            expect.arrayContaining(['track-1', 'clip-active', 'clip-hidden'])
        );
        expect(result.commandBatch.authority.budgets).toMatchObject({
            maxAffectedTracks: 2,
            maxAffectedClips: 2,
            maxAutomationPoints: 2,
        });
    });

    it('binds the complete track-removal cascade and rejects protected survivor rewrites', () => {
        const removalContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    ...track('track-remove', false),
                    clipCount: 1,
                    deviceCount: 1,
                    clips: [
                        {
                            id: 'clip-remove',
                            name: 'Removed clip',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 4,
                            noteCount: 0,
                        },
                    ],
                    devices: [{ id: 'device-remove', type: 'builtin-eq', bypassed: false }],
                },
                {
                    ...track('track-survivor', false),
                    outputId: 'track-remove',
                    sends: [{ busId: 'track-remove', level: 0.5, preFader: false }],
                },
            ],
            automationLanes: [
                {
                    id: 'lane-remove',
                    trackId: 'track-remove',
                    parameterId: 'gain',
                    name: 'Gain',
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                    points: [
                        { beat: 0, value: 0.5, curve: 'linear' },
                        { beat: 4, value: 0.8, curve: 'linear' },
                    ],
                },
            ],
            sidechainRoutes: [
                {
                    id: 'route-remove',
                    sourceTrackId: 'track-survivor',
                    targetTrackId: 'track-remove',
                    targetDeviceId: 'device-remove',
                    targetParameterId: 'threshold',
                    gain: 1,
                },
            ],
        };
        const action: AppAction = {
            type: 'removeTrack',
            payload: { trackId: 'track-remove', expectedClipIds: ['clip-remove'] },
        };

        expect(() => compile([action], removalContext, ['track-survivor'])).toThrow(
            'Track removal targets protected objects: track-survivor'
        );

        const result = compile([action], removalContext);
        expect(result.commandBatch.authority.scope.targetIds).toEqual(
            expect.arrayContaining([
                'track-remove',
                'track-survivor',
                'clip-remove',
                'device-remove',
                'lane-remove',
                'route-remove',
            ])
        );
        expect(result.commandBatch.authority.budgets).toMatchObject({
            maxAffectedTracks: 2,
            maxAffectedClips: 1,
            maxAutomationPoints: 2,
            maxDeletedObjects: 7,
        });
    });
});
