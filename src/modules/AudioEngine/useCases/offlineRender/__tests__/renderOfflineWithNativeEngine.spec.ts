/**
 * Native offline routing (#3082): the producer emits a bus-source send the
 * same way live `sendCommands` does (#5067), without a native addon. Device
 * parameter automation (#3776): a native body's lane reaches the batch under
 * the body's own name and the declared law, and a lane the law will not carry
 * declines the render instead of vanishing from the file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { takeLaneStore, type Clip, type Device, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import { createGrooveMidiEventProjector, shouldPlayMidiEvent } from '#/modules/MIDI/useCases';
import { defaultTransportState } from '#/modules/Transport/stores';

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: vi.fn(() => 0),
}));

vi.mock('../resolveTrackClipsWithComping', async (importOriginal) => {
    const original = await importOriginal<typeof import('../resolveTrackClipsWithComping')>();
    return { ...original, resolveTrackClipsWithComping: vi.fn(original.resolveTrackClipsWithComping) };
});

import { withNativeTimelineMaterialTransport } from '../../../repositories/nativeGraph/__tests__/withNativeTimelineMaterialTransport';
import {
    type MapGraphBatchInput,
    type NativeGraphTransport,
} from '../../../repositories/nativeGraph/nativeGraphTransport';
import { type NativeGraphWireCommand } from '../../../repositories/nativeGraph/serializeAudioGraphCommand';
import { offlineDeviceParameterLawState } from '../../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { offlineMidiEventProjectorState } from '../../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { offlinePpqEndpointProjectorState } from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { clearReportedLatency } from '../../latencyCompensation/compensation/clearReportedLatency';
import { getCompensationDelay } from '../../latencyCompensation/compensation/getCompensationDelay';
import { reportLatency } from '../../latencyCompensation/compensation/reportLatency';
import { captureOfflineRenderInput } from '../captureOfflineRenderInput';
import { type NativeOfflineHostedRuntime } from '../nativeOfflineHostedDevice';
import { offlineRenderCapturePorts } from '../offlineRenderCapturePorts';
import { type OfflineRenderProjectSource } from '../OfflineRenderSource';
import { renderOfflineWithNativeEngine, type NativeOfflineRenderInput } from '../renderOfflineWithNativeEngine';
import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

registerDeviceEnginePorts();

class StubAudioBuffer {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    readonly duration: number;
    private readonly channels: Float32Array<ArrayBuffer>[];

    constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
        this.length = options.length;
        this.numberOfChannels = options.numberOfChannels;
        this.sampleRate = options.sampleRate;
        this.duration = options.length / options.sampleRate;
        this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
    }

    getChannelData(channel: number): Float32Array<ArrayBuffer> {
        const data = this.channels[channel];
        if (!data) {
            throw new Error(`StubAudioBuffer has no channel ${String(channel)}`);
        }
        return data;
    }

    copyToChannel(source: Float32Array<ArrayBuffer>, channel: number): void {
        this.getChannelData(channel).set(source);
    }
}

function createTrack(overrides?: Partial<Track>): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'off',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    };
}

function capturingTransport(frames: number): {
    transport: NativeGraphTransport;
    commands: NativeGraphWireCommand[];
} {
    const commands: NativeGraphWireCommand[] = [];
    const transport: NativeGraphTransport = {
        registerTimelineSample: () => Promise.reject(new Error('routing spec registers no sample')),
        beginLevainBank: () => Promise.reject(new Error('routing spec stages no levain bank')),
        registerLevainSample: () => Promise.reject(new Error('routing spec stages no levain bank')),
        commitLevainBank: () => Promise.reject(new Error('routing spec stages no levain bank')),
        releaseLevainBank: () => Promise.reject(new Error('routing spec stages no levain bank')),
        renderGraphOffline: () => Promise.resolve(new Uint8Array(frames * 8)),
        applyGraphCommands: () => Promise.reject(new Error('an export must never start the live engine')),
        mapGraphBatch: (input: MapGraphBatchInput) => {
            commands.push(...input.batch.commands);
            return Promise.resolve({ acceptance: 'accepted', application: 'applied', reports: [] });
        },
    };
    return { transport: withNativeTimelineMaterialTransport(transport), commands };
}

describe('renderOfflineWithNativeEngine — routing', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('emits a track send and a bus-source send to another built bus', async () => {
        const frames = 8;
        const { transport, commands } = capturingTransport(frames);
        const audio = createTrack({
            id: 'audio-1',
            sends: [{ busId: 'verb', level: 0.3, preFader: false }] as Track['sends'],
        });
        const verb = createTrack({
            id: 'verb',
            kind: 'bus',
            sends: [{ busId: 'parallel-comp', level: 0.5, preFader: false }] as Track['sends'],
        });
        const parallel = createTrack({ id: 'parallel-comp', kind: 'bus' });
        const renderableTracks = [audio, verb, parallel];

        const result = await renderOfflineWithNativeEngine({
            transport,
            sampleRate: 48_000,
            frameCount: frames,
            durationSeconds: frames / 48_000,
            masterGainValue: 1,
            defaultTempo: 120,
            changes: [],
            projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => {
                const startSeconds = startPpq * 0.5;
                const endSeconds = endPpq * 0.5;
                return {
                    startSamples: startSeconds * sampleRate,
                    endSamples: endSeconds * sampleRate,
                    durationSamples: (endSeconds - startSeconds) * sampleRate,
                    startSeconds,
                    endSeconds,
                    durationSeconds: endSeconds - startSeconds,
                };
            },
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            renderableTracks,
            scheduledTracks: [],
            contributingTrackIds: new Set(),
            soloGatedByTrackId: new Map(),
            vcaMultiplierByTrackId: new Map(),
        });

        expect(result.outcome).toBe('rendered');
        expect(commands.filter((command) => command.kind === 'add-send')).toEqual([
            { kind: 'add-send', trackId: 'audio-1', busId: 'verb', tap: 'post-fader', level: 0.3 },
            { kind: 'add-send', trackId: 'verb', busId: 'parallel-comp', tap: 'post-fader', level: 0.5 },
        ]);
    });

    it('marks a solo-gated destination bus on create-bus-strip while the source stays ungated', async () => {
        const frames = 8;
        const { transport, commands } = capturingTransport(frames);
        const audio = createTrack({
            id: 'audio-1',
            sends: [{ busId: 'verb', level: 0.3, preFader: false }] as Track['sends'],
        });
        const verb = createTrack({ id: 'verb', kind: 'bus' });
        const renderableTracks = [audio, verb];

        const result = await renderOfflineWithNativeEngine({
            transport,
            sampleRate: 48_000,
            frameCount: frames,
            durationSeconds: frames / 48_000,
            masterGainValue: 1,
            defaultTempo: 120,
            changes: [],
            projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => {
                const startSeconds = startPpq * 0.5;
                const endSeconds = endPpq * 0.5;
                return {
                    startSamples: startSeconds * sampleRate,
                    endSamples: endSeconds * sampleRate,
                    durationSamples: (endSeconds - startSeconds) * sampleRate,
                    startSeconds,
                    endSeconds,
                    durationSeconds: endSeconds - startSeconds,
                };
            },
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            renderableTracks,
            scheduledTracks: [audio],
            contributingTrackIds: new Set(['audio-1']),
            soloGatedByTrackId: new Map([['verb', true]]),
            vcaMultiplierByTrackId: new Map(),
        });

        expect(result.outcome).toBe('rendered');

        const busStrip = commands.find(
            (command): command is Extract<NativeGraphWireCommand, { kind: 'create-bus-strip' }> =>
                command.kind === 'create-bus-strip' && command.busId === 'verb'
        );
        const sourceStrip = commands.find(
            (command): command is Extract<NativeGraphWireCommand, { kind: 'create-track-strip' }> =>
                command.kind === 'create-track-strip' && command.trackId === 'audio-1'
        );

        expect(busStrip?.state.soloGated).toBe(true);
        expect(sourceStrip?.state.soloGated).toBe(false);
    });
});

describe('renderOfflineWithNativeEngine — device projection', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // Project truth spells a Fermenter's parameters as the ids a panel authors;
    // the native mapper resolves `parameterValues` against the engine's own
    // names and refuses the whole batch, by strip, over one it cannot name
    // (#3893). The strip command this producer sends must already carry the
    // projected names.
    it('projects a fermenter device on a scheduled track onto the engine parameter names', async () => {
        const frames = 8;
        const { transport, commands } = capturingTransport(frames);
        const fermenter: Device = {
            id: 'ferm',
            name: 'Fermenter',
            type: 'fermenter',
            bypassed: false,
            parameterValues: { oscEngine: 2 },
        };
        const audio = createTrack({ id: 'audio-1', devices: [fermenter] });

        const result = await renderOfflineWithNativeEngine({
            transport,
            sampleRate: 48_000,
            frameCount: frames,
            durationSeconds: frames / 48_000,
            masterGainValue: 1,
            defaultTempo: 120,
            changes: [],
            projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => {
                const startSeconds = startPpq * 0.5;
                const endSeconds = endPpq * 0.5;
                return {
                    startSamples: startSeconds * sampleRate,
                    endSamples: endSeconds * sampleRate,
                    durationSamples: (endSeconds - startSeconds) * sampleRate,
                    startSeconds,
                    endSeconds,
                    durationSeconds: endSeconds - startSeconds,
                };
            },
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            renderableTracks: [audio],
            scheduledTracks: [audio],
            contributingTrackIds: new Set(['audio-1']),
            soloGatedByTrackId: new Map(),
            vcaMultiplierByTrackId: new Map(),
        });

        expect(result.outcome).toBe('rendered');
        const trackStrip = commands.find(
            (command): command is Extract<NativeGraphWireCommand, { kind: 'create-track-strip' }> =>
                command.kind === 'create-track-strip' && command.trackId === 'audio-1'
        );
        expect(trackStrip?.devices.find((device) => device.id === 'ferm')?.parameterValues).toEqual({ engine: 2 });
    });

    // This engine hosts every strip in the render, so an engine-compensated
    // body's delay is the engine's to hold back on any of them and none of
    // them may be counted here as well. Read at the compensation boundary,
    // because the correction is invisible in a project holding no such body.
    it('reads its compensation with every renderable strip named as engine-hosted', async () => {
        const frames = 8;
        const { transport } = capturingTransport(frames);
        vi.mocked(getCompensationDelay).mockClear();
        const bus = createTrack({ id: 'verb', kind: 'bus' });
        const audio = createTrack({ id: 'audio-1', outputId: 'verb' });

        const result = await renderOfflineWithNativeEngine({
            transport,
            sampleRate: 48_000,
            frameCount: frames,
            durationSeconds: frames / 48_000,
            masterGainValue: 1,
            defaultTempo: 120,
            changes: [],
            projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => {
                const startSeconds = startPpq * 0.5;
                const endSeconds = endPpq * 0.5;
                return {
                    startSamples: startSeconds * sampleRate,
                    endSamples: endSeconds * sampleRate,
                    durationSamples: (endSeconds - startSeconds) * sampleRate,
                    startSeconds,
                    endSeconds,
                    durationSeconds: endSeconds - startSeconds,
                };
            },
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            renderableTracks: [audio, bus],
            scheduledTracks: [audio],
            contributingTrackIds: new Set(['audio-1']),
            soloGatedByTrackId: new Map(),
            vcaMultiplierByTrackId: new Map(),
        });

        expect(result.outcome).toBe('rendered');
        expect(vi.mocked(getCompensationDelay).mock.calls).toEqual([
            ['audio-1', undefined, new Set(['audio-1', 'verb'])],
        ]);
    });
});

type StoredAutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];

describe('renderOfflineWithNativeEngine — device parameter automation (#3776)', () => {
    /** The declared ceiling the law clamps every stamped value to. */
    const DECLARED_CEILING = 12;

    const gluten: Device = {
        id: 'glue-1',
        name: 'Gluten',
        type: 'gluten',
        bypassed: false,
        parameterValues: { inputGain: 0 },
    };

    function deviceLane(parameterId: string, value: number): StoredAutomationLane {
        return {
            id: `lane-${parameterId}`,
            trackId: 'audio-1',
            parameterId,
            parameterName: parameterId,
            // Two points, because the device slew — where the declared clamp
            // runs — only engages on a curve with more than one event.
            points: [
                { beat: 0, value, curve: 'step', tension: 0 },
                { beat: 0.004, value, curve: 'step', tension: 0 },
            ],
            enabled: true,
            visible: true,
            collapsed: false,
            objects: [],
            minValue: -24,
            maxValue: 24,
        };
    }

    async function render(lanes: StoredAutomationLane[], automationMode: 'read' | 'off' = 'read') {
        const frames = 480;
        const { transport, commands } = capturingTransport(frames);
        automationStore.set({ lanes });
        const audio = createTrack({ id: 'audio-1', name: 'Glued', automationMode, devices: [gluten] });
        const result = await renderOfflineWithNativeEngine({
            transport,
            sampleRate: 48_000,
            frameCount: frames,
            durationSeconds: frames / 48_000,
            masterGainValue: 1,
            defaultTempo: 120,
            changes: [],
            projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => {
                const startSeconds = startPpq * 0.5;
                const endSeconds = endPpq * 0.5;
                return {
                    startSamples: startSeconds * sampleRate,
                    endSamples: endSeconds * sampleRate,
                    durationSamples: (endSeconds - startSeconds) * sampleRate,
                    startSeconds,
                    endSeconds,
                    durationSeconds: endSeconds - startSeconds,
                };
            },
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            renderableTracks: [audio],
            scheduledTracks: [audio],
            contributingTrackIds: new Set(['audio-1']),
            soloGatedByTrackId: new Map(),
            vcaMultiplierByTrackId: new Map(),
        });
        const deviceWrites = commands.filter(
            (command): command is Extract<NativeGraphWireCommand, { kind: 'write-device-parameter' }> =>
                command.kind === 'write-device-parameter'
        );
        return { result, commands, deviceWrites };
    }

    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);
        offlineDeviceParameterLawState.isAutomatable = () => true;
        offlineDeviceParameterLawState.clampValue = ({ value }) => Math.min(value, DECLARED_CEILING);
        offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        automationStore.set({ lanes: [] });
        offlineDeviceParameterLawState.isAutomatable = null;
        offlineDeviceParameterLawState.clampValue = null;
        offlineDeviceParameterLawState.quantiseValue = null;
    });

    it('stamps a native body lane under the body’s own name, held to the declared clamp', async () => {
        const { result, deviceWrites } = await render([deviceLane('glue-1:inputGain', 20)]);

        expect(result.outcome).toBe('rendered');
        expect(deviceWrites).toEqual([
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'glue-1', parameterId: 'input_gain' },
                write: { shape: 'step', value: DECLARED_CEILING, time: 0 },
            },
        ]);
    });

    it('declines a lane naming a device on the strip that the law will not carry', async () => {
        const { result, commands } = await render([deviceLane('glue-1:notOnTheDevice', 3)]);

        expect(result).toEqual({
            outcome: 'declined',
            reason:
                'automation lane "glue-1:notOnTheDevice" on track "Glued" names a device parameter the native ' +
                'render cannot carry',
        });
        expect(commands).toEqual([]);
    });

    it('declines a bare legacy lane whose key a device on the strip holds but the law refuses', async () => {
        offlineDeviceParameterLawState.isAutomatable = ({ paramId }) => paramId !== 'inputGain';

        const { result, commands } = await render([deviceLane('inputGain', 3)]);

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'automation lane "inputGain" on track "Glued" names a device parameter the native render cannot carry',
        });
        expect(commands).toEqual([]);
    });

    it('declines a typed legacy lane naming a device type on the strip whose key the law refuses', async () => {
        offlineDeviceParameterLawState.isAutomatable = ({ paramId }) => paramId !== 'inputGain';

        const { result, commands } = await render([deviceLane('gluten:inputGain', 3)]);

        expect(result).toEqual({
            outcome: 'declined',
            reason:
                'automation lane "gluten:inputGain" on track "Glued" names a device parameter the native render ' +
                'cannot carry',
        });
        expect(commands).toEqual([]);
    });

    it('renders a strip reading no automation natively, whatever its device lanes name', async () => {
        const { result, deviceWrites } = await render([deviceLane('glue-1:notOnTheDevice', 3)], 'off');

        expect(result.outcome).toBe('rendered');
        expect(deviceWrites.filter((command) => command.target.deviceId === 'glue-1')).toEqual([]);
    });

    it('writes nothing for an orphan lane whose device has left the chain, as the web render does', async () => {
        const { result, deviceWrites } = await render([deviceLane('removed-1:inputGain', 3)]);

        expect(result.outcome).toBe('rendered');
        expect(deviceWrites).toEqual([]);
    });

    function clip(id: string, startBeat: number, endBeat: number): Clip {
        return {
            id,
            trackId: 'audio-1',
            name: id,
            type: 'audio',
            startBeat,
            endBeat,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#00ff00',
            locked: false,
            muted: false,
        };
    }

    /** A one-point lane on the same parameter, scoped to `clipId` when given. */
    function pointLane(id: string, value: number, beat: number, clipId?: string): StoredAutomationLane {
        return {
            id,
            trackId: 'audio-1',
            clipId,
            parameterId: 'glue-1:inputGain',
            parameterName: 'glue-1:inputGain',
            points: [{ beat, value, curve: 'step', tension: 0 }],
            enabled: true,
            visible: true,
            collapsed: false,
            objects: [],
            minValue: -24,
            maxValue: 24,
        };
    }

    /**
     * Two disjoint clip-scoped lanes on one device parameter (Fixture D):
     * `clip-a`[0, 0.01) holds `lane-clip-a`'s value 3, `clip-b`[0.01, 0.02)
     * holds `lane-clip-b`'s value 9. Neither one's window overlaps the
     * other's, so `scheduleTrackAutomation` merges them into the single
     * schedule this recorder can hold, and the render carries both values.
     */
    async function renderFixtureD(lanes: StoredAutomationLane[]) {
        const frames = 480;
        const { transport, commands } = capturingTransport(frames);
        automationStore.set({ lanes });
        const audio = createTrack({
            id: 'audio-1',
            name: 'Glued',
            automationMode: 'read',
            devices: [gluten],
            clips: [clip('clip-a', 0, 0.01), clip('clip-b', 0.01, 0.02)],
        });
        const result = await renderOfflineWithNativeEngine({
            transport,
            sampleRate: 48_000,
            frameCount: frames,
            durationSeconds: frames / 48_000,
            masterGainValue: 1,
            defaultTempo: 120,
            changes: [],
            projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => {
                const startSeconds = startPpq * 0.5;
                const endSeconds = endPpq * 0.5;
                return {
                    startSamples: startSeconds * sampleRate,
                    endSamples: endSeconds * sampleRate,
                    durationSamples: (endSeconds - startSeconds) * sampleRate,
                    startSeconds,
                    endSeconds,
                    durationSeconds: endSeconds - startSeconds,
                };
            },
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            renderableTracks: [audio],
            scheduledTracks: [audio],
            contributingTrackIds: new Set(['audio-1']),
            soloGatedByTrackId: new Map(),
            vcaMultiplierByTrackId: new Map(),
        });
        const deviceWrites = commands.filter(
            (command): command is Extract<NativeGraphWireCommand, { kind: 'write-device-parameter' }> =>
                command.kind === 'write-device-parameter'
        );
        return { result, commands, deviceWrites };
    }

    it('renders both disjoint clip-scoped lanes on one device parameter, lane-a then lane-b (Fixture D)', async () => {
        const { result, deviceWrites } = await renderFixtureD([
            pointLane('lane-clip-a', 3, 0, 'clip-a'),
            pointLane('lane-clip-b', 9, 0.01, 'clip-b'),
        ]);

        expect(result.outcome).toBe('rendered');
        expect(deviceWrites).toEqual([
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'glue-1', parameterId: 'input_gain' },
                write: { shape: 'step', value: 3, time: 0 },
            },
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'glue-1', parameterId: 'input_gain' },
                write: { shape: 'step', value: 9, time: 0.005 },
            },
        ]);
    });

    it('renders the same disjoint pair in the opposite lane-array order, unchanged (Fixture D)', async () => {
        const { result, deviceWrites } = await renderFixtureD([
            pointLane('lane-clip-b', 9, 0.01, 'clip-b'),
            pointLane('lane-clip-a', 3, 0, 'clip-a'),
        ]);

        expect(result.outcome).toBe('rendered');
        expect(deviceWrites).toEqual([
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'glue-1', parameterId: 'input_gain' },
                write: { shape: 'step', value: 3, time: 0 },
            },
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'glue-1', parameterId: 'input_gain' },
                write: { shape: 'step', value: 9, time: 0.005 },
            },
        ]);
    });

    it('renders the strip natively, spliced by scope, when a track-level lane overlaps a clip-scoped lane on one device parameter (Fixture O) (#4736)', async () => {
        const trackLane: StoredAutomationLane = {
            id: 'lane-track',
            trackId: 'audio-1',
            // Track-level (no clipId): held across the whole render, with a
            // second point at the render's own end so its own schedule
            // genuinely spans past clip-b's start — a real overlap, not two
            // lanes that merely compile back to back.
            parameterId: 'glue-1:inputGain',
            parameterName: 'glue-1:inputGain',
            points: [
                { beat: 0, value: 3, curve: 'step', tension: 0 },
                { beat: 0.02, value: 3, curve: 'step', tension: 0 },
            ],
            enabled: true,
            visible: true,
            collapsed: false,
            objects: [],
            minValue: -24,
            maxValue: 24,
        };
        // The clip lane holds its value across its whole window, so its
        // schedule spans it rather than collapsing to a lone terminator.
        const clipLane: StoredAutomationLane = {
            ...pointLane('lane-clip-b', 9, 0.01, 'clip-b'),
            points: [
                { beat: 0.01, value: 9, curve: 'step', tension: 0 },
                { beat: 0.02, value: 9, curve: 'step', tension: 0 },
            ],
        };
        const { result, deviceWrites } = await renderFixtureD([trackLane, clipLane]);

        // The scope law hands clip-b's window to the clip lane and every
        // other span to the track lane. Nothing is withheld, so the native
        // export has no overlap to decline over and renders with the splice.
        expect(result.outcome).toBe('rendered');
        expect(deviceWrites).toEqual([
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'glue-1', parameterId: 'input_gain' },
                write: { shape: 'step', value: 3, time: 0 },
            },
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'glue-1', parameterId: 'input_gain' },
                write: { shape: 'step', value: 9, time: 0.005 },
            },
        ]);
    });
});

