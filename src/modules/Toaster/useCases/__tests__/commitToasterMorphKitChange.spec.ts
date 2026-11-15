import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { getSettledProjectIdentity } from '#/modules/Project/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createDefaultKit } from '../../models/ToasterKit';
import { defaultToasterState, toasterStore } from '../../stores/toasterStore';
import { initToasterKitPersistence } from '../initToasterKitPersistence';
import { setMorphPosition } from '../setMorphPosition/setMorphPosition';
import { toggleMorph } from '../setMorphPosition/toggleMorph';
import { copyMorphTargetPattern } from '../copyMorphTargetPattern';

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
        stopPersistence();
        toasterStore.set({});
        unlock();
    });

    it('tells the user once across several morph changes on one device and keeps the session kit', async () => {
        const before = morph();
        expect(await setMorphPosition(DEVICE_ID, 0.25)).toBe(false);
        expect(await setMorphPosition(DEVICE_ID, 0.5)).toBe(false);
        expect(await toggleMorph(DEVICE_ID)).toBe(false);

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toBe('warning');
        expect(morph()).toBe(before);
        expect(logger.error).not.toHaveBeenCalled();
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
