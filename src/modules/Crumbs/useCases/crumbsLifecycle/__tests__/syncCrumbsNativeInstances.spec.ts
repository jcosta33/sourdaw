/**
 * The native instance follows the device's presence on the project (#4204).
 *
 * Every failure here is silent at the speakers. An instance that is never
 * created leaves the mapper refusing to splice the device, so the strip falls
 * back to Web Audio with no notice. One that is never destroyed leaves the
 * engine holding a sampler for a device that is gone. And a restore that writes
 * the session store commits a document chunk, which marks a project dirty the
 * moment it is opened.
 *
 * The bridge is stubbed — it is IPC — but `crumbsStore` and the persistence
 * subscriber are real, because "the restore does not dirty the project" is a
 * claim about that subscriber and doubling it would prove nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { createCrumbsInstance } from '../../../repositories/crumbsBridge/createCrumbsInstance';
import { destroyCrumbsInstance } from '../../../repositories/crumbsBridge/destroyCrumbsInstance';
import { isCrumbsNativeAvailable } from '../../../repositories/crumbsBridge/isCrumbsNativeAvailable';
import { loadSample } from '../../../repositories/crumbsBridge/loadSample';
import { crumbsEngineAttachmentStore } from '../../../stores/crumbsEngineAttachmentStore';
import { crumbsNativeLifecycleStore } from '../../../stores/crumbsNativeLifecycleStore';
import { crumbsStore } from '../../../stores/crumbsStore';
import { padStore } from '../../../stores/padStore';
import { sliceStore } from '../../../stores/sliceStore';
import { commitCrumbsDeviceState } from '../../commitCrumbsDeviceState';
import { initCrumbsDeviceStatePersistence } from '../../initCrumbsDeviceStatePersistence';
import { syncCrumbsNativeInstances } from '../syncCrumbsNativeInstances';

import type { CrumbsLoadResult } from '../../../models/CrumbsTypes';

vi.mock('../../../repositories/crumbsBridge/createCrumbsInstance', () => ({
    createCrumbsInstance: vi.fn(async () => ({ attached: true })),
}));
vi.mock('../../../repositories/crumbsBridge/destroyCrumbsInstance', () => ({
    destroyCrumbsInstance: vi.fn(async () => undefined),
}));
vi.mock('../../../repositories/crumbsBridge/isCrumbsNativeAvailable', () => ({
    isCrumbsNativeAvailable: vi.fn(() => true),
}));
vi.mock('../../../repositories/crumbsBridge/loadSample', () => ({
    loadSample: vi.fn(),
}));
vi.mock('../../commitCrumbsDeviceState', () => ({
    commitCrumbsDeviceState: vi.fn(),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const createMock = vi.mocked(createCrumbsInstance);
const destroyMock = vi.mocked(destroyCrumbsInstance);
const nativeAvailableMock = vi.mocked(isCrumbsNativeAvailable);
const loadSampleMock = vi.mocked(loadSample);
const commitMock = vi.mocked(commitCrumbsDeviceState);

const DEVICE = 'd-crumbs';
const SAVED_PATH = '/loops/break.wav';

/**
 * What `load_sample` answers. The sample id is the fresh instance's own
 * counter's, deliberately unlike the saved one, because the restore writing it
 * back is the failure this file is here to catch.
 */
function loadedSample(): CrumbsLoadResult {
    return {
        sampleId: 7,
        sampleRate: 48_000,
        channels: 2,
        frameCount: 96_000,
        durationSecs: 2,
        detectedRoot: 60,
        detectedBpm: 128,
        category: 'percussive',
        decodeWarningCount: 0,
        decodeWarnings: [],
    };
}

const savedChunk = {
    version: 1,
    data: {
        mode: 'drum',
        activeSample: {
            sampleId: 3,
            sampleRate: 48_000,
            channels: 2,
            frameCount: 96_000,
            durationSecs: 2,
            detectedRoot: 60,
            detectedBpm: 128,
            category: 'percussive',
            filePath: SAVED_PATH,
            fileName: 'break.wav',
        },
    },
};

