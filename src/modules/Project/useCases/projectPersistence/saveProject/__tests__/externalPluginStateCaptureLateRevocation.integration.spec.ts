import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authorityToken = Object.freeze({ generation: 'late-revocation' });
const mocks = vi.hoisted(() => ({
    batchResult: null as { status: string } | null,
    clearRestoreFailure: vi.fn<(instanceId: string) => void>(),
    restorePluginState: vi.fn<(instanceId: string, stateChunk: string) => Promise<void>>(),
    notifyUser: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        clearExternalPluginRestoreFailure: mocks.clearRestoreFailure,
        hasUnresolvedExternalPluginRestoreFailure: () => false,
        readExternalPluginStateForCapture: () =>
            Promise.resolve({
                status: 'captured' as const,
                stateChunk: 'fresh-host-chunk',
                authorityToken,
                isCurrent: () => true,
            }),
        restorePluginState: mocks.restorePluginState,
        shouldWarnExternalPluginRestoreFailure: () => false,
    };
});

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeAppActionBatch: async (
            ...input: Parameters<typeof actual.executeAppActionBatch>
        ): ReturnType<typeof actual.executeAppActionBatch> => {
            const result = await actual.executeAppActionBatch(...input);
            mocks.batchResult = result;
            return result;
        },
    };
});

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, normalizeTrack } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    hasCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { readYeastRack, setActiveYeastDevice, yeastStore } from '#/modules/Yeast/stores';

import { capturedNativePluginStateCache } from '../capturedNativePluginStateCache';
import { captureExternalPluginStates } from '../captureExternalPluginStates';
import { warnedExternalPluginCaptureRejections } from '../warnedExternalPluginCaptureRejections';

const TRACK_ID = 'track-capture';
const DEVICE_ID = 'external-device';
const YEAST_DEVICE_ID = 'yeast-device';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function currentExternalChunk(): string | undefined {
    return trackStore.value?.tracks[0]?.devices.find((device) => device.id === DEVICE_ID)?.externalStateChunk;
}

function seedProject(): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: [
            normalizeTrack({
                id: TRACK_ID,
                name: 'Capture',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Serum',
                        type: 'external-plugin',
                        bypassed: false,
                        parameterValues: {},
                        externalPluginId: 'serum',
                        externalInstanceId: 'instance-capture',
                        externalStateChunk: 'original-project-chunk',
                    },
                    {
                        id: YEAST_DEVICE_ID,
                        name: 'Yeast',
                        type: 'yeast',
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
            }),
        ],
        selectedTrackId: TRACK_ID,
    });
    flushAutomergeStorageWrites();
    yeastStore.set({ processors: [], uiLevel: 1 });
    flushAutomergeStorageWrites();
}

describe('external plugin capture late authority revocation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.batchResult = null;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('external plugin capture late revocation');
        if (hasCrdtDoc('root')) {
            removeCrdtDoc('root');
        }
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        capturedNativePluginStateCache.clear();
        warnedExternalPluginCaptureRejections.clear();
        setActiveYeastDevice(null);
        seedProject();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        setActiveYeastDevice(null);
        trackStore.set(defaultTrackState);
        flushAutomergeStorageWrites();
        capturedNativePluginStateCache.clear();
        warnedExternalPluginCaptureRejections.clear();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        if (hasCrdtDoc('root')) {
            removeCrdtDoc('root');
        }
        configureAutomergeStoragePort(null);
    });

    it('aborts capture bytes while retaining the foreign Yeast edit that revoked final authority', async () => {
        const revisionBeforeYeastEdit = captureProjectRevision();
        yeastStore.set({
            processors: [{ id: 'groove-new', type: 'groove', name: 'New groove', bypassed: false }],
            uiLevel: 1,
        });

        const observedChunks: (string | undefined)[] = [];
        const unsubscribe = trackStore.subscribe(() => {
            observedChunks.push(currentExternalChunk());
        });
        const first = await captureExternalPluginStates();
        unsubscribe();

        expect(mocks.batchResult?.status).toBe('failed');
        expect(first).toEqual({ rejectedPlugins: ['serum'] });
        expect(observedChunks).toContain('fresh-host-chunk');
        expect(observedChunks.at(-1)).toBe('original-project-chunk');
        expect(currentExternalChunk()).toBe('original-project-chunk');
        expect(capturedNativePluginStateCache.has('instance-capture')).toBe(false);

        const document = getCrdtDoc<{
            tracks?: { tracks?: { devices?: { id: string; externalStateChunk?: string }[] }[] };
            yeast?: {
                racks?: Record<string, { processors?: Record<string, { value?: { id?: string } }> }>;
            };
        }>('root');
        const persistedExternal = document?.tracks?.tracks?.[0]?.devices?.find((device) => device.id === DEVICE_ID);
        expect(persistedExternal?.externalStateChunk).toBe('original-project-chunk');
        expect(document?.yeast?.racks?.[YEAST_DEVICE_ID]?.processors?.['groove-new']?.value?.id).toBe('groove-new');
        expect(captureProjectRevision()).not.toBe(revisionBeforeYeastEdit);
        expect(readYeastRack(YEAST_DEVICE_ID).processors.map((processor) => processor.id)).toContain('groove-new');
        expect(mocks.restorePluginState).not.toHaveBeenCalled();
        expect(mocks.clearRestoreFailure).not.toHaveBeenCalled();

        mocks.batchResult = null;
        const retry = await captureExternalPluginStates();

        expect(retry).toEqual({ rejectedPlugins: [] });
        expect(mocks.batchResult?.status).toBe('committed');
        expect(currentExternalChunk()).toBe('fresh-host-chunk');
        expect(capturedNativePluginStateCache.get('instance-capture')).toEqual({
            stateChunk: 'fresh-host-chunk',
            authorityToken,
        });
    });
});
