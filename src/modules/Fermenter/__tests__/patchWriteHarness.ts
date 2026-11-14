import { vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
    trackStore,
    type Track,
} from '#/modules/Arrangement/stores';
import { clampDeviceParameterValue, createTrack, persistDevicePatch } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    setNotificationEventBus,
    type NotifyPayload,
    type ConfirmPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { DEFAULT_PATCH } from '../models/FermenterPatch';
import { toFermenterDeviceState, fromFermenterDeviceState } from '../models/FermenterPatchState';
import { fermenterStore } from '../stores/fermenterStore';
import { setFermenterDependencies } from '../useCases/fermenterDependencies';
import { fermenterPatchBatcher } from '../useCases/fermenterParamBridge/fermenterParamBatcher';
import { getFermenterHandlers } from '../useCases/getFermenterHandlers';

/** Real Command/CRDT collaborators; only the injected audio executor is doubled. */
export function createPatchWriteHarness() {
    const notices: NotifyPayload[] = [];
    const updateDevicePatch = vi.fn<NonNullable<Parameters<typeof setFermenterDependencies>[0]['updateDevicePatch']>>();
    const updateDeviceParam = vi.fn<Parameters<typeof setFermenterDependencies>[0]['updateDeviceParam']>();
    const persistPatch = vi.fn(persistDevicePatch);
    const persistParam = vi.fn(persistDeviceParam);
    const deps = () => ({
        clampDeviceParameterValue,
        persistDeviceParam: persistParam,
        persistDevicePatch: persistPatch,
        updateDeviceParam,
        updateDevicePatch,
        resolveEligibleDeviceWriteTarget,
        getAllTracks: () => trackStore.value?.tracks ?? [],
    });

    return {
        updateDevicePatch,
        updateDeviceParam,
        persistPatch,
        persistParam,
        deps,
        notices,
        async setup(): Promise<void> {
            setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
            const transition = runProjectLoadTransaction();
            if (!(await transition.prepare()) || !transition.activate()) {
                throw new Error('Expected active project fixture');
            }
            vi.useFakeTimers();
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
                window.setTimeout(() => callback(0), 16)
            );
            vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
            configureAutomergeStoragePort(null);
            resetCrdtProjectAuthority('Fermenter bridge fixture');
            removeCrdtDoc('root');
            createCrdtDoc('root');
            registerCrdtStorageRuntime();
            clearHandlerRegistry();
            registerHandlerMap(getFermenterHandlers());
            clearUndoHistory();
            projectStore.set({ ...defaultProjectStoreState, loading: false, createdAt: 100, updatedAt: 100 });
            notices.length = 0;
            const bus = createEventBus<{
                'ui.notify': NotifyPayload;
                'ui.confirm': ConfirmPayload;
                'ui.prompt': PromptPayload;
            }>();
            bus.on('ui.notify', (notice) => {
                notices.push(notice);
            });
            setNotificationEventBus(bus);
            trackStore.set({
                tracks: ['d1', 'd2'].map((id, index) => ({
                    ...createTrack({ id: `t${index + 1}`, name: id, kind: 'midi', withoutDefaultDevice: true }),
                    devices: [
                        {
                            id,
                            type: 'fermenter',
                            name: 'Fermenter',
                            bypassed: false,
                            parameterValues: {},
                            deviceState: toFermenterDeviceState(DEFAULT_PATCH),
                        },
                    ],
                })),
                selectedTrackId: 't1',
            });
            fermenterStore.set({});
            setFermenterDependencies(deps());
            flushAutomergeStorageWrites();
            updateDevicePatch.mockReset();
            updateDeviceParam.mockReset();
            persistPatch.mockClear();
            persistParam.mockClear();
        },
        teardown(): void {
            fermenterPatchBatcher.cancel('d1');
            fermenterPatchBatcher.cancel('d2');
            clearHandlerRegistry();
            vi.useRealTimers();
            vi.unstubAllGlobals();
        },
        async frame(): Promise<void> {
            await vi.advanceTimersByTimeAsync(16);
        },
        patch(deviceId = 'd1') {
            const document = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
            const device = document?.tracks.tracks
                .flatMap((track) => track.devices)
                .find((candidate) => candidate.id === deviceId);
            if (!device) {
                throw new Error('Expected committed Fermenter device');
            }
            const patch = fromFermenterDeviceState(device.deviceState);
            if (!patch) {
                throw new Error('Expected full patch in project truth');
            }
            return patch;
        },
    };
}
