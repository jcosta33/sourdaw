import { toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    getCrdtDoc,
    getCrdtDocIds,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getSettledProjectId, projectStore } from '#/modules/Project/stores';
import {
    applyImportedProjectData,
    buildProjectData,
    newProject,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { createDefaultState } from '../../../models/ProjectVersion';
import { versionControlStore } from '../../../stores/versionControlStore';
import { getVersionControlHandlers } from '../../getVersionControlHandlers';
import { switchBranch } from '../branching/switchBranch';

const runtimeIo = vi.hoisted(() => ({
    clearRuntimeCachedAudioBuffers: vi.fn(),
    compactProject: vi.fn(() => Promise.resolve()),
    importCachedAudioBuffers: vi.fn(() => Promise.resolve({ persist: () => Promise.resolve(true), publish: () => 0 })),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: () => undefined, publish: () => 0 })),
    resetAudioGraph: vi.fn(),
    setMasterGainValue: vi.fn(),
    startCrdtAutoSave: vi.fn(() => () => undefined),
    unloadPlugin: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        clearRuntimeCachedAudioBuffers: runtimeIo.clearRuntimeCachedAudioBuffers,
        importCachedAudioBuffers: runtimeIo.importCachedAudioBuffers,
        prepareCachedAudioBuffersFromIdb: runtimeIo.prepareCachedAudioBuffersFromIdb,
        resetAudioGraph: runtimeIo.resetAudioGraph,
        setMasterGainValue: runtimeIo.setMasterGainValue,
    };
});

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return {
        ...actual,
        compactProject: runtimeIo.compactProject,
        startCrdtAutoSave: runtimeIo.startCrdtAutoSave,
    };
});

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return { ...actual, unloadPlugin: runtimeIo.unloadPlugin };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        ensureTrackStrips: vi.fn(),
        stopPlayback: vi.fn(() => Promise.resolve()),
    };
});

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type ProjectSurface = {
    documents: Array<{ content: Record<string, unknown>; docId: string }>;
    identity: typeof projectStore.value;
    projection: {
        automation: typeof automationStore.value;
        markers: typeof markerStore.value;
        midi: typeof midiStore.value;
        tracks: typeof trackStore.value;
        transport: typeof transportStore.value;
    };
    revision: string;
    selection: {
        currentBranchId: string;
        currentVersionId: string | null;
    };
};

let notificationBus = createEventBus<NotificationEvents>();
let notifications: NotifyPayload[] = [];
let unsubscribeNotifications: () => void = () => undefined;

async function activateProject(name: string): Promise<string> {
    expect(await newProject(name)).toBe(true);
    flushAutomergeStorageWrites();
    const projectId = getSettledProjectId();
    if (!projectId) {
        throw new Error(`expected ${name} to publish a settled project identity`);
    }
    return projectId;
}

async function seedProject(stem: string, pitch: number): Promise<void> {
    const trackId = `track-${stem}`;
    const clipId = `clip-${stem}`;
    const actionOptions = { skipMacroRecording: true, skipUndo: true } as const;

    await executeAppAction(
        {
            type: 'addTrack',
            payload: { id: trackId, name: `${stem} track`, kind: 'midi', withoutDefaultDevice: true },
        },
        actionOptions
    );
    await executeAppAction(
        {
            type: 'addClip',
            payload: { id: clipId, trackId, name: `${stem} clip`, startBeat: 1, endBeat: 5, type: 'midi' },
        },
        actionOptions
    );
    await executeAppAction(
        {
            type: 'addMarker',
            payload: { markerId: `marker-${stem}`, beat: 3, name: `${stem} marker`, color: '#336699' },
        },
        actionOptions
    );
    await executeAppAction(
        {
            type: 'addNotes',
            payload: {
                clipId,
                notes: [{ id: `note-${stem}`, pitch, startBeat: 1.5, duration: 1, velocity: 96 }],
            },
        },
        actionOptions
    );
    flushAutomergeStorageWrites();
}

