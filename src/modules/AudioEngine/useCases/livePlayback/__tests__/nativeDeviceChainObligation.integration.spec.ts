import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asAudioNode, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';
import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, compileReorderDevicesAction } from '#/modules/Arrangement/useCases';
import { resolveNoteReceivingInstrument } from '#/utils/deviceTypeMatching';

import { armNativeLiveMidiWriter } from '../armNativeLiveMidiWriter';
import { disarmNativeLiveMidiWriter } from '../disarmNativeLiveMidiWriter';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { nativeLiveMidiWriter } from '../nativeLiveMidiWriterState';
import { nativeMidiNoteSink } from '../nativeMidiNoteSink';
import { rearmNativeLiveMidiWriterInPlace } from '../rearmNativeLiveMidiWriterInPlace';

import type { BuiltinDeviceNode, TrackChannelStrip } from '../../../models/AudioEngineState';
import type {
    AudioGraphApplyResult,
    AudioGraphBackend,
    AudioGraphCommandBatch,
} from '../../../models/AudioGraphBackend';
import type { RuntimeGraphDeltaNode } from '../../../models/RuntimeGraphDelta';
import type { ReadLiveMidiProgrammeInput } from '../readLiveMidiProgramme';

const mocks = vi.hoisted(() => ({
    strip: undefined as Pick<TrackChannelStrip, 'trackId' | 'deviceNodes'> | undefined,
    applyRuntimeGraphDelta: vi.fn(),
    notifyUser: vi.fn(),
    declineNativeChain: true,
}));

// Physical persistent nodes are fixtures. Both topology classification and the
// native mirror, session queue, edit observer and MIDI writer are production code.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    const { matchesRuntimeDeviceChainTopology } = await import('../../../services/matchesRuntimeDeviceChainTopology');
    const { mirrorDeviceChainDelta } = await import('../mirrorDeviceChainDelta');
    const { createRuntimeGraphTopologyFingerprint } =
        await import('../../../services/createRuntimeGraphTopologyFingerprint');
    return {
        ...actual,
        applyRuntimeGraphDelta: mocks.applyRuntimeGraphDelta,
        updateDeviceParam: vi.fn(),
        getRuntimeGraphRevision: () => 7,
        getTrackStrip: () => mocks.strip,
        matchesRuntimeDeviceChainTopology: (expected: RuntimeGraphDeltaNode) =>
            matchesRuntimeDeviceChainTopology(mocks.strip, expected),
        mirrorDeviceChainDelta,
        createRuntimeGraphTopologyFingerprint,
    };
});
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRevision: () => 'native-chain-project',
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
// Note placement is outside this contract. The real native sink law still
// chooses the target for each pass, including the pass the real observer re-arms.
vi.mock('../readLiveMidiProgramme', () => ({
    readLiveMidiProgramme: (input: ReadLiveMidiProgrammeInput) => ({
        targets: input.stripTracks.flatMap((track) => {
            const sink = nativeMidiNoteSink({
                track,
                attachedInstanceIds: input.attachedInstanceIds,
                bakedStripIds: new Set(),
            });
            if (sink.outcome !== 'voiced' || !input.carriedStripIds.has(track.id)) {
                return [];
            }
            return [{ target: { trackId: track.id, deviceId: sink.device.id }, events: [] }];
        }),
        exclusions: [],
        nativeVoicedStripIds: new Set<string>(),
        probabilitySeed: 0,
    }),
}));

