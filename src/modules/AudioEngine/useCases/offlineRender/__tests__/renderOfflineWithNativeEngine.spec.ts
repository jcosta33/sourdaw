/**
 * Native offline routing (#3082): the producer must drop a bus-source send
 * the same way live `sendCommands` does, without a native addon. Device
 * parameter automation (#3776): a native body's lane reaches the batch under
 * the body's own name and the declared law, and a lane the law will not carry
 * declines the render instead of vanishing from the file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: vi.fn(() => 0),
}));

import {
    type MapGraphBatchInput,
    type NativeGraphTransport,
} from '../../../repositories/nativeGraph/nativeGraphTransport';
import { type NativeGraphWireCommand } from '../../../repositories/nativeGraph/serializeAudioGraphCommand';
import { offlineDeviceParameterLawState } from '../../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { getCompensationDelay } from '../../latencyCompensation/compensation/getCompensationDelay';
import { renderOfflineWithNativeEngine } from '../renderOfflineWithNativeEngine';

class StubAudioBuffer {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    readonly duration: number;
    private readonly channels: Float32Array[];

    constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
        this.length = options.length;
        this.numberOfChannels = options.numberOfChannels;
        this.sampleRate = options.sampleRate;
        this.duration = options.length / options.sampleRate;
        this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
    }

    getChannelData(channel: number): Float32Array {
        const data = this.channels[channel];
        if (!data) {
            throw new Error(`StubAudioBuffer has no channel ${String(channel)}`);
        }
        return data;
    }

    copyToChannel(source: Float32Array, channel: number): void {
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
    return { transport, commands };
}

describe('renderOfflineWithNativeEngine — routing', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioBuffer', StubAudioBuffer);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('emits a track send and drops a bus-source send to another built bus', async () => {
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
});