async function createCheckpoint(label: string): Promise<string> {
    await executeAppAction(
        { type: 'createProjectVersion', payload: { label } },
        { skipMacroRecording: true, skipUndo: true }
    );
    const versionId = versionControlStore.value?.currentVersionId;
    if (!versionId) {
        throw new Error(`expected checkpoint ${label} to be created`);
    }
    return versionId;
}

async function createBranch(name: string): Promise<string> {
    await executeAppAction(
        { type: 'createVersionBranch', payload: { name } },
        { skipMacroRecording: true, skipUndo: true }
    );
    const branchId = versionControlStore.value?.currentBranchId;
    if (!branchId) {
        throw new Error(`expected branch ${name} to be created`);
    }
    return branchId;
}

function captureProjectSurface(): ProjectSurface {
    flushAutomergeStorageWrites();
    const catalog = versionControlStore.value;
    if (!catalog) {
        throw new Error('expected a live version-control catalog');
    }
    return {
        documents: getCrdtDocIds()
            .toSorted()
            .map((docId) => {
                const document = getCrdtDoc<Record<string, unknown>>(docId);
                if (!document) {
                    throw new Error(`expected CRDT document ${docId} to exist`);
                }
                return { content: structuredClone(toJS(document)), docId };
            }),
        identity: structuredClone(projectStore.value),
        projection: {
            automation: structuredClone(automationStore.value),
            markers: structuredClone(markerStore.value),
            midi: structuredClone(midiStore.value),
            tracks: structuredClone(trackStore.value),
            transport: structuredClone(transportStore.value),
        },
        revision: captureProjectRevision(),
        selection: {
            currentBranchId: catalog.currentBranchId,
            currentVersionId: catalog.currentVersionId,
        },
    };
}

async function dispatchRestore(versionId: string): Promise<{
    committed: ReturnType<typeof vi.fn>;
    rejectionName: string | undefined;
}> {
    const committed = vi.fn();
    let rejectionName: string | undefined;
    try {
        await executeAppAction(
            { type: 'restoreProjectVersion', payload: { versionId } },
            { onCommitted: committed, skipMacroRecording: true, skipUndo: true }
        );
    } catch (error) {
        rejectionName = error instanceof Error ? error.name : String(error);
    }
    await notificationBus.waitForIdle();
    return { committed, rejectionName };
}

function expectRefusedRestore(
    outcome: Awaited<ReturnType<typeof dispatchRestore>>,
    before: ProjectSurface,
    after: ProjectSurface
): void {
    expect.soft([undefined, 'AppActionConflictError']).toContain(outcome.rejectionName);
    expect.soft(outcome.committed).not.toHaveBeenCalled();
    expect.soft(notifications).toEqual([expect.objectContaining({ level: 'error' })]);
    expect.soft(after.revision).toBe(before.revision);
    expect.soft(after.documents).toEqual(before.documents);
    expect.soft(after.identity).toEqual(before.identity);
    expect.soft(after.projection).toEqual(before.projection);
    expect.soft(after.selection).toEqual(before.selection);
}

