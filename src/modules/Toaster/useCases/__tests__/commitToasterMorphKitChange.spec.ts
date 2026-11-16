import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { AutomergeStorageWriteConflictError } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { productionBriefAdmissionPort } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { getSettledProjectIdentity } from '#/modules/Project/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createDefaultKit } from '../../models/ToasterKit';
import { toToasterKitState } from '../../models/ToasterKitState';
import { defaultToasterState, toasterStore } from '../../stores/toasterStore';
import { copyMorphTargetPattern } from '../copyMorphTargetPattern';
import { initToasterKitPersistence } from '../initToasterKitPersistence';
import { setMorphPosition } from '../setMorphPosition/setMorphPosition';
import { toggleMorph } from '../setMorphPosition/toggleMorph';
import { toasterRefusalEpisodes } from '../toasterRefusalEpisodes';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));
vi.mock('#/infra/logger/appLogger', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/infra/logger/appLogger')>();
    return { ...original, logger: { ...original.logger, error: vi.fn() } };
});
vi.mock('#/modules/Project/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/stores')>()),
    getSettledProjectIdentity: vi.fn(() => ({ projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa' })),
}));

const DEVICE_ID = 'toaster-1';

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

const lock = () =>
    agentProjectRepairStateStore.set({
        audioGraphValid: false,
        detectedRevision: 'revision-1',
        inspectionAvailable: true,
        projectInvariantsValid: false,
        rawProjectRetained: true,
        repairCandidates: [],
        status: 'repair-required',
    });
const unlock = () => agentProjectRepairStateStore.set(null);
const morph = () => toasterStore.value?.[DEVICE_ID]?.kit.morph;
const documentKitData = () => trackStore.value?.tracks[0]?.devices[0]?.deviceState?.data;
const sessionKitData = () => {
    const kit = toasterStore.value?.[DEVICE_ID]?.kit;
    if (!kit) {
        throw new Error('Toaster fixture is absent');
    }
    return toToasterKitState(kit).data;
};

describe('commitToasterMorphKitChange on a refused project', () => {
    let stopPersistence: () => void;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.mocked(getSettledProjectIdentity).mockReturnValue({ projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa' });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        trackStore.set({ ...defaultTrackState, tracks: makeToasterTracks() });
        toasterStore.set({ [DEVICE_ID]: { ...defaultToasterState, kit: createDefaultKit() } });
        stopPersistence = initToasterKitPersistence();
        // A target pattern while the project still admits writes.
        await copyMorphTargetPattern(DEVICE_ID);
        lock();
    });

    afterEach(() => {
        // Leave the module-level episodes empty for the next case.
        toasterStore.set({});
        stopPersistence();
        toasterRefusalEpisodes.endAll();
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        unlock();
    });

    it('tells the user once across several morph changes on one device and keeps each one in the session kit', async () => {
        expect(await setMorphPosition(DEVICE_ID, 0.25)).toBe(false);
        expect(await setMorphPosition(DEVICE_ID, 0.5)).toBe(false);
        expect(await toggleMorph(DEVICE_ID)).toBe(false);

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toBe('warning');
        expect(morph()).toMatchObject({ position: 0.5, enabled: true });
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('keeps applying morph changes issued back to back without awaiting each one', async () => {
        await Promise.all([setMorphPosition(DEVICE_ID, 0.25), setMorphPosition(DEVICE_ID, 0.5)]);

        expect(morph()?.position).toBe(0.5);
        expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it('writes the morphed session kit to the document once the project is unlocked', async () => {
        await setMorphPosition(DEVICE_ID, 0.25);
        await setMorphPosition(DEVICE_ID, 0.5);
        expect(documentKitData()).not.toEqual(sessionKitData());

        unlock();

        await vi.waitFor(() => expect(documentKitData()).toEqual(sessionKitData()));
        expect(morph()?.position).toBe(0.5);
        expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite a session kit that was replaced while the refused morph was in flight', async () => {
        unlock();
        let replacement: ReturnType<typeof createDefaultKit> | null = null;
        productionBriefAdmissionPort.setGuard(() => {
            const current = toasterStore.value?.[DEVICE_ID];
            if (current && !replacement) {
                replacement = { ...current.kit, swing: 0.4 };
                toasterStore.set({ [DEVICE_ID]: { ...current, kit: replacement } });
            }
            return { allowsCurrent: () => false };
        });

        expect(await setMorphPosition(DEVICE_ID, 0.5)).toBe(false);

        expect(replacement).not.toBeNull();
        expect(toasterStore.value?.[DEVICE_ID]?.kit).toBe(replacement);
    });

    it('does not log a stale-authority conflict, which the commit guard raises by design', async () => {
        unlock();
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        let changedKit = false;
        registerHandlerMap({
            ...handlers,
            setDeviceState: {
                ...handlers.setDeviceState,
                // Runs after the shouldExecute check and before authorizeFirstHandler.
                materializeCommandArgumentsAt: 'execution',
                materializeCommandArguments: () => {
                    const current = toasterStore.value?.[DEVICE_ID];
                    if (current && !changedKit) {
                        changedKit = true;
                        toasterStore.set({ [DEVICE_ID]: { ...current, kit: { ...current.kit, swing: 0.1 } } });
                    }
                },
            },
        });

        expect(await setMorphPosition(DEVICE_ID, 0.5)).toBe(false);

        expect(logger.error).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('logs a storage write conflict that drops the morph, which is not the guard abort', async () => {
        unlock();
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        registerHandlerMap({
            ...handlers,
            setDeviceState: {
                ...handlers.setDeviceState,
                // A peer write lands between the morph's checks and its storage write.
                execute: () => {
                    throw new AutomergeStorageWriteConflictError('peer write landed first');
                },
            },
        });

        expect(await setMorphPosition(DEVICE_ID, 0.5)).toBe(false);

        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Toaster morph commit failed' }));
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('commits a morph change after the project is unlocked', async () => {
        await setMorphPosition(DEVICE_ID, 0.25);
        unlock();

        expect(await setMorphPosition(DEVICE_ID, 0.75)).toBe(true);
        expect(morph()?.position).toBe(0.75);
    });

    it('logs a failure that is not an admission refusal and does not tell the user', async () => {
        unlock();
        clearHandlerRegistry();

        expect(await setMorphPosition(DEVICE_ID, 0.5)).toBe(false);

        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Toaster morph commit failed' }));
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
