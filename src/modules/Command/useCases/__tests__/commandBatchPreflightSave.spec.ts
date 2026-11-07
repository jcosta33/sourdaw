import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    settledProjectRevisionMatchesLiveIgnoringSaveWrites,
} from '#/modules/CrdtDocument/useCases';
import { arrangementStore, defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';

import { type VersionedCommandBatchEnvelope } from '../../models/VersionedCommandBatchEnvelope';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { prepareCommandBatchPreflight } from '../prepareCommandBatchPreflight';

describe('command preflight save and content authority', () => {
    afterEach(() => {
        configureAutomergeStoragePort(null);
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        vi.unstubAllGlobals();
    });

    function revisionEnvelope(revision: string): VersionedCommandBatchEnvelope {
        const command = createExecutionCommandEnvelope({
            action: { type: 'setTrackGain', payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 } },
            expectedEffect: 'Set gain',
            normalizedProjectRevision: revision,
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-save',
            batchId: 'batch-save',
            projectId: 'project-1',
            baseRevision: revision,
            intent: 'Set gain',
            commands: [JSON.stringify(command.envelope)],
        });
        const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
        if (parsed.status !== 'valid') {
            throw new Error(parsed.reason);
        }
        return {
            ...parsed.envelope,
            postconditions: [...parsed.envelope.postconditions, { kind: 'project-revision', value: revision }],
        };
    }

    function validState() {
        return {
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-vocal': 'vocal' },
        };
    }

    it('settles before both state captures and supplies only the original exact condition revision', () => {
        let settled = false;
        commandProjectRevisionPort.setProvider(() => 'saved');
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(() => {
            settled = true;
            return true;
        });
        const captures: boolean[] = [];
        commandBatchPreflightPort.setProvider(() => {
            captures.push(settled);
            return validState();
        });
        const envelope = revisionEnvelope('base');
        const prepared = prepareCommandBatchPreflight(envelope);
        expect(prepared.status).toBe('ready');
        if (prepared.status !== 'ready') {
            throw new Error(prepared.reason);
        }
        settled = false;
        expect(prepared.postconditions.validate({})).toBeNull();
        expect(captures).toEqual([true, true]);
        expect(
            prepareCommandBatchPreflight({
                ...envelope,
                preconditions: [...envelope.preconditions, { kind: 'project-revision', value: 'other' }],
            })
        ).toMatchObject({
            status: 'rejected',
            reason: 'Command batch base revision does not match current project state',
        });
        const wrongPost = prepareCommandBatchPreflight({
            ...envelope,
            postconditions: [...envelope.postconditions, { kind: 'project-revision', value: 'other' }],
        });
        if (wrongPost.status !== 'ready') {
            throw new Error(wrongPost.reason);
        }
        expect(wrongPost.postconditions.validate({})).toBe(
            'Command batch base revision does not match current project state'
        );
    });

    it('rechecks actual save and pending content edits after preparation without caching permission', async () => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        try {
            projectStore.set(structuredClone(defaultProjectStoreState));
            arrangementStore.set({
                activeArrangementId: 'save',
                arrangements: [
                    {
                        id: 'save',
                        name: 'Save',
                        tracks: { tracks: [], selectedTrackId: null },
                        automation: { lanes: [] },
                        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                    },
                ],
            });
            flushAutomergeStorageWrites();
            const revision = captureProjectRevision();
            commandProjectRevisionPort.setProvider(captureProjectRevision);
            commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(
                settledProjectRevisionMatchesLiveIgnoringSaveWrites
            );
            commandBatchPreflightPort.setProvider(validState);
            const envelope = revisionEnvelope(revision);
            const prepared = prepareCommandBatchPreflight(envelope);
            if (prepared.status !== 'ready') {
                throw new Error(prepared.reason);
            }
            const project = projectStore.value;
            if (!project) {
                throw new Error('Expected project');
            }
            projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000 });
            registerSupportingServicePorts();
            await buildProjectData({ includeAudioBuffers: false });
            flushAutomergeStorageWrites();
            expect(captureProjectRevision()).not.toBe(revision);
            expect(prepareCommandBatchPreflight(envelope).status).toBe('ready');
            const savedDocument = getCrdtDoc('root');
            if (!savedDocument) {
                throw new Error('Expected saved root');
            }
            expect(prepared.postconditions.validate(savedDocument)).toBeNull();
            vi.stubGlobal('requestAnimationFrame', () => 0);
            const savedProject = projectStore.value;
            if (!savedProject) {
                throw new Error('Expected saved project');
            }
            projectStore.set({ ...savedProject, name: 'Edited project' });
            expect(prepared.postconditions.validate(savedDocument)).toBe(
                'Command batch base revision does not match current project state'
            );
            expect(prepareCommandBatchPreflight(envelope).status).toBe('rejected');
            const compatible = prepareCommandBatchPreflight(envelope, { allowCompatibleProjectDivergence: true });
            expect(compatible.status).toBe('ready');
            if (compatible.status !== 'ready') {
                throw new Error(compatible.reason);
            }
            expect(compatible.postconditions.validate({})).toBe(
                'Command batch base revision does not match current project state'
            );
        } finally {
            flushAutomergeStorageWrites();
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
        }
    });
});
