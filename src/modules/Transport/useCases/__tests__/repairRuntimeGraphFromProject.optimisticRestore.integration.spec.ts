import { clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initInputMonitoringProjectAccess } from '#/app/initInputMonitoringProjectAccess';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, restoreTrackSnapshot } from '#/modules/Arrangement/useCases';
import {
    audioEngine,
    configureInputMonitoringProjectAccess,
    startInputMonitoring,
    stopInputMonitoring,
    syncAutoInputMonitoring,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import {
    captureProjectRootIdentity,
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    removeCrdtDoc,
    replaceCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { versionControlStore } from '#/modules/ProjectVersioning/stores';
import { getVersionControlHandlers } from '#/modules/ProjectVersioning/useCases';

import { defaultTransportState, transportStore } from '../../stores/transportStore';
import { repairRuntimeGraphFromProject } from '../repairRuntimeGraphFromProject';

const runtime = vi.hoisted(() => ({ resetPlugins: vi.fn<() => Promise<void>>() }));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    resetExternalPluginRuntimeForGraphRebuild: runtime.resetPlugins,
}));

function gate() {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

function committedMode() {
    return sanitizeTrackSnapshot(getCrdtDoc('root')?.tracks).tracks.find((track) => track.id === 'a')?.inputMonitoring;
}

function projectedMode() {
    return trackStore.value?.tracks.find((track) => track.id === 'a')?.inputMonitoring;
}

describe('same-project graph repair during a real aborted version restore', () => {
    const originalMediaDevices = globalThis.navigator.mediaDevices;
    const originalCreatePanner = Object.getOwnPropertyDescriptor(audioEngine.context, 'createStereoPanner');
    const originalCreateSource = Object.getOwnPropertyDescriptor(audioEngine.context, 'createMediaStreamSource');
    const getUserMedia = vi.fn<() => Promise<MediaStream>>();
    const sources: Array<{
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        destinations: Set<unknown>;
    }> = [];
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const abortRestore = new Error('Version restore cancelled');
    let unsubscribe: () => void;

    async function startHeldRestore() {
        const held = gate();
        const handlers = getVersionControlHandlers();
        clearHandlerRegistry();
        registerHandlerMap({
            restoreProjectVersion: {
                ...handlers.restoreProjectVersion,
                previewExecution: undefined,
                execute: async (action, context) => {
                    // The real handler writes synchronously before its promise returns.
                    await handlers.restoreProjectVersion.execute(action, context);
                    await held.promise;
                    throw abortRestore;
                },
            },
        });
        const command = executeAppAction({ type: 'restoreProjectVersion', payload: { versionId: 'off-version' } });
        const outcome = command.then(
            () => null,
            (error: unknown) => error
        );
        await vi.waitFor(() => expect(projectedMode()).toBe('off'));
        return {
            abort: async () => {
                held.open();
                expect(await outcome).toBe(abortRestore);
            },
        };
    }

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        audioEngine.resetGraph();
        vi.clearAllMocks();
        sources.length = 0;
        stops.length = 0;
        getUserMedia.mockReset().mockImplementation(() => {
            const stop = vi.fn();
            stops.push(stop);
            return Promise.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
        });
        Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
        Object.defineProperty(audioEngine.context, 'createStereoPanner', {
            configurable: true,
            value: () => {
                const node = audioEngine.context.createGain();
                return { connect: node.connect, disconnect: node.disconnect, pan: node.gain };
            },
        });
        Object.defineProperty(audioEngine.context, 'createMediaStreamSource', {
            configurable: true,
            value: () => {
                const destinations = new Set<unknown>();
                const source = {
                    connect: vi.fn((destination: unknown) => destinations.add(destination)),
                    disconnect: vi.fn((destination?: unknown) =>
                        destination === undefined ? destinations.clear() : destinations.delete(destination)
                    ),
                    destinations,
                };
                sources.push(source);
                return source;
            },
        });
        const WorkletNode = globalThis.AudioWorkletNode;
        vi.stubGlobal(
            'AudioWorkletNode',
            class extends WorkletNode {
                constructor(...args: ConstructorParameters<typeof WorkletNode>) {
                    super(...args);
                    this.port.close = vi.fn();
                }
            }
        );
        runtime.resetPlugins.mockReset().mockResolvedValue(undefined);
        createCrdtDoc('root');
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc(id),
            getSemanticMessage: () => undefined,
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            mutateDoc: ({ docId, changeFn, message, snapshotTransaction, changedKeys }) => {
                mutateCrdtDoc({ id: docId, changeFn, message, snapshotTransaction, localSlots: changedKeys });
            },
        });
        const track = {
            ...createTrack({ id: 'a', name: 'Audio A', kind: 'audio', withoutDefaultDevice: true }),
            inputMonitoring: 'on' as const,
        };
        restoreTrackSnapshot({ tracks: [track], selectedTrackId: null });
        projectStore.set({
            ...defaultProjectStoreState,
            projectId: '85032d49-8520-4293-89f3-b355b0b1df3c',
            initialized: true,
            loading: false,
            identityMigrationPending: false,
            identityPersistencePending: false,
        });
        flushAutomergeStorageWrites();
        transportStore.set(defaultTransportState);
        versionControlStore.set({
            versions: [
                {
                    id: 'off-version',
                    label: 'Off',
                    createdAt: '2026-10-21T00:00:00Z',
                    parentId: null,
                    description: '',
                    tags: [],
                    snapshot: {
                        ownerProjectId: '85032d49-8520-4293-89f3-b355b0b1df3c',
                        data: JSON.stringify({
                            tracks: { tracks: [{ ...track, inputMonitoring: 'off' }], selectedTrackId: null },
                        }),
                        size: 1,
                    },
                },
            ],
            branches: [],
            currentBranchId: 'main',
            currentVersionId: null,
            autoSaveInterval: 0,
        });
        clearUndoHistory();
        initInputMonitoringProjectAccess();
        unsubscribe = syncAutoInputMonitoring();
    });

    afterEach(() => {
        unsubscribe();
        configureInputMonitoringProjectAccess(null);
        stopInputMonitoring();
        audioEngine.resetGraph();
        clearHandlerRegistry();
        clearUndoHistory();
        restoreTrackSnapshot({ tracks: [], selectedTrackId: null });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
        if (originalCreatePanner) {
            Object.defineProperty(audioEngine.context, 'createStereoPanner', originalCreatePanner);
        } else {
            Reflect.deleteProperty(audioEngine.context, 'createStereoPanner');
        }
        if (originalCreateSource) {
            Object.defineProperty(audioEngine.context, 'createMediaStreamSource', originalCreateSource);
        } else {
            Reflect.deleteProperty(audioEngine.context, 'createMediaStreamSource');
        }
    });

    it.each(['before repair', 'during plugin reset'] as const)(
        'rearms committed On when Off is projected %s and then aborted',
        async (ordering) => {
            expect(await startInputMonitoring('a', null)).toBe(true);
            const initialGain = audioEngine.getTrackStrip('a')?.gainNode;
            expect(initialGain).toBeDefined();
            expect(sources[0]?.destinations.has(initialGain)).toBe(true);
            const rootIdentity = captureProjectRootIdentity();
            const reset = gate();
            runtime.resetPlugins.mockReturnValueOnce(reset.promise);
            const restore = ordering === 'before repair' ? await startHeldRestore() : undefined;
            const repair = repairRuntimeGraphFromProject();
            expect(runtime.resetPlugins).toHaveBeenCalledOnce();
            const duringRestore = restore ?? (await startHeldRestore());
            expect({ committed: committedMode(), projected: projectedMode() }).toEqual({
                committed: 'on',
                projected: 'off',
            });
            reset.open();
            await repair;
            await duringRestore.abort();
            expect(captureProjectRootIdentity()).toBe(rootIdentity);
            expect({ committed: committedMode(), projected: projectedMode() }).toEqual({
                committed: 'on',
                projected: 'on',
            });
            expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
            const rebuiltGain = audioEngine.getTrackStrip('a')?.gainNode;
            expect(rebuiltGain).toBeDefined();
            expect(rebuiltGain).not.toBe(initialGain);
            expect(stops[0]).toHaveBeenCalledOnce();
            await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
            await vi.waitFor(() => expect(sources[1]?.destinations.has(rebuiltGain)).toBe(true));
            expect(sources[1]?.destinations.has(initialGain)).toBe(false);
            expect(stops[1]).not.toHaveBeenCalled();
        }
    );
    it('does not reopen a monitor whose Off version commits during plugin reset', async () => {
        expect(await startInputMonitoring('a', null)).toBe(true);
        const originalRoot = getCrdtDoc('root');
        const rootIdentity = captureProjectRootIdentity();
        const reset = gate();
        runtime.resetPlugins.mockReturnValueOnce(reset.promise);
        const repair = repairRuntimeGraphFromProject();
        clearHandlerRegistry();
        registerHandlerMap(getVersionControlHandlers());
        await executeAppAction({ type: 'restoreProjectVersion', payload: { versionId: 'off-version' } });
        expect(getCrdtDoc('root')).not.toBe(originalRoot);
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect({ committed: committedMode(), projected: projectedMode() }).toEqual({
            committed: 'off',
            projected: 'off',
        });
        reset.open();
        await repair;
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(stops[0]).toHaveBeenCalledOnce();
        expect(sources[0]?.destinations.size).toBe(0);
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
    });

    it('does not reset or rearm the replacement root after an outgoing plugin reset', async () => {
        expect(await startInputMonitoring('a', null)).toBe(true);
        const rootIdentity = captureProjectRootIdentity();
        const reset = gate();
        runtime.resetPlugins.mockReturnValueOnce(reset.promise);
        const repair = repairRuntimeGraphFromProject();
        const document = getCrdtDoc('root');
        if (!document) {
            throw new Error('Expected outgoing project');
        }
        audioEngine.resetGraph();
        replaceCrdtDoc({ id: 'root', doc: clone(document) });
        expect(captureProjectRootIdentity()).not.toBe(rootIdentity);
        const successorStrip = audioEngine.ensureTrackStrip('a');
        const resetGraph = vi.spyOn(audioEngine, 'resetGraph');
        reset.open();
        await repair;
        expect(resetGraph).not.toHaveBeenCalled();
        expect(audioEngine.getTrackStrip('a')).toBe(successorStrip);
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(sources).toHaveLength(1);
        expect(stops[0]).toHaveBeenCalledOnce();
        expect(sources[0]?.destinations.size).toBe(0);
    });

    it('settles repair and aborted history while rearm permission remains pending and then refuses', async () => {
        expect(await startInputMonitoring('a', null)).toBe(true);
        let refuse!: (reason: Error) => void;
        const refusedRequest = new Promise<MediaStream>((_resolve, reject) => {
            refuse = reject;
        });
        getUserMedia.mockReturnValueOnce(refusedRequest);
        const restore = await startHeldRestore();
        await repairRuntimeGraphFromProject();
        await restore.abort();
        expect({ committed: committedMode(), projected: projectedMode() }).toEqual({
            committed: 'on',
            projected: 'on',
        });
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        refuse(new Error('NotAllowedError'));
        await expect(refusedRequest).rejects.toThrow('NotAllowedError');
        expect(stops[0]).toHaveBeenCalledOnce();
        expect(sources).toHaveLength(1);
        // A later real Command restore still commits after the refusal.
        clearHandlerRegistry();
        registerHandlerMap(getVersionControlHandlers());
        await executeAppAction({ type: 'restoreProjectVersion', payload: { versionId: 'off-version' } });
        expect({ committed: committedMode(), projected: projectedMode() }).toEqual({
            committed: 'off',
            projected: 'off',
        });
        expect(getUserMedia).toHaveBeenCalledTimes(2);
    });

    it('keeps committed On admission when another Command changes the same root during plugin reset', async () => {
        expect(await startInputMonitoring('a', null)).toBe(true);
        const originalRoot = getCrdtDoc('root');
        const rootIdentity = captureProjectRootIdentity();
        const reset = gate();
        runtime.resetPlugins.mockReturnValueOnce(reset.promise);
        const repair = repairRuntimeGraphFromProject();
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        registerHandlerMap({ setTrackGain: handlers.setTrackGain });
        const expectedGain = trackStore.value?.tracks[0]?.gain;
        if (expectedGain === undefined) {
            throw new Error('Expected the monitored track gain');
        }
        await executeAppAction({
            type: 'setTrackGain',
            payload: { trackId: 'a', gain: 0.37, expectedGain, automationRecordingPolicy: 'suppressed' },
        });
        expect(getCrdtDoc('root')).not.toBe(originalRoot);
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        reset.open();
        await repair;
        const rebuiltGain = audioEngine.getTrackStrip('a')?.gainNode;
        expect(rebuiltGain).toBeDefined();
        await vi.waitFor(() => expect(sources[1]?.destinations.has(rebuiltGain)).toBe(true));
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect({ committed: committedMode(), projected: projectedMode() }).toEqual({
            committed: 'on',
            projected: 'on',
        });
        expect(sanitizeTrackSnapshot(getCrdtDoc('root')?.tracks).tracks[0]?.gain).toBe(0.37);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });
});
