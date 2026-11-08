import { strToU8, zipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

// jsdom lacks Worker transport; extraction still runs the production ZIP core.
vi.mock('../extractDawProjectZipEntries', async () => {
    const { extractDawProjectZipEntriesInProcess } = await import('../../testing/extractDawProjectZipEntriesInProcess');
    return { extractDawProjectZipEntries: extractDawProjectZipEntriesInProcess };
});

const CHANNELS = [new Float32Array([0.125, -0.25, 0.5, -0.75]), new Float32Array([-0.5, 0.25, -0.125, 0.75])];
const SAMPLE_RATE = 48_000;

function createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return {
        sampleRate,
        length,
        numberOfChannels,
        duration: length / sampleRate,
        getChannelData: (channel) => channels[channel]!,
        copyFromChannel: (destination, channel, start = 0) => {
            destination.set(channels[channel]!.subarray(start, start + destination.length));
        },
        copyToChannel: (source, channel, start = 0) => {
            channels[channel]!.set(source, start);
        },
    };
}

function decodedStereo(): AudioBuffer {
    const buffer = createBuffer(2, CHANNELS[0]!.length, SAMPLE_RATE);
    CHANNELS.forEach((channel, index) => buffer.copyToChannel(channel, index));
    return buffer;
}

function projectZip(title: string): ArrayBuffer {
    const xml = `<Project version="1.0">
        <Transport><Tempo value="143"/><TimeSignature numerator="3" denominator="4"/></Transport>
        <Structure>
            <Track id="audio-source" name="Imported stereo" contentType="audio"><Channel id="audio-channel"/></Track>
            <Track id="midi-source" name="Imported notes" contentType="notes"><Channel id="midi-channel"/></Track>
        </Structure>
        <Arrangement timeUnit="beats"><Lanes timeUnit="beats">
            <Clips track="audio-source"><Clip time="2" duration="5" name="Stereo phrase"><Audio><File path="audio/stereo.wav"/></Audio></Clip></Clips>
            <Clips track="midi-source"><Clip time="9" duration="3" name="Note phrase"><Notes><Note time="0.5" duration="1.25" key="67" vel="0.75"/></Notes></Clip></Clips>
        </Lanes><Markers><Marker time="13" name="Imported marker"/></Markers></Arrangement>
    </Project>`;
    const bytes = zipSync({
        'project.xml': strToU8(xml),
        'metadata.xml': strToU8(`<MetaData><Title>${title}</Title></MetaData>`),
        'audio/stereo.wav': new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
    });
    return Uint8Array.from(bytes).buffer;
}

async function importRuntime() {
    const lifecycle = await import('#/app/registerProjectLifecycle');
    const projections = await import('#/app/registerProjectSlotProjections');
    const devices = await import('#/app/registerDeviceEnginePorts');
    const supporting = await import('#/app/registerSupportingServicePorts');
    const project = await import('#/modules/Project/useCases');
    const projectStores = await import('#/modules/Project/stores');
    const crdt = await import('#/modules/CrdtDocument/useCases');
    const command = await import('#/modules/Command/useCases');
    const commandStores = await import('#/modules/Command/stores');
    const arrangement = await import('#/modules/Arrangement/useCases');
    const arrangementStores = await import('#/modules/Arrangement/stores');
    const midi = await import('#/modules/MIDI/stores');
    const transport = await import('#/modules/Transport/stores');
    const audio = await import('#/modules/AudioEngine/useCases');
    const audioStores = await import('#/modules/AudioEngine/stores');
    const interchange = await import('../importDawProject');
    return {
        interchange,
        project,
        projectStores,
        crdt,
        command,
        commandStores,
        arrangement,
        arrangementStores,
        midi,
        transport,
        audio,
        audioStores,
        lifecycle,
        projections,
        devices,
        supporting,
    };
}

let runtime: Awaited<ReturnType<typeof importRuntime>>;
let database: ReturnType<typeof installTransactionalIndexedDb> | undefined;
let setupComplete = false;
const stopAutosaves: Array<() => void> = [];
let notifications: NotifyPayload[] = [];
let unsubscribeNotifications = () => {};
let decode = vi.fn<(bytes: ArrayBuffer) => Promise<AudioBuffer>>();
let audioContext: AudioContext | undefined;
const changedContextProperties = new Map<string, PropertyDescriptor | undefined>();