/** The beat→seconds law every case here renders under: 120 BPM, no map. */
const halfSecondPerBeat: NativeOfflineRenderInput['projectPpqEndpoints'] = ({ startPpq, endPpq, sampleRate }) => {
    const startSeconds = startPpq * 0.5;
    const endSeconds = endPpq * 0.5;
    return {
        startSamples: startSeconds * sampleRate,
        endSamples: endSeconds * sampleRate,
        durationSamples: (endSeconds - startSeconds) * sampleRate,
        startSeconds,
        endSeconds,
        durationSeconds: endSeconds - startSeconds,
    };
};

/** A render of one audio track carrying `devices`, at 48 kHz, over `frames`. */
function renderOneTrack(input: {
    transport: NativeGraphTransport;
    frames: number;
    devices: Device[];
    hostedPluginRuntime?: NativeOfflineHostedRuntime;
    abortSignal?: AbortSignal;
}) {
    const audio = createTrack({ id: 'audio-1', name: 'Vocals', automationMode: 'read', devices: input.devices });
    return renderOfflineWithNativeEngine({
        transport: input.transport,
        sampleRate: 48_000,
        frameCount: input.frames,
        durationSeconds: input.frames / 48_000,
        masterGainValue: 1,
        defaultTempo: 120,
        changes: [],
        projectPpqEndpoints: halfSecondPerBeat,
        resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
        renderableTracks: [audio],
        scheduledTracks: [audio],
        contributingTrackIds: new Set(['audio-1']),
        soloGatedByTrackId: new Map(),
        vcaMultiplierByTrackId: new Map(),
        hostedPluginRuntime: input.hostedPluginRuntime,
        abortSignal: input.abortSignal,
    });
}