const TRACK_ID = 'native-midi';
const fermenter: Device = {
    id: 'fermenter',
    name: 'Fermenter',
    type: 'fermenter',
    bypassed: false,
    parameterValues: {},
};
const drum: Device = {
    id: 'drum-kit',
    name: 'Drum Kit',
    type: 'builtin-drum-kit',
    bypassed: false,
    parameterValues: {},
};
const applyNative = vi.fn<(batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult>>();
const backend: AudioGraphBackend = {
    backendId: 'native-boundary-double',
    apply: (batch) => applyNative(batch),
    dispose: () => {},
};

function persistentNode(device: Device): BuiltinDeviceNode {
    const node = asAudioNode(createMockAudioNode('gain'));
    return {
        deviceId: device.id,
        type: device.type,
        parameterIds: Object.keys(device.parameterValues).sort((left, right) => left.localeCompare(right)),
        nodes: [node],
        inputNode: node,
        outputNode: node,
    };
}

function publishTrack(devices: readonly Device[]): Track {
    const track = createTrack({ id: TRACK_ID, name: 'Rolling MIDI', kind: 'midi' });
    track.devices = [...devices];
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    return track;
}

function nativeTopologyRequests() {
    return applyNative.mock.calls
        .map(([batch]) => batch.commands)
        .filter((commands) =>
            commands.some((command) => command.kind === 'insert-device' || command.kind === 'remove-device')
        );
}

beforeEach(() => {
    vi.clearAllMocks();
    disarmNativeLiveMidiWriter();
    mocks.declineNativeChain = true;
    mocks.strip = { trackId: TRACK_ID, deviceNodes: [persistentNode(fermenter)] };
    mocks.applyRuntimeGraphDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
    nativeLiveGraphSession.backend = backend;
    nativeLiveGraphSession.rolling = true;
    nativeLiveGraphSession.carriedStripIds = new Set([TRACK_ID]);
    nativeLiveGraphSession.nativeChainByStripId = new Map([[TRACK_ID, [fermenter.id]]]);
    nativeLiveGraphSession.lastDeferredChainNotice = null;
    nativeLiveGraphSession.pending = Promise.resolve();
    applyNative.mockImplementation((batch) => {
        const topology = batch.commands.some(
            (command) => command.kind === 'insert-device' || command.kind === 'remove-device'
        );
        if (topology && mocks.declineNativeChain) {
            return Promise.resolve({
                acceptance: 'rejected',
                application: 'not-applied',
                reason: 'injected native chain refusal',
            });
        }
        const heldDeviceIds = nativeLiveGraphSession.nativeChainByStripId.get(TRACK_ID) ?? [];
        let deviceIds = [...heldDeviceIds];
        for (const command of batch.commands) {
            if (command.kind === 'remove-device') {
                deviceIds = deviceIds.filter((id) => id !== command.deviceId);
            }
            if (command.kind === 'insert-device') {
                if (deviceIds.includes(command.device.id)) {
                    return Promise.resolve({
                        acceptance: 'rejected',
                        application: 'not-applied',
                        reason: 'duplicate native device',
                    });
                }
                deviceIds.splice(command.index, 0, command.device.id);
            }
        }
        return Promise.resolve({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 1,
            reports: [{ kind: 'track', id: TRACK_ID, deviceIds }],
        });
    });
});

afterEach(async () => {
    await nativeLiveGraphSession.pending;
    disarmNativeLiveMidiWriter();
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.rolling = false;
    nativeLiveGraphSession.carriedStripIds = new Set();
    nativeLiveGraphSession.nativeChainByStripId = new Map();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
});

describe('native obligations behind a matching persistent Web Audio chain', () => {
    it('attempts the full rolling drum insertion and reorder, or explicitly defers them, before re-arming the held native instrument', async () => {
        const initial = publishTrack([fermenter]);
        await armNativeLiveMidiWriter({
            stripTracks: [initial],
            attachedInstanceIds: new Set(),
            carriedStripIds: new Set([TRACK_ID]),
            sampleRate: 48_000,
            positionSeconds: 0,
        });
        expect(nativeLiveMidiWriter.pass?.targets.map((slot) => slot.target.deviceId)).toEqual([fermenter.id]);
        const addition = await getArrangementHandlers().addDevice.execute({
            type: 'addDevice',
            payload: { trackId: TRACK_ID, deviceType: drum.type, deviceId: drum.id },
        });
        if (!addition || addition.status !== 'written') {
            throw new Error('Expected a written drum insertion');
        }
        expect(nativeLiveMidiWriter.pendingRearm).toBe(true);
        await addition.afterCommit?.();
        await nativeLiveGraphSession.pending;
        const reorderAction = compileReorderDevicesAction(TRACK_ID, drum.id, fermenter.id);
        if (!reorderAction) {
            throw new Error('Expected a legal drum reorder');
        }
        const reorder = await getArrangementHandlers().reorderDevices.execute(reorderAction);
        if (!reorder || reorder.status !== 'written') {
            throw new Error('Expected a written drum reorder');
        }
        await reorder.afterCommit?.();
        const reordered = trackStore.value?.tracks.find((track) => track.id === TRACK_ID);
        if (!reordered) {
            throw new Error('Expected the reordered track');
        }
        await nativeLiveGraphSession.pending;
        await rearmNativeLiveMidiWriterInPlace({ positionSeconds: 0 });

        expect(resolveNoteReceivingInstrument(reordered.devices, () => false)?.device.id).toBe(drum.id);
        expect(nativeLiveMidiWriter.pass?.targets.map((slot) => slot.target.deviceId)).toEqual([fermenter.id]);
        expect(mocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        const requests = nativeTopologyRequests();
        expect(requests).toHaveLength(2);
        expect(requests[0]).toContainEqual(
            expect.objectContaining({ kind: 'insert-device', device: expect.objectContaining({ id: drum.id }) })
        );
        expect(requests[1]?.map((command) => command.kind)).toEqual([
            'remove-device',
            'insert-device',
            'insert-device',
        ]);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('takes effect on the next play: injected native chain refusal'),
            'warning'
        );
    });

    it('does not insert the same native devices twice when grouped steps already share their final persistent chain', async () => {
        mocks.declineNativeChain = false;
        nativeLiveGraphSession.nativeChainByStripId = new Map([[TRACK_ID, []]]);
        const eqOne: Device = {
            id: 'eq-one',
            name: 'EQ One',
            type: 'builtin-eq',
            bypassed: false,
            parameterValues: {},
        };
        const eqTwo: Device = { ...eqOne, id: 'eq-two', name: 'EQ Two' };
        publishTrack([]);
        const actions = [
            {
                type: 'addDevice' as const,
                payload: { trackId: TRACK_ID, deviceType: 'builtin-eq', deviceId: eqOne.id },
            },
            {
                type: 'addDevice' as const,
                payload: { trackId: TRACK_ID, deviceType: 'builtin-eq', deviceId: eqTwo.id },
            },
        ];
        const first = await getArrangementHandlers().addDevice.execute(actions[0]!, { actions, actionIndex: 0 });
        const second = await getArrangementHandlers().addDevice.execute(actions[1]!, { actions, actionIndex: 1 });
        if (!first || first.status !== 'written' || !second || second.status !== 'written') {
            throw new Error('Expected both grouped additions');
        }
        const final = trackStore.value?.tracks.find((track) => track.id === TRACK_ID);
        if (!final) {
            throw new Error('Expected the final EQ pair');
        }
        mocks.strip = { trackId: TRACK_ID, deviceNodes: final.devices.map(persistentNode) };
        await first.afterCommit?.();
        await second.afterCommit?.();
        await nativeLiveGraphSession.pending;

        expect(nativeLiveGraphSession.nativeChainByStripId.get(TRACK_ID)).toEqual([eqOne.id, eqTwo.id]);
        expect(nativeTopologyRequests()).toHaveLength(1);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
