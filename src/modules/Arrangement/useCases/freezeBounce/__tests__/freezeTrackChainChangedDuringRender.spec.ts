import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    cacheAudioBuffer,
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { trackStore } from '../../../stores';
import { createTrack } from '../../createTrack';
import { getArrangementHandlers, setArrangementEventBus } from '../../index';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';
import { cancelFreezeTrack } from '../cancelFreezeTrack';
import { renderTrackOffline } from '../renderOffline';

registerSupportingServicePorts();

// The Freeze action, its commit, the failure settlement and the device handlers are the real ones
// over a real CRDT document; only the offline render, which owns the audio, is replaced, and the
// render's await is held open so an edit can land inside the window.
vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

vi.mock('../../device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
}));

// The live strip belongs to the audio engine, which has no context under Vitest; the device
// handlers' authoritative project writes still run for real.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    addDeviceToStrip: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    removeDeviceFromStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
}));

const TRACK_ID = 'track-1';
const CHANGED_MESSAGE = 'The track changed while it was freezing. Freeze it again.';

function findTrack() {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    if (!track) {
        throw new Error('Expected the fixture track');
    }
    return track;
}

function renderedBuffer(): AudioBuffer {
    const channel = new Float32Array(4410).fill(0.25);
    return {
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
        duration: 0.1,
        getChannelData: vi.fn(() => channel),
        sampleRate: 44100,
        length: 4410,
        numberOfChannels: 1,
    };
}

/** Freezes the track, runs `duringRender` while the render is awaiting, then lets the render succeed. */
async function freezeWhile(duringRender: () => Promise<void>): Promise<void> {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    vi.mocked(renderTrackOffline).mockImplementationOnce(async (_track, _start, _end, options) => {
        options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
        entered.resolve();
        await resume.promise;
        return renderedBuffer();
    });
    const freezing = executeAppAction({ type: 'freezeTrack', payload: { trackId: TRACK_ID } });
    await entered.promise;
    expect(findTrack().freezeState.status).toBe('freezing');
    await duringRender();
    resume.resolve();
    await freezing;
}

beforeEach(async () => {
    vi.mocked(renderTrackOffline).mockReset();
    vi.mocked(notifyUser).mockReset();
    vi.mocked(cacheAudioBuffer).mockClear();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('freeze chain change test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    configureRuntimeGraphProjectRevisionValidator(
        (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
    );
    configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    clearUndoHistory();
    resetActionReplayAuthority();
    projectStore.set(structuredClone(defaultProjectStoreState));
    trackStore.set({
        tracks: [createTrack({ id: TRACK_ID, name: 'Keys', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
    arrangementStore.set({
        activeArrangementId: defaultArrangementId,
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    flushAutomergeStorageWrites();
    await executeAppAction({ type: 'addDevice', payload: { trackId: TRACK_ID, deviceType: 'builtin-eq' } });
});

afterEach(() => {
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(structuredClone(defaultProjectStoreState));
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('a freeze whose device chain changes during the render', () => {
    it('commits the take when nothing changed during the render', async () => {
        await freezeWhile(async () => undefined);

        const track = findTrack();
        expect(track.frozen).toBe(true);
        expect(track.freezeState.status).toBe('frozen');
        expect(track.freezeState.sourceContentHash).toEqual(expect.any(String));
        expect(track.frozenBufferId).toEqual(expect.any(String));
    });

    it.each([
        [
            'a device is added',
            () => executeAppAction({ type: 'addDevice', payload: { trackId: TRACK_ID, deviceType: 'builtin-reverb' } }),
        ],
        [
            'a device parameter is edited',
            () =>
                executeAppAction({
                    type: 'setDeviceParameter',
                    payload: { deviceId: findTrack().devices[0]!.id, paramId: 'eq-mid-freq', value: 2_400 },
                }),
        ],
    ])('refuses the take when %s', async (_name, edit) => {
        await freezeWhile(async () => {
            await edit();
        });

        const track = findTrack();
        expect(track.frozen).toBe(false);
        expect(track.frozenBufferId).toBeUndefined();
        // The edit itself returns the track to unfrozen, so there is no pending freeze left to
        // settle as an error; the user hears why through the notification.
        expect(track.freezeState.status).toBe('unfrozen');
        expect(track.freezeState.sourceContentHash).toBeUndefined();
        expect(track.freezeState.frozenBufferId).toBeUndefined();
        expect(notifyUser).toHaveBeenCalledWith(CHANGED_MESSAGE, 'error');
    });

    it('does not commit when the freeze is cancelled during the render', async () => {
        await freezeWhile(async () => {
            cancelFreezeTrack(TRACK_ID);
        });

        const track = findTrack();
        expect(track.frozen).toBe(false);
        expect(track.frozenBufferId).toBeUndefined();
        expect(track.freezeState.sourceContentHash).toBeUndefined();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('does not commit when the track is removed during the render', async () => {
        await freezeWhile(async () => {
            trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        });

        expect(trackStore.value?.tracks.some((candidate) => candidate.id === TRACK_ID)).toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
    });
});
