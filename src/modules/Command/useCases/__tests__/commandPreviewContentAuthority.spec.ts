import { from } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    createAutomergeStoragePreview,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandBatchPreviewPort } from '../commandBatchPreviewPort';
import { commandProjectDivergencePort } from '../commandProjectDivergencePort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';

import { executeApprovedVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;
type IsolatedPreviewGainHandler = Extract<ActionHandler<SetTrackGainAction>, { previewExecution: 'isolated-project' }>;

describe('preview same-content and compatible-divergence authority', () => {
    const BASE_REVISION = 'revision-saga-0';
    let projectDocument: Record<string, unknown>;
    let projectRevision: string;
    let workspaceRevisions: string[];

    function compileGainBatch(mode: 'commit' | 'preview') {
        const action: SetTrackGainAction = {
            type: 'setTrackGain',
            payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
        };
        const command = {
            ...createExecutionCommandEnvelope({
                action,
                expectedEffect: 'Set the vocal gain to 0.8.',
                normalizedProjectRevision: BASE_REVISION,
            }).envelope,
            commandId: '11111111-1111-4111-8111-111111111111',
        };
        return compileVersionedCommandBatchEnvelope({
            baseRevision: BASE_REVISION,
            batchId: `batch-saga-${mode}`,
            commands: [JSON.stringify(command)],
            intent: 'Set vocal gain',
            mode,
            projectId: 'project-saga',
            runId: `run-saga-${mode}`,
        });
    }

    function registerGainHandler(execute: IsolatedPreviewGainHandler['execute']): void {
        registerHandlerMap({
            setTrackGain: {
                canReapplyAfterDivergence: () => true,
                describe: () => ({
                    label: 'Set vocal gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                execute,
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        projectDocument = { trackGain: { value: 1 } };
        projectRevision = BASE_REVISION;
        workspaceRevisions = [];
        configureAutomergeStoragePort({
            getDoc: () => projectDocument,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                const draft = structuredClone(projectDocument);
                changeFn(draft);
                projectDocument = draft;
            },
        });
        commandBatchPreviewPort.setProvider((revision) => {
            workspaceRevisions.push(revision);
            const preview = createAutomergeStoragePreview(new Map([['root', from(projectDocument)]]));
            return {
                getProjectDocument: () => preview.getDocument('root') ?? {},
                release: preview.release,
                scope: preview.scope,
            };
        });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-saga',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-vocal': 'track:track-vocal' },
        }));
        commandProjectRevisionPort.setProvider(() => projectRevision);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        commandBatchPreviewPort.setProvider(null);
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        commandProjectDivergencePort.setProvider(null);
        clearHandlerRegistry();
    });

    it.each([true, false])('classifies a raw-equal pending divergence with mayReapply=%s', async (mayReapply) => {
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        gainStorage.hydrate?.();
        registerGainHandler(() => {
            gainStorage.set({ value: 0.8 });
            return { status: 'written' };
        });
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(() => {
            projectRevision = 'settled-edit';
            return false;
        });
        const classify = vi.fn(() => ({
            kind: 'non-overlapping' as const,
            mayReapply,
            repairCandidates: [],
            targetIds: [],
        }));
        commandProjectDivergencePort.setProvider(classify);
        const result = await executeApprovedVersionedCommandBatchEnvelope(compileGainBatch('preview'));
        expect(classify).toHaveBeenCalledWith({
            baseRevision: BASE_REVISION,
            commandsCompatible: true,
            targetIds: ['track-vocal'],
        });
        expect(result.status).toBe(mayReapply ? 'previewed' : 'conflicted');
        expect(workspaceRevisions).toEqual(mayReapply ? ['settled-edit'] : []);
        expect(projectDocument).toEqual({ trackGain: { value: 1 } });
        if (result.status === 'previewed') {
            expect(result).toMatchObject({ baseRevision: BASE_REVISION, divergence: { kind: 'non-overlapping' } });
            result.resource.release();
        }
    });

    it('does not classify save-only movement or restamp preview authority', async () => {
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        gainStorage.hydrate?.();
        registerGainHandler(() => {
            gainStorage.set({ value: 0.8 });
            return { status: 'written' };
        });
        projectRevision = 'saved';
        const matches = vi.fn(() => true);
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(matches);
        const classify = vi.fn(() => ({
            kind: 'ambiguous-same-object' as const,
            mayReapply: false,
            repairCandidates: [],
            targetIds: [],
        }));
        commandProjectDivergencePort.setProvider(classify);
        const result = await executeApprovedVersionedCommandBatchEnvelope(compileGainBatch('preview'));
        expect(result.status, JSON.stringify(result)).toBe('previewed');
        expect(matches).toHaveBeenCalledWith(BASE_REVISION);
        expect(classify).not.toHaveBeenCalled();
        expect(workspaceRevisions).toEqual([BASE_REVISION]);
        if (result.status === 'previewed') {
            expect(result).toMatchObject({
                baseRevision: BASE_REVISION,
                resource: { baseRevision: BASE_REVISION },
            });
            result.resource.release();
        }
    });
});