describe('checkpoint project isolation', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getMidiNoteTransformHandlers());
        registerHandlerMap(getVersionControlHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        localStorage.clear();
        versionControlStore.set(createDefaultState());
        notifications = [];
        notificationBus = createEventBus<NotificationEvents>();
        unsubscribeNotifications = notificationBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationBus);
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    afterEach(() => {
        unsubscribeNotifications();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        versionControlStore.set(createDefaultState());
        resetCrdtProjectAuthority('checkpoint project isolation cleanup');
        configureAutomergeStoragePort(null);
        Container.clear();
        vi.clearAllMocks();
    });

    it('refuses an A checkpoint through the registered action after creating project B', async () => {
        const projectAId = await activateProject('Project A');
        await seedProject('a', 60);
        const versionAId = await createCheckpoint('Project A checkpoint');

        const projectBId = await activateProject('Project B');
        await seedProject('b', 72);
        await createCheckpoint('Project B checkpoint');
        const before = captureProjectSurface();
        expect(projectBId).not.toBe(projectAId);
        expect(before.identity?.projectId).toBe(projectBId);
        expect(before.projection.tracks?.tracks.some((track) => track.id === 'track-b')).toBe(true);

        const outcome = await dispatchRestore(versionAId);
        const after = captureProjectSurface();

        expectRefusedRestore(outcome, before, after);
    });

    it('refuses an A checkpoint through the registered action after replacing A with imported project B', async () => {
        const importedProjectBId = await activateProject('Imported Project B');
        await seedProject('imported-b', 79);
        const builtProjectB = await buildProjectData();
        if (!builtProjectB) {
            throw new Error('expected a complete imported-project fixture');
        }

        const projectAId = await activateProject('Project A before import');
        await seedProject('import-source-a', 55);
        const versionAId = await createCheckpoint('Project A checkpoint before import');
        expect(await applyImportedProjectData({ data: builtProjectB.data })).toBe(true);
        await createCheckpoint('Imported Project B checkpoint');
        const before = captureProjectSurface();
        expect(importedProjectBId).not.toBe(projectAId);
        expect(before.identity?.projectId).toBe(importedProjectBId);
        expect(before.projection.tracks?.tracks.some((track) => track.id === 'track-imported-b')).toBe(true);

        const outcome = await dispatchRestore(versionAId);
        const after = captureProjectSurface();

        expectRefusedRestore(outcome, before, after);
    });

    it('refuses a private branch switch whose head belongs to project A without advancing B selection', async () => {
        await activateProject('Branch Project A');
        await seedProject('branch-a', 48);
        await createCheckpoint('Branch A checkpoint');
        const branchAId = await createBranch('Branch A');

        await activateProject('Branch Project B');
        await createBranch('Branch B');
        await seedProject('branch-b', 84);
        await createCheckpoint('Branch B checkpoint');
        const before = captureProjectSurface();
        expect(before.projection.tracks?.tracks.some((track) => track.id === 'track-branch-b')).toBe(true);

        expect(switchBranch(branchAId)).toBe(false);
        const after = captureProjectSurface();

        expect.soft(after.revision).toBe(before.revision);
        expect.soft(after.documents).toEqual(before.documents);
        expect.soft(after.identity).toEqual(before.identity);
        expect.soft(after.projection).toEqual(before.projection);
        expect.soft(after.selection).toEqual(before.selection);
    });

    it('still restores a checkpoint captured by the active project', async () => {
        await activateProject('Same Project');
        await seedProject('same-project', 67);
        const versionId = await createCheckpoint('Same project checkpoint');
        const checkpointProjection = captureProjectSurface().projection;
        await seedProject('later-edit', 91);
        expect(trackStore.value?.tracks.some((track) => track.id === 'track-later-edit')).toBe(true);

        const outcome = await dispatchRestore(versionId);
        const restored = captureProjectSurface();

        expect(outcome.rejectionName).toBeUndefined();
        expect(outcome.committed).toHaveBeenCalledOnce();
        expect(notifications).toEqual([]);
        expect(restored.projection).toEqual(checkpointProjection);
        expect(restored.selection.currentVersionId).toBe(versionId);
    });

    it('creates an owned checkpoint while the initialized project identity is awaiting persistence', async () => {
        runtimeIo.compactProject.mockRejectedValueOnce(new Error('initial persistence unavailable'));
        const projectId = await activateProject('Pending Persistence Project');
        expect(projectStore.value).toMatchObject({
            identityPersistencePending: true,
            initialized: true,
            loading: false,
            projectId,
        });
        const committed = vi.fn();

        await executeAppAction(
            { type: 'createProjectVersion', payload: { label: 'In-session checkpoint' } },
            { onCommitted: committed, skipMacroRecording: true, skipUndo: true }
        );
        await notificationBus.waitForIdle();

        expect(committed).toHaveBeenCalledOnce();
        expect(notifications).toEqual([]);
        expect(versionControlStore.value?.versions).toHaveLength(1);
        expect(versionControlStore.value?.versions[0]?.snapshot.ownerProjectId).toBe(projectId);
    });
});
