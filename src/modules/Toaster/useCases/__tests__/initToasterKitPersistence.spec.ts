import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createDefaultKit } from '../../models/ToasterKit';
import { toToasterKitState } from '../../models/ToasterKitState';
import { registerToasterDevice, toasterStore, toggleStep } from '../../stores/toasterStore';
import { initToasterKitPersistence } from '../initToasterKitPersistence';
import { reconcileToasterKitsFromProject } from '../reconcileToasterKitsFromProject';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const DEVICE_ID = 'toaster-1';

/** Re-registers the handlers with a `setDeviceState` that counts the writes it executes. */
function countDeviceStateWrites(): { count: number } {
    const writes = { count: 0 };
    const handlers = getArrangementHandlers();
    clearHandlerRegistry();
    registerHandlerMap({
        ...handlers,
        setDeviceState: {
            ...handlers.setDeviceState,
            execute: (action, context) => {
                writes.count += 1;
                return handlers.setDeviceState.execute(action, context);
            },
        },
    });
    return writes;
}

/** Resolves once every microtask queued so far has run. */
const afterMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeToasterTracks() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Drums',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Toaster',
                        type: 'toaster',
                        bypassed: false,
                        parameterValues: { masterGain: 1 },
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

describe('initToasterKitPersistence on a refused project', () => {
    let stopPersistence: () => void;
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        unhandled.length = 0;
        process.on('unhandledRejection', recordUnhandled);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        trackStore.set({ ...defaultTrackState, tracks: makeToasterTracks() });
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        toasterStore.set({});
        stopPersistence = initToasterKitPersistence();
        registerToasterDevice(DEVICE_ID);
    });

    afterEach(() => {
        process.off('unhandledRejection', recordUnhandled);
        stopPersistence();
        toasterStore.set({});
        agentProjectRepairStateStore.set(null);
    });

    it('tells the user once for a sweep of kit edits and leaves no unhandled rejection', async () => {
        for (let step = 0; step < 8; step++) {
            toggleStep(DEVICE_ID, 0, step);
        }
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        // Let any rejected commit promises surface before asserting there are none.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toBe('warning');
        expect(unhandled).toEqual([]);
    });

    it('tells the user again after the device leaves the store and returns', async () => {
        toggleStep(DEVICE_ID, 0, 0);
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));

        toasterStore.set({});
        registerToasterDevice(DEVICE_ID);
        toggleStep(DEVICE_ID, 0, 1);

        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(2));
    });

    describe('when the project becomes changeable', () => {
        const lock = () =>
            agentProjectRepairStateStore.set({
                audioGraphValid: false,
                detectedRevision: 'revision-2',
                inspectionAvailable: true,
                projectInvariantsValid: false,
                rawProjectRetained: true,
                repairCandidates: [],
                status: 'repair-required',
            });
        const unlock = () => agentProjectRepairStateStore.set(null);
        const documentKitData = () => trackStore.value?.tracks[0]?.devices[0]?.deviceState?.data;
        const sessionKitData = () => {
            const kit = toasterStore.value?.[DEVICE_ID]?.kit;
            if (!kit) {
                throw new Error('Toaster fixture is absent');
            }
            return toToasterKitState(kit).data;
        };

        it('writes the refused kit once the project is unlocked, without a further edit', async () => {
            toggleStep(DEVICE_ID, 0, 1);
            await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
            expect(documentKitData()).toBeUndefined();

            unlock();

            await vi.waitFor(() => expect(documentKitData()).toEqual(sessionKitData()));
        });

        it('warns again after an unlock and relock, and writes both edits on the final unlock', async () => {
            toggleStep(DEVICE_ID, 0, 1);
            await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
            unlock();
            await vi.waitFor(() => expect(documentKitData()).toEqual(sessionKitData()));

            lock();
            toggleStep(DEVICE_ID, 0, 2);
            await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(2));
            expect(documentKitData()).not.toEqual(sessionKitData());

            unlock();
            await vi.waitFor(() => expect(documentKitData()).toEqual(sessionKitData()));
        });

        it('does not write the kit again on unlock when the session already holds the document kit', async () => {
            toggleStep(DEVICE_ID, 0, 1);
            await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
            const peerState = toToasterKitState({ ...createDefaultKit(), swing: 0.3 });
            // A peer's kit reaches the document while the project is still locked, and the
            // device reconcile loads it into the session.
            trackStore.set({
                ...defaultTrackState,
                tracks: sanitizeTrackSnapshot({
                    tracks: [
                        {
                            id: 'track-1',
                            name: 'Drums',
                            kind: 'midi',
                            devices: [
                                {
                                    id: DEVICE_ID,
                                    name: 'Toaster',
                                    type: 'toaster',
                                    bypassed: false,
                                    parameterValues: { masterGain: 1 },
                                    deviceState: peerState,
                                },
                            ],
                        },
                    ],
                    selectedTrackId: null,
                }).tracks,
            });
            reconcileToasterKitsFromProject();
            expect(sessionKitData()).toEqual(peerState.data);
            const writes = countDeviceStateWrites();

            unlock();
            await afterMicrotasks();

            expect(writes.count).toBe(0);
            expect(documentKitData()).toEqual(peerState.data);
        });

        it('writes a kit edited while locked once on unlock', async () => {
            toggleStep(DEVICE_ID, 0, 1);
            await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
            const writes = countDeviceStateWrites();

            unlock();
            await vi.waitFor(() => expect(documentKitData()).toEqual(sessionKitData()));
            await afterMicrotasks();

            expect(writes.count).toBe(1);
        });

        it('does not write a device that left the store while the project was locked', async () => {
            toggleStep(DEVICE_ID, 0, 1);
            await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
            toasterStore.set({});

            unlock();

            expect(documentKitData()).toBeUndefined();
        });
    });
});
