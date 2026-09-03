import { afterEach, describe, expect, it } from 'vitest';

import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectDivergencePort } from '../commandProjectDivergencePort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { refreshVersionedCommandBatchForApproval } from '../refreshVersionedCommandBatchForApproval';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

describe('refreshVersionedCommandBatchForApproval', () => {
    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandProjectDivergencePort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
    });

    it('supplies complete ordered batch context to divergence and live validation', () => {
        const divergenceContexts: HandlerValidationContext[] = [];
        const validationContexts: HandlerValidationContext[] = [];
        registerHandlerMap({
            setTrackGain: {
                canReapplyAfterDivergence: (_action, context) => {
                    if (context) {
                        divergenceContexts.push(context);
                    }
                    return true;
                },
                describe: () => ({ label: 'Set track gain' }),
                execute: () => ({ status: 'written' }),
                undoable: false,
                validate: (_action, context) => {
                    validationContexts.push(context);
                    return true;
                },
            },
            setTrackPan: {
                canReapplyAfterDivergence: (_action, context) => {
                    if (context) {
                        divergenceContexts.push(context);
                    }
                    return true;
                },
                describe: () => ({ label: 'Set track pan' }),
                execute: () => ({ status: 'written' }),
                undoable: false,
                validate: (_action, context) => {
                    validationContexts.push(context);
                    return true;
                },
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-live');
        commandProjectDivergencePort.setProvider(({ commandsCompatible, targetIds }) => ({
            kind: 'compatible-same-object',
            mayReapply: commandsCompatible,
            repairCandidates: [],
            targetIds,
        }));
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-refresh',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-gain': 'gain-v1', 'track-pan': 'pan-v1' },
        }));
        const firstAction: AppAction = {
            type: 'setTrackGain',
            payload: { trackId: 'track-gain', gain: 0.8, expectedGain: 1 },
        };
        const secondAction: AppAction = {
            type: 'setTrackPan',
            payload: { trackId: 'track-pan', pan: -0.2, expectedPan: 0 },
        };
        const first = createExecutionCommandEnvelope({
            action: firstAction,
            expectedEffect: 'Track gain changes.',
            normalizedProjectRevision: 'revision-stale',
        }).envelope;
        const second = createExecutionCommandEnvelope({
            action: secondAction,
            dependencyIds: [first.commandId],
            expectedEffect: 'Track pan changes.',
            normalizedProjectRevision: 'revision-stale',
        }).envelope;
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: 'revision-stale',
            batchId: 'batch-refresh-context',
            commands: [serializeVersionedCommandEnvelope(first), serializeVersionedCommandEnvelope(second)],
            intent: 'Refresh ordered context',
            mode: 'commit',
            projectId: 'project-refresh',
            runId: 'run-refresh-context',
        });

        const result = refreshVersionedCommandBatchForApproval({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('ready');
        const actions: readonly AppAction[] = [firstAction, secondAction];
        expect(divergenceContexts).toEqual([
            { actions, actionIndex: 0 },
            { actions, actionIndex: 1 },
        ]);
        expect(validationContexts).toEqual([
            { actions, actionIndex: 0 },
            { actions, actionIndex: 1 },
        ]);
    });
});