describe('renderOfflineWithNativeEngine — a loaded hosted plugin (#4592, #6777)', () => {
    /** The plugin's own published ceiling, which every stamped value is held to. */
    const PUBLISHED_CEILING = 0.6;

    const hostedReverb: Device = {
        id: 'plugin-1',
        name: 'Valhalla',
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalPluginId: 'valhalla',
        externalInstanceId: 'instance-1',
    };

    const loadedEffect: NativeOfflineHostedRuntime = {
        loadedInstanceIds: new Set(['instance-1']),
        onDesktopRuntime: true,
        pluginKind: () => 'effect',
    };

    /** A ride on the plugin's parameter 7: 0.2 at beat 0, then 0.9 from beat 1 (0.5 s). */
    const mixRide: StoredAutomationLane = {
        id: 'lane-mix',
        trackId: 'audio-1',
        parameterId: 'plugin-1:7',
        parameterName: 'Mix',
        points: [
            { beat: 0, value: 0.2, curve: 'step', tension: 0 },
            { beat: 1, value: 0.9, curve: 'step', tension: 0 },
        ],
        enabled: true,
        visible: true,
        collapsed: false,
        objects: [],
        minValue: 0,
        maxValue: 1,
    };

    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);
        offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
        offlineDeviceParameterLawState.acceptsExternalPluginParameter = (instanceId, parameterId) =>
            instanceId === 'instance-1' && parameterId === '7';
        offlineDeviceParameterLawState.clampExternalPluginValue = ({ value }) => Math.min(value, PUBLISHED_CEILING);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        automationStore.set({ lanes: [] });
        offlineDeviceParameterLawState.quantiseValue = null;
        offlineDeviceParameterLawState.acceptsExternalPluginParameter = null;
        offlineDeviceParameterLawState.clampExternalPluginValue = null;
    });

    function deviceWrites(commands: readonly NativeGraphWireCommand[]) {
        return commands.filter(
            (command): command is Extract<NativeGraphWireCommand, { kind: 'write-device-parameter' }> =>
                command.kind === 'write-device-parameter'
        );
    }

    it('puts the hosted device on its strip, naming the instance the engine prints it from', async () => {
        const frames = 48_000;
        const { transport, commands } = capturingTransport(frames);

        const result = await renderOneTrack({
            transport,
            frames,
            devices: [hostedReverb],
            hostedPluginRuntime: loadedEffect,
        });

        expect(result.outcome).toBe('rendered');
        const strip = commands.find(
            (command): command is Extract<NativeGraphWireCommand, { kind: 'create-track-strip' }> =>
                command.kind === 'create-track-strip' && command.trackId === 'audio-1'
        );
        expect(strip?.devices).toEqual([
            {
                id: 'plugin-1',
                name: 'Valhalla',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'valhalla',
                externalInstanceId: 'instance-1',
            },
        ]);
    });

    it('stamps the hosted parameter ride on that device at its frames, held to the plugin’s own law', async () => {
        const frames = 48_000;
        const { transport, commands } = capturingTransport(frames);
        automationStore.set({ lanes: [mixRide] });

        const result = await renderOneTrack({
            transport,
            frames,
            devices: [hostedReverb],
            hostedPluginRuntime: loadedEffect,
        });

        expect(result.outcome).toBe('rendered');
        const target = { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'plugin-1', parameterId: '7' };
        // The step at beat 1 (0.5 s) rides the device slew the live writer
        // stamps too: one tick part-way, then the plugin's ceiling.
        expect(deviceWrites(commands)).toEqual([
            { kind: 'write-device-parameter', target, write: { shape: 'step', value: 0.2, time: 0 } },
            { kind: 'write-device-parameter', target, write: { shape: 'step', value: 0.48, time: 0.5 } },
            { kind: 'write-device-parameter', target, write: { shape: 'step', value: PUBLISHED_CEILING, time: 0.51 } },
        ]);
    });

    it('declines by name when the capture carries no hosted law for an automated hosted lane', async () => {
        offlineDeviceParameterLawState.acceptsExternalPluginParameter = null;
        offlineDeviceParameterLawState.clampExternalPluginValue = null;
        const { transport, commands } = capturingTransport(480);
        automationStore.set({ lanes: [mixRide] });

        const result = await renderOneTrack({
            transport,
            frames: 480,
            devices: [hostedReverb],
            hostedPluginRuntime: loadedEffect,
        });

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'automation lane "Mix" on track "Vocals" names a device parameter the native render cannot carry',
        });
        expect(commands).toEqual([]);
    });

    it('stamps a loaded hosted instrument’s ride exactly as a hosted effect’s', async () => {
        const frames = 48_000;
        const { transport, commands } = capturingTransport(frames);
        automationStore.set({ lanes: [mixRide] });

        const result = await renderOneTrack({
            transport,
            frames,
            devices: [hostedReverb],
            hostedPluginRuntime: { ...loadedEffect, pluginKind: () => 'instrument' },
        });

        expect(result.outcome).toBe('rendered');
        const target = { kind: 'device-parameter', trackId: 'audio-1', deviceId: 'plugin-1', parameterId: '7' };
        expect(deviceWrites(commands)).toEqual([
            { kind: 'write-device-parameter', target, write: { shape: 'step', value: 0.2, time: 0 } },
            { kind: 'write-device-parameter', target, write: { shape: 'step', value: 0.48, time: 0.5 } },
            { kind: 'write-device-parameter', target, write: { shape: 'step', value: PUBLISHED_CEILING, time: 0.51 } },
        ]);
    });

    it('stamps nothing for a hosted device the shared predicate does not admit, and declines its ride', async () => {
        const { transport, commands } = capturingTransport(480);
        automationStore.set({ lanes: [mixRide] });

        const result = await renderOneTrack({
            transport,
            frames: 480,
            devices: [hostedReverb],
            hostedPluginRuntime: { ...loadedEffect, pluginKind: () => null },
        });

        expect(result.outcome).toBe('declined');
        expect(deviceWrites(commands)).toEqual([]);
    });
});