/** A project holding one Crumbs device, optionally carrying a saved sample. */
function projectWithCrumbs(options: { saved?: boolean } = {}): void {
    const bare = {
        id: DEVICE,
        name: 'Crumbs',
        type: 'builtin-crumbs',
        bypassed: false,
        parameterValues: {},
    };
    const device = options.saved === true ? { ...bare, deviceState: savedChunk } : bare;
    trackStore.set({
        tracks: [{ id: 'track-1', name: 'Sampler', devices: [device] } as unknown as Track],
        selectedTrackId: null,
        ghostClips: [],
    });
}

function emptyProject(): void {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
}

/** Drain the per-device chain, which is queued round trips rather than timers. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve();
    }
}

let stop: (() => void) | undefined;
let stopPersistence: (() => void) | undefined;

beforeEach(() => {
    crumbsStore.set({});
    padStore.set({});
    sliceStore.set({});
    crumbsEngineAttachmentStore.set(new Set<string>());
    crumbsNativeLifecycleStore.set({});
    trackStore.set(null);
    createMock.mockReset();
    createMock.mockResolvedValue({ attached: true });
    destroyMock.mockReset();
    destroyMock.mockResolvedValue(undefined);
    loadSampleMock.mockReset();
    loadSampleMock.mockResolvedValue(loadedSample());
    nativeAvailableMock.mockReset();
    nativeAvailableMock.mockReturnValue(true);
    commitMock.mockReset();
});

afterEach(() => {
    stop?.();
    stop = undefined;
    stopPersistence?.();
    stopPersistence = undefined;
    trackStore.set(null);
});

describe('syncCrumbsNativeInstances', () => {
    it('creates the instance when the device appears and marks the mirror from the result', async () => {
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(createMock).toHaveBeenCalledExactlyOnceWith(DEVICE);
        expect(crumbsEngineAttachmentStore.value).toEqual(new Set([DEVICE]));
        expect(crumbsStore.value?.[DEVICE]).toBeDefined();
        expect(padStore.value?.[DEVICE]).toBeDefined();
        expect(sliceStore.value?.[DEVICE]).toBeDefined();
    });

    // A create that found no running engine answers `attached: false`: the
    // instance is dormant, its writes park, and the next graph batch attaches
    // it. Marking it here would build a topology naming an instance the engine
    // does not hold, which the mapper refuses whole.
    it('leaves the mirror empty for a dormant instance', async () => {
        createMock.mockResolvedValue({ attached: false });
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(createMock).toHaveBeenCalledExactlyOnceWith(DEVICE);
        expect(crumbsEngineAttachmentStore.value).toEqual(new Set());
    });

    it('restores the saved sample into the fresh instance', async () => {
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs({ saved: true });
        await settle();

        expect(loadSampleMock).toHaveBeenCalledExactlyOnceWith(DEVICE, SAVED_PATH);
    });

    it('does not load anything for a device project truth holds no sample for', async () => {
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(loadSampleMock).not.toHaveBeenCalled();
    });

    // The restore must leave the device's `playbackKey` — mode, file path,
    // sample id — exactly as the document holds it. `load_sample` selects the
    // sample inside the instance on its own, so a store write here would buy
    // nothing and cost a committed chunk on a project the musician only opened.
    it('leaves the project clean: the restore commits no device-state chunk', async () => {
        stopPersistence = initCrumbsDeviceStatePersistence();
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs({ saved: true });
        await settle();

        expect(loadSampleMock).toHaveBeenCalledTimes(1);
        expect(commitMock).not.toHaveBeenCalled();
        expect(crumbsStore.value?.[DEVICE]?.activeSample?.sampleId).toBe(3);
        expect(crumbsStore.value?.[DEVICE]?.activeSample?.filePath).toBe(SAVED_PATH);
    });

    it('destroys the instance and retracts the mirror when the device leaves the project', async () => {
        stop = syncCrumbsNativeInstances();
        projectWithCrumbs();
        await settle();

        emptyProject();
        await settle();

        expect(destroyMock).toHaveBeenCalledExactlyOnceWith(DEVICE);
        expect(crumbsEngineAttachmentStore.value).toEqual(new Set());
        expect(crumbsStore.value?.[DEVICE]).toBeUndefined();
        expect(padStore.value?.[DEVICE]).toBeUndefined();
        expect(sliceStore.value?.[DEVICE]).toBeUndefined();
    });

    // An undo or a track delete can remove the device while the create is still
    // in flight. Unserialised, the destroy would reach the native side first
    // and the create would leave an instance behind for a device that is gone.
    it('still destroys an instance whose removal landed before the create resolved', async () => {
        const { promise: pendingCreate, resolve: finishCreate } = Promise.withResolvers<{ attached: boolean }>();
        createMock.mockReturnValue(pendingCreate);
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        emptyProject();
        await settle();

        expect(destroyMock).not.toHaveBeenCalled();

        finishCreate({ attached: true });
        await settle();

        expect(destroyMock).toHaveBeenCalledExactlyOnceWith(DEVICE);
        expect(crumbsEngineAttachmentStore.value).toEqual(new Set());
    });

    // A duplicate id is not a failure: something else already bound it, and the
    // instance the device needs exists. Rolling the stores back for it would
    // strip a live panel of its state.
    it('keeps the instance state when the create is refused as a duplicate', async () => {
        createMock.mockRejectedValue(new Error("Crumbs instance 'd-crumbs' already exists"));
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(crumbsStore.value?.[DEVICE]).toBeDefined();
        expect(loadSampleMock).not.toHaveBeenCalled();
    });

    it('rolls the instance state back when the create genuinely fails', async () => {
        createMock.mockRejectedValue(new Error('engine boot failed'));
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs({ saved: true });
        await settle();

        expect(crumbsStore.value?.[DEVICE]).toBeUndefined();
        expect(padStore.value?.[DEVICE]).toBeUndefined();
        expect(sliceStore.value?.[DEVICE]).toBeUndefined();
        expect(loadSampleMock).not.toHaveBeenCalled();
    });

    // The lifecycle state is the panel's only honest witness on a native build:
    // instance state says nothing, because a panel mount re-seeds it from
    // project truth whether or not an instance was ever created.
    it('records the create in flight before the round trip answers', async () => {
        const { promise: pendingCreate, resolve: finishCreate } = Promise.withResolvers<{ attached: boolean }>();
        createMock.mockReturnValue(pendingCreate);
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(crumbsNativeLifecycleStore.value?.[DEVICE]).toBe('creating');

        finishCreate({ attached: true });
        await settle();

        expect(crumbsNativeLifecycleStore.value?.[DEVICE]).toBe('bound');
    });

    it('records a dormant instance as bound, because it still takes the writes', async () => {
        createMock.mockResolvedValue({ attached: false });
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(crumbsNativeLifecycleStore.value?.[DEVICE]).toBe('bound');
    });

    it('records a duplicate refusal as bound, because the instance the device needs exists', async () => {
        createMock.mockRejectedValue(new Error("Crumbs instance 'd-crumbs' already exists"));
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(crumbsNativeLifecycleStore.value?.[DEVICE]).toBe('bound');
    });

    it('records a rolled-back create as failed', async () => {
        createMock.mockRejectedValue(new Error('engine boot failed'));
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(crumbsNativeLifecycleStore.value?.[DEVICE]).toBe('failed');
    });

    it('forgets the lifecycle state with the instance, rather than leaving a stale one', async () => {
        stop = syncCrumbsNativeInstances();
        projectWithCrumbs();
        await settle();

        emptyProject();
        await settle();

        expect(crumbsNativeLifecycleStore.value?.[DEVICE]).toBeUndefined();
    });

    it('creates nothing on a build with no native runtime', async () => {
        nativeAvailableMock.mockReturnValue(false);
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();

        expect(createMock).not.toHaveBeenCalled();
    });

    it('creates one instance per device, not one per project notification', async () => {
        stop = syncCrumbsNativeInstances();

        projectWithCrumbs();
        await settle();
        projectWithCrumbs();
        await settle();

        expect(createMock).toHaveBeenCalledTimes(1);
    });
});
