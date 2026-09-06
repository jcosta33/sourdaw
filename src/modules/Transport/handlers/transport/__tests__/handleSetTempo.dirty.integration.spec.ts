import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    commandProjectRevisionPort,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeAppAction,
    executeVersionedCommandBatchEnvelope,
    redo,
    serializeVersionedCommandEnvelope,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCommandPreviewWorkspace,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { initProjectDirtyTracking } from '#/modules/Project/useCases';

import { tempoMapStore } from '../../../stores/tempoMapStore';
import { tempoProjectRevisionStore } from '../../../stores/tempoProjectRevisionStore';
import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../../useCases/getTransportHandlers';
import { setTempo } from '../../../useCases/setTempo';
import { updateTransportState } from '../../../useCases/transportQueries/updateTransportState';

function reset_dirty_state(): void {
    const project = projectStore.value;
    if (!project) {
        throw new Error('Expected initialized project');
    }
    projectStore.set({ ...project, dirty: false });
}

describe('setTempo project dirty integration', () => {
    let disposeDirtyTracking: (() => void) | undefined;
    let initialTempoRevision: number | null;

    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('set tempo project dirty integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
            dirty: false,
        });
        transportStore.set({ ...defaultTransportState, tempo: 120, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
        flushAutomergeStorageWrites();
        initialTempoRevision = tempoProjectRevisionStore.value;
        disposeDirtyTracking = initProjectDirtyTracking();
    });

    afterEach(() => {
        disposeDirtyTracking?.();
        commandBatchPreflightPort.setProvider(null);
        commandBatchPreviewPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        clearUndoHistory();
        clearHandlerRegistry();
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('keeps the initialized project clean when the requested base tempo is already current', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });

        expect(transportStore.value?.tempo).toBe(120);
        expect(projectStore.value?.dirty).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
    });

    it('commits a base-tempo edit, one targeted inverse, and dirty state through undo and redo', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 133 } });

        expect(transportStore.value?.tempo).toBe(133);
        expect(getCrdtDoc('root')).toMatchObject({ transport: { tempo: 133 } });
        expect(projectStore.value?.dirty).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Set tempo');
        expect(tempoProjectRevisionStore.value).toBe((initialTempoRevision ?? 0) + 1);

        tempoMapStore.set({ changes: [{ id: 'later-change', beat: 12, tempo: 96, curve: 'instant' }] });
        reset_dirty_state();
        await undo();
        expect(transportStore.value?.tempo).toBe(120);
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(96);
        expect(projectStore.value?.dirty).toBe(true);

        reset_dirty_state();
        await redo();
        expect(transportStore.value?.tempo).toBe(133);
        expect(tempoMapStore.value?.changes).toEqual([{ id: 'later-change', beat: 12, tempo: 96, curve: 'instant' }]);
        expect(projectStore.value?.dirty).toBe(true);
    });

    it('commits a named tempo-map edit and keeps its inverse targeted through undo and redo', async () => {
        tempoMapStore.set({ changes: [{ id: 'tempo-0', beat: 0, tempo: 96, curve: 'instant' }] });

        await executeAppAction({ type: 'setTempo', payload: { bpm: 133, tempoChangeId: 'tempo-0' } });

        expect(tempoMapStore.value?.changes).toEqual([{ id: 'tempo-0', beat: 0, tempo: 133, curve: 'instant' }]);
        expect(projectStore.value?.dirty).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Set tempo');

        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 133, curve: 'instant' },
                { id: 'later-change', beat: 12, tempo: 144, curve: 'instant' },
            ],
        });
        transportStore.set({ ...transportStore.value!, playheadPosition: 12 });
        reset_dirty_state();
        await undo();
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(96);
        expect(tempoMapStore.value?.changes[1]?.tempo).toBe(144);
        expect(projectStore.value?.dirty).toBe(true);

        reset_dirty_state();
        await redo();
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(133);
        expect(tempoMapStore.value?.changes[1]).toEqual({ id: 'later-change', beat: 12, tempo: 144, curve: 'instant' });
        expect(projectStore.value?.dirty).toBe(true);
    });

    it('emits no committed notification for a missing tempo target', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 133, tempoChangeId: 'missing' } });

        expect(transportStore.value?.tempo).toBe(120);
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('keeps a refused ramp edit clean without publishing a committed notification', async () => {
        const changes = [
            { id: 'ramp-start', beat: 0, tempo: 100, curve: 'linear' as const },
            { id: 'ramp-end', beat: 8, tempo: 140, curve: 'instant' as const },
        ];
        tempoMapStore.set({ changes });
        updateTransportState({ playheadPosition: 4 });

        await expect(executeAppAction({ type: 'setTempo', payload: { bpm: 133 } })).rejects.toThrow(/tempo ramp/i);

        expect(tempoMapStore.value?.changes).toEqual(changes);
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('keeps a conflicting guarded edit clean without publishing a committed notification', async () => {
        await expect(
            executeAppAction({ type: 'setTempo', payload: { bpm: 133, expectedBpm: 110, tempoChangeId: null } })
        ).rejects.toThrow(/conflict/i);

        expect(transportStore.value?.tempo).toBe(120);
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('does not report hydration or runtime transport writes as committed tempo edits', () => {
        setTempo({ bpm: 105 });
        updateTransportState({ isPlaying: true, playheadPosition: 12 });

        expect(transportStore.value).toMatchObject({ tempo: 105, isPlaying: true, playheadPosition: 12 });
        expect(projectStore.value?.dirty).toBe(false);
        expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('suppresses dirty state while loading even when a committed tempo notification arrives', async () => {
        projectStore.set({ ...projectStore.value!, loading: true });

        await executeAppAction({ type: 'setTempo', payload: { bpm: 133 } });

        expect(transportStore.value?.tempo).toBe(133);
        expect(tempoProjectRevisionStore.value).toBe((initialTempoRevision ?? 0) + 1);
        expect(projectStore.value?.dirty).toBe(false);
        projectStore.set({ ...projectStore.value!, loading: false });
        expect(projectStore.value?.dirty).toBe(false);
    });

    it('previews the real tempo command without a live dirty or commit notification', async () => {
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'tempo-preview',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 133 } },
            availableDeviceVersions: {},
            expectedEffect: 'Tempo becomes 133 BPM.',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Preview a tempo edit.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'tempo-preview-batch',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview tempo edit',
            mode: 'preview',
            projectId: 'tempo-preview',
            runId: 'tempo-preview-run',
        });
        const preview = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });
        expect(preview).toMatchObject({ status: 'previewed', projectDocument: { transport: { tempo: 133 } } });
        if (preview.status !== 'previewed') {
            throw new Error('Expected an isolated tempo preview');
        }
        try {
            expect(transportStore.value?.tempo).toBe(120);
            expect(getCrdtDoc('root')).toMatchObject({ transport: { tempo: 120 } });
            expect(projectStore.value?.dirty).toBe(false);
            expect(tempoProjectRevisionStore.value).toBe(initialTempoRevision);
            expect(undoStore.value?.past).toHaveLength(0);
        } finally {
            preview.resource.release();
        }
    });
});