describe('renderOfflineWithNativeEngine — a loaded hosted instrument plays the track’s MIDI (#6777)', () => {
    const synth: Device = {
        id: 'synth-1',
        name: 'Synth',
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalPluginId: 'synth',
        externalInstanceId: 'instance-synth',
    };
    const gluten: Device = { id: 'glue-1', name: 'Gluten', type: 'gluten', bypassed: false, parameterValues: {} };
    const loadedInstrument: NativeOfflineHostedRuntime = {
        loadedInstanceIds: new Set(['instance-synth']),
        onDesktopRuntime: true,
        pluginKind: () => 'instrument',
    };
    const PROBABILITY_SEED = 0x5eed;
    /** 48 kHz, 8 s: every clip below fits. */
    const FRAMES = 48_000 * 8;

    type MidiNote = MidiStoreState['notesByClipId'][string][number];
    const notes: MidiNote[] = [
        { id: 'n-low', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
        { id: 'n-high', pitch: 64, startBeat: 2, duration: 1, velocity: 64 },
        { id: 'n-never', pitch: 67, startBeat: 3, duration: 0.5, velocity: 90, probability: 0 },
    ];

    function midiClip(overrides: Partial<Clip> & { id: string }): Clip {
        return {
            name: overrides.id,
            trackId: 'midi-1',
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#00ff00',
            locked: false,
            muted: false,
            ...overrides,
        };
    }

    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);
        midiStore.set({
            probabilitySeed: PROBABILITY_SEED,
            notesByClipId: { 'clip-a': notes },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        offlineMidiEventProjectorState.createProjector = () => createGrooveMidiEventProjector();
        offlineMidiEventProjectorState.selectProbability = shouldPlayMidiEvent;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        midiStore.set(null);
        takeLaneStore.set(null);
        offlineRenderCapturePorts.createMidiProjector = null;
        offlinePpqEndpointProjectorState.project = null;
        offlinePpqEndpointProjectorState.resolveTempoAtBeat = null;
        offlinePpqEndpointProjectorState.beatAtSecondsFromAnchor = null;
        offlineMidiEventProjectorState.createProjector = null;
        offlineMidiEventProjectorState.selectProbability = null;
    });

    function renderKeys(input: {
        transport: NativeGraphTransport;
        clips: Clip[];
        devices?: Device[];
        captured?: NativeOfflineRenderInput['captured'];
        frameCount?: number;
    }) {
        const keys = createTrack({
            id: 'midi-1',
            name: 'Keys',
            kind: 'midi',
            devices: input.devices ?? [synth],
            clips: input.clips,
        });
        return renderOfflineWithNativeEngine({
            transport: input.transport,
            sampleRate: 48_000,
            frameCount: input.frameCount ?? FRAMES,
            durationSeconds: (input.frameCount ?? FRAMES) / 48_000,
            masterGainValue: 1,
            defaultTempo: 120,
            changes: [],
            projectPpqEndpoints: halfSecondPerBeat,
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            renderableTracks: [keys],
            scheduledTracks: [keys],
            contributingTrackIds: new Set(['midi-1']),
            soloGatedByTrackId: new Map(),
            vcaMultiplierByTrackId: new Map(),
            hostedPluginRuntime: loadedInstrument,
            captured: input.captured,
        });
    }

    const noteEvent = (time: number, note: number, velocity: number, isNoteOn: boolean) => ({
        time,
        note,
        velocity,
        channel: 0,
        isNoteOn,
    });

    it('sends the looped clip to the instrument on the render timeline, after the strip that holds it', async () => {
        const { transport, commands } = capturingTransport(FRAMES);

        // The clip starts at beat 4 (2 s) and loops a 4-beat pattern twice.
        const result = await renderKeys({
            transport,
            clips: [midiClip({ id: 'clip-a', startBeat: 4, endBeat: 12, loopEnabled: true, loopLength: 4 })],
        });

        expect(result.outcome).toBe('rendered');
        const scheduled = commands.filter((command) => command.kind === 'schedule-midi');
        expect(scheduled).toEqual([
            {
                kind: 'schedule-midi',
                trackId: 'midi-1',
                deviceId: 'synth-1',
                probabilitySeed: PROBABILITY_SEED,
                notes: [
                    noteEvent(2, 60, 100, true),
                    noteEvent(2.5, 60, 0, false),
                    noteEvent(3, 64, 64, true),
                    noteEvent(3.5, 64, 0, false),
                    noteEvent(4, 60, 100, true),
                    noteEvent(4.5, 60, 0, false),
                    noteEvent(5, 64, 64, true),
                    noteEvent(5.5, 64, 0, false),
                ],
            },
        ]);
        const kinds = commands.map((command) => command.kind);
        expect(kinds.indexOf('schedule-midi')).toBeGreaterThan(kinds.indexOf('create-track-strip'));
    });

    it('prints the notes of the comp the render captured, not the live comp edited since', async () => {
        const { transport, commands } = capturingTransport(FRAMES);
        const clips = [
            midiClip({ id: 'clip-x', startBeat: 0, endBeat: 4 }),
            midiClip({ id: 'clip-y', startBeat: 0, endBeat: 4 }),
        ];
        midiStore.set({
            probabilitySeed: PROBABILITY_SEED,
            notesByClipId: {
                'clip-x': [{ id: 'n-x', pitch: 72, startBeat: 1, duration: 1, velocity: 100 }],
                'clip-y': [{ id: 'n-y', pitch: 76, startBeat: 1, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const keys = createTrack({ id: 'midi-1', name: 'Keys', kind: 'midi', devices: [synth], clips });
        const compOf = (takeId: string, clipId: string): NonNullable<typeof takeLaneStore.value> => ({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'midi-1',
                    takes: [{ id: takeId, clipId, name: takeId, startBeat: 0, endBeat: 4, selected: false }],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId }],
                },
            ],
        });
        const project: OfflineRenderProjectSource = {
            tracks: { tracks: [keys], selectedTrackId: null },
            midi: midiStore.value,
            transport: { ...defaultTransportState, tempo: 120 },
            tempoMap: null,
            timeSignatureMap: null,
            automationLanes: [],
            // The export started with take X comped over the whole clip span.
            takeLanes: compOf('take-x', 'clip-x'),
            gainEnvelopes: {},
            sidechainRoutes: [],
            vcaGroups: [],
            grooveTemplates: null,
            chordTrack: null,
            yeastProcessorsByDevice: {},
        };
        offlineRenderCapturePorts.createMidiProjector = () => createGrooveMidiEventProjector();
        offlinePpqEndpointProjectorState.project = halfSecondPerBeat;
        offlinePpqEndpointProjectorState.resolveTempoAtBeat = ({ defaultTempo }) => defaultTempo;
        offlinePpqEndpointProjectorState.beatAtSecondsFromAnchor = (_changes, anchorBeat, elapsedSeconds, tempo) =>
            anchorBeat + (elapsedSeconds * tempo) / 60;
        const captured = captureOfflineRenderInput({ durationBeats: 8, sampleRate: 48_000 }, { project });
        // The musician then comped take Y instead.
        takeLaneStore.set(compOf('take-y', 'clip-y'));

        await renderKeys({ transport, clips, captured });

        const scheduled = commands.find((command) => command.kind === 'schedule-midi');
        expect(scheduled?.kind === 'schedule-midi' ? scheduled.notes : null).toEqual([
            noteEvent(0.5, 72, 100, true),
            noteEvent(1, 72, 0, false),
        ]);
    });

    it('prints the notes the render captured, not the live notes edited since', async () => {
        const { transport, commands } = capturingTransport(FRAMES);
        const clips = [midiClip({ id: 'clip-a', startBeat: 0, endBeat: 4 })];
        const notesAt = (pitch: number): MidiStoreState => ({
            probabilitySeed: PROBABILITY_SEED,
            notesByClipId: { 'clip-a': [{ id: 'n-a', pitch, startBeat: 1, duration: 1, velocity: 100 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        midiStore.set(notesAt(72));
        const keys = createTrack({ id: 'midi-1', name: 'Keys', kind: 'midi', devices: [synth], clips });
        const project: OfflineRenderProjectSource = {
            tracks: { tracks: [keys], selectedTrackId: null },
            midi: midiStore.value,
            transport: { ...defaultTransportState, tempo: 120 },
            tempoMap: null,
            timeSignatureMap: null,
            automationLanes: [],
            takeLanes: null,
            gainEnvelopes: {},
            sidechainRoutes: [],
            vcaGroups: [],
            grooveTemplates: null,
            chordTrack: null,
            yeastProcessorsByDevice: {},
        };
        offlineRenderCapturePorts.createMidiProjector = () => createGrooveMidiEventProjector();
        offlinePpqEndpointProjectorState.project = halfSecondPerBeat;
        offlinePpqEndpointProjectorState.resolveTempoAtBeat = ({ defaultTempo }) => defaultTempo;
        offlinePpqEndpointProjectorState.beatAtSecondsFromAnchor = (_changes, anchorBeat, elapsedSeconds, tempo) =>
            anchorBeat + (elapsedSeconds * tempo) / 60;
        const captured = captureOfflineRenderInput({ durationBeats: 8, sampleRate: 48_000 }, { project });
        // The musician then transposed the note in the live session.
        midiStore.set(notesAt(76));

        await renderKeys({ transport, clips, captured });

        const scheduled = commands.find((command) => command.kind === 'schedule-midi');
        expect(scheduled?.kind === 'schedule-midi' ? scheduled.notes : null).toEqual([
            noteEvent(0.5, 72, 100, true),
            noteEvent(1, 72, 0, false),
        ]);
    });

    it('comps a MIDI clip against the render’s own tempo map, not the live one, after a tempo change', async () => {
        const { transport, commands } = capturingTransport(FRAMES);
        // 120 BPM to beat 2 (0.5 s a beat), then 60 BPM (1 s a beat): beat 4 sits at 3 s.
        // The live session holds the default map, which puts beat 4 at 2 s.
        const secondsAtBeat = (beat: number) => (beat <= 2 ? beat * 0.5 : beat - 1);
        const tempoAtBeat = (beat: number) => (beat < 2 ? 120 : 60);
        const tempoChangeEndpoints: NativeOfflineRenderInput['projectPpqEndpoints'] = ({
            startPpq,
            endPpq,
            sampleRate,
        }) => {
            const startSeconds = secondsAtBeat(startPpq);
            const endSeconds = secondsAtBeat(endPpq);
            return {
                startSamples: startSeconds * sampleRate,
                endSamples: endSeconds * sampleRate,
                durationSamples: (endSeconds - startSeconds) * sampleRate,
                startSeconds,
                endSeconds,
                durationSeconds: endSeconds - startSeconds,
            };
        };
        const clips = [midiClip({ id: 'clip-a', startBeat: 4, endBeat: 8 })];
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'midi-1',
                    takes: [
                        { id: 'take-a', clipId: 'clip-a', name: 'take-a', startBeat: 4, endBeat: 8, selected: false },
                    ],
                    activeCompRegions: [{ startBeat: 4, endBeat: 8, takeId: 'take-a' }],
                },
            ],
        });
        vi.mocked(resolveTrackClipsWithComping).mockClear();
        const keys = createTrack({ id: 'midi-1', name: 'Keys', kind: 'midi', devices: [synth], clips });

        const result = await renderOfflineWithNativeEngine({
            transport,
            sampleRate: 48_000,
            frameCount: FRAMES,
            durationSeconds: FRAMES / 48_000,
            masterGainValue: 1,
            defaultTempo: 120,
            changes: [{ id: 'tempo-change-1', beat: 2, tempo: 60, curve: 'instant' }],
            projectPpqEndpoints: tempoChangeEndpoints,
            resolveTempoAtBeat: ({ beat }) => tempoAtBeat(beat),
            renderableTracks: [keys],
            scheduledTracks: [keys],
            contributingTrackIds: new Set(['midi-1']),
            soloGatedByTrackId: new Map(),
            vcaMultiplierByTrackId: new Map(),
            hostedPluginRuntime: loadedInstrument,
        });

        expect(result.outcome).toBe('rendered');
        const scheduled = commands.find((command) => command.kind === 'schedule-midi');
        expect(scheduled?.kind === 'schedule-midi' ? scheduled.notes : null).toEqual([
            noteEvent(3, 60, 100, true),
            noteEvent(4, 60, 0, false),
            noteEvent(5, 64, 64, true),
            noteEvent(6, 64, 0, false),
        ]);
        // Comping of a MIDI clip never converts through the map, so no note time
        // can tell the render's timeline from the live one: the map handed to the
        // resolver is the observable. Every resolution of this render reads it.
        const timelines = vi.mocked(resolveTrackClipsWithComping).mock.calls.map((call) => call[3]);
        expect(timelines.length).toBeGreaterThan(0);
        for (const timeline of timelines) {
            expect(timeline?.secondsAtBeat(4)).toBe(3);
            expect(timeline?.tempoAtBeat(4)).toBe(60);
        }
    });

    it('moves every note by the strip’s latency compensation, as the audio clips and the web notes move', async () => {
        const { transport, commands } = capturingTransport(FRAMES);
        vi.mocked(getCompensationDelay).mockReturnValueOnce(0.25);

        await renderKeys({ transport, clips: [midiClip({ id: 'clip-a', startBeat: 0, endBeat: 4 })] });

        const scheduled = commands.find((command) => command.kind === 'schedule-midi');
        expect(scheduled?.kind === 'schedule-midi' ? scheduled.notes.map((entry) => entry.time) : null).toEqual([
            0.25, 0.75, 1.25, 1.75,
        ]);
    });

    // The strip is held back 0.25 s to meet a deeper strip, so a note 0.05 s
    // before the project end lands 0.2 s past it. The span the render is sized
    // from has to carry that, or the engine is handed a frame it never renders.
    it('prints a compensated note placed just before the project end (#7312)', async () => {
        const clips = [midiClip({ id: 'clip-end', startBeat: 0, endBeat: 8 })];
        midiStore.set({
            probabilitySeed: PROBABILITY_SEED,
            notesByClipId: { 'clip-end': [{ id: 'n-end', pitch: 60, startBeat: 7.9, duration: 0.05, velocity: 100 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const keys = createTrack({ id: 'midi-1', name: 'Keys', kind: 'midi', devices: [synth], clips });
        const deepFx = createTrack({
            id: 'fx',
            name: 'Fx',
            kind: 'audio',
            devices: [{ id: 'deep-1', name: 'Gluten', type: 'gluten', bypassed: false, parameterValues: {} }],
        });
        const project: OfflineRenderProjectSource = {
            tracks: { tracks: [keys, deepFx], selectedTrackId: null },
            midi: midiStore.value,
            transport: { ...defaultTransportState, tempo: 120 },
            tempoMap: null,
            timeSignatureMap: null,
            automationLanes: [],
            takeLanes: null,
            gainEnvelopes: {},
            sidechainRoutes: [],
            vcaGroups: [],
            grooveTemplates: null,
            chordTrack: null,
            yeastProcessorsByDevice: {},
        };
        offlineRenderCapturePorts.createMidiProjector = () => createGrooveMidiEventProjector();
        offlinePpqEndpointProjectorState.project = halfSecondPerBeat;
        offlinePpqEndpointProjectorState.resolveTempoAtBeat = ({ defaultTempo }) => defaultTempo;
        offlinePpqEndpointProjectorState.beatAtSecondsFromAnchor = (_changes, anchorBeat, elapsedSeconds, tempo) =>
            anchorBeat + (elapsedSeconds * tempo) / 60;
        reportLatency('deep-1', 250);
        const captured = captureOfflineRenderInput(
            { durationBeats: 8, tailSeconds: 0, sampleRate: 48_000 },
            { project }
        );
        vi.mocked(getCompensationDelay).mockReturnValueOnce(0.25);
        const { transport, commands } = capturingTransport(captured.outputFrameCount);

        await renderKeys({ transport, clips, captured, frameCount: captured.outputFrameCount });

        const scheduled = commands.find((command) => command.kind === 'schedule-midi');
        const times = scheduled?.kind === 'schedule-midi' ? scheduled.notes.map((entry) => entry.time) : [];
        expect(times).toHaveLength(2);
        for (const time of times) {
            expect(Math.round(time * 48_000)).toBeLessThan(captured.outputFrameCount);
        }
        clearReportedLatency('deep-1');
    });

    it('sends nothing for a muted clip, and no command at all for a track with no notes', async () => {
        const { transport, commands } = capturingTransport(FRAMES);

        const result = await renderKeys({
            transport,
            clips: [midiClip({ id: 'clip-a', muted: true })],
        });

        expect(result.outcome).toBe('rendered');
        expect(commands.filter((command) => command.kind === 'schedule-midi')).toEqual([]);
    });

    it('declines a hosted instrument track when no MIDI projection is configured, sending no notes', async () => {
        const { transport, commands } = capturingTransport(FRAMES);
        offlineMidiEventProjectorState.createProjector = null;

        const result = await renderKeys({ transport, clips: [midiClip({ id: 'clip-a' })] });

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'the MIDI projection is not configured for the native render',
        });
        expect(commands.some((command) => command.kind === 'schedule-midi')).toBe(false);
    });

    it('declines a MIDI track whose note sink is not a loaded hosted instrument', async () => {
        const { transport } = capturingTransport(FRAMES);

        const result = await renderKeys({
            transport,
            devices: [gluten],
            clips: [midiClip({ id: 'clip-a' })],
        });

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'MIDI clip on track "Keys" reached the native path',
        });
    });
});

describe('renderOfflineWithNativeEngine — Cancel during the native render (#4592)', () => {
    /**
     * A transport whose render waits until cancelled, then rejects the way the
     * native side does — with the IPC prefix the desktop bridge adds in front.
     */
    function cancellableTransport(
        frames: number,
        cancelledFailure = new Error(
            "Error invoking remote method 'sourdaw:invoke:render_graph_offline': " +
                'Error: offline-render-cancelled: the render was cancelled'
        )
    ) {
        const renderIds: (string | undefined)[] = [];
        const cancels: string[] = [];
        let cancelRender: () => void = () => {};
        let finishRender: () => void = () => {};
        const base = capturingTransport(frames).transport;
        const transport: NativeGraphTransport = {
            ...base,
            renderGraphOffline: ({ renderId }) => {
                renderIds.push(renderId);
                return new Promise<Uint8Array>((resolve, reject) => {
                    finishRender = () => resolve(new Uint8Array(frames * 8));
                    cancelRender = () => reject(cancelledFailure);
                });
            },
            cancelGraphOfflineRender: (renderId) => {
                cancels.push(renderId);
                cancelRender();
                return Promise.resolve();
            },
        };
        return {
            transport,
            renderIds,
            cancels,
            finish: () => finishRender(),
            cancelNatively: () => cancelRender(),
        };
    }

    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('cancels the render it started, by the id it started it under, and ends as Export cancelled', async () => {
        const frames = 480;
        const { transport, renderIds, cancels } = cancellableTransport(frames);
        const controller = new AbortController();

        const rendering = renderOneTrack({ transport, frames, devices: [], abortSignal: controller.signal });
        await vi.waitFor(() => expect(renderIds).toHaveLength(1));
        controller.abort();

        await expect(rendering).rejects.toThrow('Export cancelled');
        expect(renderIds[0]).toEqual(expect.any(String));
        expect(cancels).toEqual([renderIds[0]]);
    });

    it('ends as Export cancelled when the cancelled render fails for a reason of its own', async () => {
        const frames = 480;
        const { transport, renderIds } = cancellableTransport(frames, new Error('engine stream stopped'));
        const controller = new AbortController();

        const rendering = renderOneTrack({ transport, frames, devices: [], abortSignal: controller.signal });
        await vi.waitFor(() => expect(renderIds).toHaveLength(1));
        controller.abort();

        await expect(rendering).rejects.toThrow('Export cancelled');
    });

    it('ends as Export cancelled when the native side cancels the render with no signal or flag raised (#6911)', async () => {
        // Quit cancels every native render in flight from the native side:
        // no abort signal fires and no export flag is raised, so only the
        // native refusal's own text says the render was cancelled.
        const frames = 480;
        const { transport, renderIds, cancels, cancelNatively } = cancellableTransport(frames);

        const rendering = renderOneTrack({ transport, frames, devices: [] });
        await vi.waitFor(() => expect(renderIds).toHaveLength(1));
        cancelNatively();

        await expect(rendering).rejects.toThrow('Export cancelled');
        expect(cancels).toEqual([]);
    });

    it('sends no cancel for an abort after the render settled', async () => {
        const frames = 480;
        const { transport, renderIds, cancels, finish } = cancellableTransport(frames);
        const controller = new AbortController();

        const rendering = renderOneTrack({ transport, frames, devices: [], abortSignal: controller.signal });
        await vi.waitFor(() => expect(renderIds).toHaveLength(1));
        finish();
        const result = await rendering;
        controller.abort();

        expect(result.outcome).toBe('rendered');
        expect(cancels).toEqual([]);
    });

    it('sends no cancel and starts no render for an export cancelled before it reached the render', async () => {
        const frames = 480;
        const { transport, renderIds, cancels } = cancellableTransport(frames);
        const controller = new AbortController();
        controller.abort();

        await expect(
            renderOneTrack({ transport, frames, devices: [], abortSignal: controller.signal })
        ).rejects.toThrow('Export cancelled');
        expect(renderIds).toEqual([]);
        expect(cancels).toEqual([]);
    });

    it('names a fresh render id for every render', async () => {
        const frames = 480;
        const { transport, renderIds, finish } = cancellableTransport(frames);

        for (let attempt = 0; attempt < 2; attempt++) {
            const rendering = renderOneTrack({ transport, frames, devices: [] });
            await vi.waitFor(() => expect(renderIds).toHaveLength(attempt + 1));
            finish();
            await rendering;
        }

        expect(new Set(renderIds).size).toBe(2);
    });
});