function currentAudioClip() {
    const track = runtime.arrangementStores.trackStore.value?.tracks.find((item) => item.name === 'Imported stereo');
    const clip = track?.clips[0];
    if (!track || !clip?.audioBufferId) {
        throw new Error('Expected the imported audio track and its live PCM reference');
    }
    return { track, clip, bufferId: clip.audioBufferId };
}

function captureSuccessor() {
    flushAutomergeStorageWrites();
    return {
        root: runtime.crdt.captureProjectRootIdentity(),
        documents: runtime.crdt
            .getCrdtDocIds()
            .toSorted()
            .map((id) => [id, JSON.stringify(runtime.crdt.getCrdtDoc(id))]),
        project: structuredClone(runtime.projectStores.projectStore.value),
        tracks: structuredClone(runtime.arrangementStores.trackStore.value),
        midi: structuredClone(runtime.midi.midiStore.value),
        transport: structuredClone(runtime.transport.transportStore.value),
        history: runtime.commandStores.undoHistoryStore.value,
        notices: [...notifications],
    };
}

describe('DAWproject import project truth and PCM publication', () => {
    beforeAll(async () => {
        database = installTransactionalIndexedDb();
        runtime = await importRuntime();
        const context = runtime.audio.getAudioContext();
        audioContext = context;
        const originalCreateBuffer = Object.getOwnPropertyDescriptor(context, 'createBuffer');
        const originalDecode = Object.getOwnPropertyDescriptor(context, 'decodeAudioData');
        Object.defineProperty(context, 'createBuffer', { configurable: true, value: createBuffer, writable: true });
        changedContextProperties.set('createBuffer', originalCreateBuffer);
        Object.defineProperty(context, 'decodeAudioData', {
            configurable: true,
            value: (bytes: ArrayBuffer) => decode(bytes),
            writable: true,
        });
        changedContextProperties.set('decodeAudioData', originalDecode);
        runtime.lifecycle.registerProjectLifecycle();
        runtime.projections.registerProjectSlotProjections();
        runtime.devices.registerDeviceEnginePorts();
        runtime.supporting.registerSupportingServicePorts();
        setupComplete = true;
    }, 30_000);

    beforeEach(() => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        localStorage.clear();
        Container.clear();
        runtime.crdt.resetCrdtProjectAuthority('DAWproject integration');
        runtime.crdt.registerCrdtStorageRuntime();
        runtime.commandStores.clearHandlerRegistry();
        runtime.commandStores.registerHandlerMap(runtime.arrangement.getArrangementHandlers());
        runtime.command.clearUndoHistory();
        runtime.command.resetActionReplayAuthority();
        runtime.arrangement.setArrangementEventBus({ emit: () => Promise.resolve() });
        runtime.project.setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => Promise.resolve(),
        });
        runtime.audio.configureDurableAudioBufferOwnership(runtime.project.collectDurableOwnedAudioBufferIds);
        const startAutosave = runtime.crdt.startCrdtAutoSave;
        vi.spyOn(runtime.crdt, 'startCrdtAutoSave').mockImplementation(() => {
            const stop = startAutosave();
            stopAutosaves.push(stop);
            return stop;
        });
        decode = vi.fn(async () => decodedStereo());
        notifications = [];
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        unsubscribeNotifications = bus.on('ui.notify', (notice) => {
            notifications.push(notice);
        });
        setNotificationEventBus(bus);
    });

    afterEach(async () => {
        if (!setupComplete) {
            return;
        }
        stopAutosaves.splice(0).forEach((stop) => stop());
        unsubscribeNotifications();
        runtime.command.clearUndoHistory();
        runtime.commandStores.clearHandlerRegistry();
        await runtime.audio.clearRuntimeCachedAudioBuffers();
        runtime.audio.configureDurableAudioBufferOwnership(null);
        configureAutomergeStoragePort(null);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    afterAll(async () => {
        if (audioContext) {
            for (const [key, descriptor] of changedContextProperties) {
                if (descriptor) {
                    Object.defineProperty(audioContext, key, descriptor);
                } else {
                    Reflect.deleteProperty(audioContext, key);
                }
            }
        }
        await database?.dispose();
    });

    it('commits real ZIP tracks, MIDI and tempo to CRDT and resolves the imported clip to exact stereo PCM', async () => {
        const result = await runtime.interchange.importDawProject({
            buffer: projectZip('Committed import'),
            fileName: 'committed.dawproject',
            outgoingProject: 'discard',
        });
        expect(result).toEqual({ ok: true, warnings: [] });
        expect(decode).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer));
        flushAutomergeStorageWrites();

        const tracks = runtime.arrangementStores.trackStore.value?.tracks;
        expect(tracks?.map((track) => track.name)).toEqual(['Master', 'Imported stereo', 'Imported notes']);
        const { track, clip, bufferId } = currentAudioClip();
        expect(clip).toMatchObject({
            trackId: track.id,
            name: 'Stereo phrase',
            type: 'audio',
            startBeat: 2,
            endBeat: 7,
        });
        const noteTrack = tracks?.find((item) => item.name === 'Imported notes');
        const noteClip = noteTrack?.clips[0];
        expect(noteClip).toMatchObject({
            trackId: noteTrack?.id,
            name: 'Note phrase',
            type: 'midi',
            startBeat: 9,
            endBeat: 12,
        });
        if (!noteClip) {
            throw new Error('Expected imported MIDI clip');
        }
        expect(runtime.midi.midiStore.value?.notesByClipId[noteClip.id]).toEqual([
            expect.objectContaining({ pitch: 67, startBeat: 0.5, duration: 1.25, velocity: 95 }),
        ]);
        expect(runtime.transport.transportStore.value).toMatchObject({
            tempo: 143,
            timeSignatureNumerator: 3,
            timeSignatureDenominator: 4,
        });
        const document = runtime.crdt.getCrdtDoc('root');
        expect(document?.tracks).toEqual(structuredClone({ tracks }));
        expect(document).toMatchObject({
            midi: runtime.midi.midiStore.value,
            transport: { tempo: 143, timeSignatureNumerator: 3, timeSignatureDenominator: 4 },
        });
        const buffer = runtime.audio.getCachedAudioBuffer({ bufferId });
        expect(buffer).toMatchObject({ numberOfChannels: 2, sampleRate: SAMPLE_RATE, length: 4 });
        CHANNELS.forEach((channel, index) => expect(buffer?.getChannelData(index)).toEqual(channel));
        expect(runtime.projectStores.projectStore.value).toMatchObject({
            name: 'Committed import',
            initialized: true,
            loading: false,
        });
        expect(notifications.filter((notice) => notice.level === 'success').map((notice) => notice.message)).toEqual([
            'Imported Committed import (3 tracks)',
        ]);
    });

    it('leaves successor authority, projections, PCM and actual history untouched when an old decoder completes', async () => {
        expect(
            await runtime.interchange.importDawProject({
                buffer: projectZip('Successor'),
                fileName: 'successor.dawproject',
                outgoingProject: 'discard',
            })
        ).toEqual({ ok: true, warnings: [] });
        const { bufferId } = currentAudioClip();
        const successorBuffer = runtime.audio.getCachedAudioBuffer({ bufferId });
        const decoding = Promise.withResolvers<AudioBuffer>();
        const enteredDecoder = Promise.withResolvers<void>();
        decode.mockImplementationOnce(() => {
            enteredDecoder.resolve();
            return decoding.promise;
        });
        const pending = runtime.interchange.importDawProject({
            buffer: projectZip('Abandoned'),
            fileName: 'abandoned.dawproject',
            outgoingProject: 'discard',
        });
        await enteredDecoder.promise;
        const successor = runtime.project.runProjectLoadTransaction();
        expect(await successor.prepare()).toBe(true);
        expect(successor.activate()).toBe(true);
        await runtime.command.executeAppAction({
            type: 'renameTrack',
            payload: { trackId: currentAudioClip().track.id, name: 'Successor edit' },
        });
        expect(runtime.commandStores.undoHistoryStore.value?.past).toHaveLength(1);
        const before = captureSuccessor();
        const imports = vi.spyOn(runtime.audioStores.audioBufferCache, 'importBuffers');

        decoding.resolve(decodedStereo());
        await expect(pending).resolves.toEqual({ ok: false, warnings: [] });

        expect(captureSuccessor()).toEqual(before);
        expect(imports).not.toHaveBeenCalled();
        expect(runtime.audio.getCachedAudioBuffer({ bufferId })).toBe(successorBuffer);
        CHANNELS.forEach((channel, index) => expect(successorBuffer?.getChannelData(index)).toEqual(channel));
        expect(successor.isCurrent()).toBe(true);
    });
});
