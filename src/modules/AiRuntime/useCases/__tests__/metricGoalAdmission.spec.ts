import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collaborationStore } from '#/modules/Collaboration/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { commandBatchPreflightPort, executeVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { compileAgentActionExecution } from '../compileAgentActionExecution';

import {
    configureAiWorkflowCommandCheckpointRuntime,
    resetAiWorkflowCommandCheckpointRuntime,
} from './aiWorkflowCommandCheckpointRuntime';

const initialCollaboration = structuredClone(collaborationStore.value!);

function vocalContext(): ProjectContext {
    return {
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
        tracks: [
            {
                id: 'track-vocal',
                name: 'Vocal',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
            },
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

describe('metric goal admission at the final Command boundary', () => {
    let firstHandlerWrites = 0;

    beforeEach(() => {
        configureAiWorkflowCommandCheckpointRuntime();
        firstHandlerWrites = 0;
        collaborationStore.set({ ...initialCollaboration, localPeerId: 'metric-goal-actor' });
        commandBatchPreflightPort.setProvider(({ targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: captureProjectIdentity(),
            projectInvariantsValid: true,
            targetFingerprints: Object.fromEntries(targetIds.map((id) => [id, `${id}:v1`])),
        }));
        registerHandlerMap({
            setTrackGain: {
                execute: () => {
                    firstHandlerWrites += 1;
                    return { status: 'written' as const };
                },
                validate: () => true,
                canReapplyAfterDivergence: () => true,
                describe: () => ({
                    label: 'Set Vocal gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { expectedGain: 0.7, gain: 0.8, trackId: 'track-vocal' },
                    },
                }),
                undoable: true,
            } satisfies ActionHandler<Extract<AppAction, { type: 'setTrackGain' }>>,
        });
    });

    afterEach(() => {
        resetAiWorkflowCommandCheckpointRuntime();
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        collaborationStore.set(structuredClone(initialCollaboration));
    });

    it('keeps a perceptual proposal visible and refuses its compile-minted permission without actual metric proof', async () => {
        const compiled = compileAgentActionExecution({
            actions: [{ type: 'setTrackGain', payload: { expectedGain: 0.8, gain: 0.7, trackId: 'track-vocal' } }],
            actionLabels: ['Set Vocal gain'],
            context: vocalContext(),
            group: { groupId: 'metric-goal-red', groupLabel: 'Make Vocal warmer' },
            intent: 'Make Vocal warmer',
            projectRevision: captureProjectRevision(),
            requiresConfirmation: false,
            runId: 'metric-goal-red',
        });
        const result = await executeVersionedCommandBatchEnvelope(compiled.commandBatch);

        expect({
            status: result.status,
            firstHandlerWrites,
            requiresConfirmation: compiled.requiresConfirmation,
        }).toEqual({
            status: 'rejected',
            firstHandlerWrites: 0,
            requiresConfirmation: true,
        });
    });
});
