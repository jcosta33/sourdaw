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

function compile(actions: readonly AppAction[], context: ProjectContext) {
    return compilePlannedActionCommandBatch({
        actions,
        actionLabels: actions.map((action) => action.type),
        autoCommit: true,
        context,
        group: { groupId: 'group-1', groupLabel: 'Prompt action' },
        intent: 'Apply the requested changes',
        projectRevision: 'revision-1',
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
        if (!result.commandBatch) {
            throw new Error('Expected clearSolos to require an outer command batch');
        }

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
        if (!result.commandBatch) {
            throw new Error('Expected thinAutomation to require an outer command batch');
        }

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

    it('keeps one non-serializable legacy action outside the outer batch and rejects combining it', () => {
        const split: AppAction = { type: 'splitClip', payload: { clipId: 'clip-1', beat: 8 } };

        expect(compile([split], baseContext)).toMatchObject({
            commandEnvelopes: [expect.any(String)],
            commandBatch: undefined,
        });
        expect(() =>
            compile([split, { type: 'splitClip', payload: { clipId: 'clip-2', beat: 16 } }], baseContext)
        ).toThrow('Multi-action and dynamic-scope prompts require fully serializable commands');
    });
});
