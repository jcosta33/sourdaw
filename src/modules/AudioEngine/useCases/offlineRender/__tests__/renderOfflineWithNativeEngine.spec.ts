/**
 * Native offline routing (#3082): the producer emits a bus-source send the
 * same way live `sendCommands` does (#5067), without a native addon. Device
 * parameter automation (#3776): a native body's lane reaches the batch under
 * the body's own name and the declared law, and a lane the law will not carry
 * declines the render instead of vanishing from the file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { type Clip, type Device, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: vi.fn(() => 0),
}));

import { withNativeTimelineMaterialTransport } from '../../../repositories/nativeGraph/__tests__/withNativeTimelineMaterialTransport';
import {
    type MapGraphBatchInput,
    type NativeGraphTransport,
} from '../../../repositories/nativeGraph/nativeGraphTransport';
import { type NativeGraphWireCommand } from '../../../repositories/nativeGraph/serializeAudioGraphCommand';
import { offlineDeviceParameterLawState } from '../../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { getCompensationDelay } from '../../latencyCompensation/compensation/getCompensationDelay';
import { type NativeOfflineHostedRuntime } from '../nativeOfflineHostedDevice';
import { renderOfflineWithNativeEngine, type NativeOfflineRenderInput } from '../renderOfflineWithNativeEngine';

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

describe('renderOfflineWithNativeEngine — a loaded hosted effect (#4592)', () => {
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

    it('stamps nothing for a hosted device the shared predicate does not admit, and declines its ride', async () => {
        const { transport, commands } = capturingTransport(480);
        automationStore.set({ lanes: [mixRide] });

        const result = await renderOneTrack({
            transport,
            frames: 480,
            devices: [hostedReverb],
            hostedPluginRuntime: { ...loadedEffect, pluginKind: () => 'instrument' },
        });

        expect(result.outcome).toBe('declined');
        expect(deviceWrites(commands)).toEqual([]);
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
