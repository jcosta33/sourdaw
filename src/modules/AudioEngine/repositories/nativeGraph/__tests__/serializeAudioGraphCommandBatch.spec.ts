/**
 * The wire mirror, pinned as literals.
 *
 * `graph.rs` deserializes with `#[serde(tag = "kind", rename_all =
 * "kebab-case")]` and camelCase fields, and this file states the resulting
 * spellings as expected objects rather than deriving them — a derivation
 * compared against itself asserts nothing, which is the same reason
 * `commands.spec.ts` writes its argument table out by hand.
 */
import { describe, expect, it } from 'vitest';

import { type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { collectBufferedClipSources } from '../collectBufferedClipSources';
import { serializeAudioGraphCommandBatch } from '../serializeAudioGraphCommandBatch';

/** The smallest thing that reads as decoded material for this seam. */
function fakeAudioBuffer(frames: number): AudioBuffer {
    const stub = {
        numberOfChannels: 2,
        length: frames,
        sampleRate: 48_000,
        getChannelData: () => new Float32Array(frames),
    };
    // The serializer never dereferences the buffer — stripping it is the law
    // under test — so a structural stub carries the identity well enough.
    return stub as unknown as AudioBuffer;
}

describe('serializeAudioGraphCommandBatch', () => {
    it('serializes every command kind onto the graph.rs wire spellings', () => {
        const buffer = fakeAudioBuffer(16);
        const batch: AudioGraphCommandBatch = {
            schemaVersion: 1,
            correlation: { appRevision: 3, projectRevision: 'rev-9' },
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 'track-1',
                    name: 'Track',
                    state: { gain: 0.8, pan: -31, muted: false, soloGated: true, vcaMultiplier: 0.9 },
                    devices: [
                        {
                            id: 'dev-knead',
                            name: 'Knead',
                            type: 'knead',
                            bypassed: false,
                            parameterValues: { shift_semitones: 3 },
                            // Opaque web-hydrator state: must not cross.
                            deviceState: { blob: Symbol('opaque') },
                        },
                    ],
                    honorMuted: true,
                    contributesAudio: true,
                },
                {
                    kind: 'create-bus-strip',
                    busId: 'bus-1',
                    name: 'Bus',
                    state: { gain: 0.9, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
                { kind: 'set-track-output', trackId: 'bus-1', target: { kind: 'master' } },
                { kind: 'set-track-output', trackId: 'track-1', target: { kind: 'bus', busId: 'bus-1' } },
                { kind: 'add-send', trackId: 'track-1', busId: 'bus-1', tap: 'pre-fader', level: 0.62 },
                { kind: 'remove-send', trackId: 'track-1', busId: 'bus-1' },
                {
                    kind: 'insert-device',
                    trackId: 'track-1',
                    device: {
                        id: 'dev-ext',
                        name: 'External',
                        type: 'clap-thing',
                        bypassed: true,
                        parameterValues: {},
                        externalPluginId: 'plugin-7',
                        externalInstanceId: 'instance-4',
                    },
                    index: 1,
                },
                { kind: 'remove-device', trackId: 'track-1', deviceId: 'dev-ext' },
                {
                    kind: 'write-parameter',
                    target: { kind: 'track-fader', trackId: 'track-1' },
                    write: { shape: 'ramp-to', value: 0.42, startTime: 0.15, landTime: 0.25 },
                },
                {
                    kind: 'write-device-parameter',
                    target: {
                        kind: 'device-parameter',
                        trackId: 'track-1',
                        deviceId: 'dev-knead',
                        parameterId: 'shift_semitones',
                    },
                    write: { shape: 'step', value: -2, time: 0.5 },
                },
                {
                    kind: 'set-device-parameters',
                    target: { trackId: 'track-1', deviceId: 'dev-knead' },
                    values: { formant_preserve: 1 },
                },
                {
                    kind: 'schedule-clip',
                    playback: {
                        trackId: 'track-1',
                        source: { sourceId: 'take-1', buffer },
                        startTime: 0.05,
                        sourceOffsetSeconds: 0.02,
                        durationSeconds: 0.4,
                        playbackRate: 1,
                        gain: 0.7,
                        fade: {
                            fadeIn: { reachesFullAt: 0.11 },
                            fadeOut: {},
                            microFadeSeconds: 0.003,
                        },
                    },
                },
                { kind: 'set-transport', playing: true, positionSeconds: 1.5 },
                { kind: 'set-monitor-shadow', shadowed: true },
                { kind: 'set-master-gain', gain: 0.6 },
            ],
        };

        expect(serializeAudioGraphCommandBatch(batch)).toEqual({
            schemaVersion: 1,
            correlation: { appRevision: 3, projectRevision: 'rev-9' },
            commands: [
                {
                    kind: 'create-track-strip',
                    trackId: 'track-1',
                    name: 'Track',
                    state: { gain: 0.8, pan: -31, muted: false, soloGated: true, vcaMultiplier: 0.9 },
                    devices: [
                        {
                            id: 'dev-knead',
                            name: 'Knead',
                            type: 'knead',
                            bypassed: false,
                            parameterValues: { shift_semitones: 3 },
                        },
                    ],
                    honorMuted: true,
                    contributesAudio: true,
                },
                {
                    kind: 'create-bus-strip',
                    busId: 'bus-1',
                    name: 'Bus',
                    state: { gain: 0.9, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
                { kind: 'set-track-output', trackId: 'bus-1', target: { kind: 'master' } },
                { kind: 'set-track-output', trackId: 'track-1', target: { kind: 'bus', busId: 'bus-1' } },
                { kind: 'add-send', trackId: 'track-1', busId: 'bus-1', tap: 'pre-fader', level: 0.62 },
                { kind: 'remove-send', trackId: 'track-1', busId: 'bus-1' },
                {
                    kind: 'insert-device',
                    trackId: 'track-1',
                    device: {
                        id: 'dev-ext',
                        name: 'External',
                        type: 'clap-thing',
                        bypassed: true,
                        parameterValues: {},
                        externalPluginId: 'plugin-7',
                        externalInstanceId: 'instance-4',
                    },
                    index: 1,
                },
                { kind: 'remove-device', trackId: 'track-1', deviceId: 'dev-ext' },
                {
                    kind: 'write-parameter',
                    target: { kind: 'track-fader', trackId: 'track-1' },
                    write: { shape: 'ramp-to', value: 0.42, startTime: 0.15, landTime: 0.25 },
                },
                {
                    kind: 'write-device-parameter',
                    target: {
                        kind: 'device-parameter',
                        trackId: 'track-1',
                        deviceId: 'dev-knead',
                        parameterId: 'shift_semitones',
                    },
                    write: { shape: 'step', value: -2, time: 0.5 },
                },
                {
                    kind: 'set-device-parameters',
                    trackId: 'track-1',
                    deviceId: 'dev-knead',
                    values: { formant_preserve: 1 },
                },
                {
                    kind: 'schedule-clip',
                    playback: {
                        trackId: 'track-1',
                        // The buffer is the web realisation and stays behind.
                        source: { sourceId: 'take-1' },
                        startTime: 0.05,
                        sourceOffsetSeconds: 0.02,
                        durationSeconds: 0.4,
                        playbackRate: 1,
                        gain: 0.7,
                        fade: {
                            fadeIn: { reachesFullAt: 0.11 },
                            fadeOut: {},
                            microFadeSeconds: 0.003,
                        },
                    },
                },
                { kind: 'set-transport', playing: true, positionSeconds: 1.5 },
                { kind: 'set-monitor-shadow', shadowed: true },
                { kind: 'set-master-gain', gain: 0.6 },
            ],
        });
    });

    /**
     * A hosted plugin declares no parameter names. Its parameters are the
     * plugin's own numeric ids, which the producer spells as strings (#3568),
     * and the mapper looks the parameter up by that exact spelling. A
     * serializer that renamed, trimmed or renumbered it would address a
     * parameter the plugin does not have, and the write would be dropped by the
     * engine rather than refused here.
     */
    it('carries a hosted plugin’s numeric parameter id onto the wire exactly as spelled', () => {
        const batch: AudioGraphCommandBatch = {
            schemaVersion: 1,
            commands: [
                {
                    kind: 'write-device-parameter',
                    target: {
                        kind: 'device-parameter',
                        trackId: 'track-1',
                        deviceId: 'dev-plugin',
                        parameterId: '7',
                    },
                    write: { shape: 'step', value: 0.25, time: 1.5 },
                },
            ],
        };

        const wire = serializeAudioGraphCommandBatch(batch);

        expect(wire.commands).toEqual([
            {
                kind: 'write-device-parameter',
                target: {
                    kind: 'device-parameter',
                    trackId: 'track-1',
                    deviceId: 'dev-plugin',
                    parameterId: '7',
                },
                write: { shape: 'step', value: 0.25, time: 1.5 },
            },
        ]);
    });

    /**
     * The same flattening as `schedule-midi`, and one more thing the mapper
     * depends on: `values` are the built-in's own native parameter names, which
     * `graph.rs` looks up by their exact spelling. A serializer that renamed,
     * cased or dropped a key would address a parameter the body does not have.
     */
    it('flattens an immediate device-parameter batch onto the graph.rs set-device-parameters spelling', () => {
        const wire = serializeAudioGraphCommandBatch({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'set-device-parameters',
                    target: { trackId: 'track-1', deviceId: 'dev-ferm' },
                    values: { active_layer: 1, cutoff: 0.3, num_layers: 2 },
                },
            ],
        });

        const written = wire.commands[0];
        if (written?.kind !== 'set-device-parameters') {
            throw new Error('the batch must serialize as set-device-parameters');
        }
        expect(written).toEqual({
            kind: 'set-device-parameters',
            trackId: 'track-1',
            deviceId: 'dev-ferm',
            values: { active_layer: 1, cutoff: 0.3, num_layers: 2 },
        });
        // Flattened, not nested: the mirror has no `target` field to read.
        expect(Object.keys(written)).toEqual(['kind', 'trackId', 'deviceId', 'values']);
    });

    /**
     * The same flattening for a live note, and one more thing the mapper turns
     * on: a note carries no timeline position, so every field it does carry is
     * the whole of what the engine has to place it by.
     */
    it('flattens a live note batch onto the graph.rs send-midi-note spelling', () => {
        const wire = serializeAudioGraphCommandBatch({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'send-midi-note',
                    target: { trackId: 'track-1', deviceId: 'dev-plugin' },
                    note: 60,
                    velocity: 100,
                    channel: 5,
                    isNoteOn: true,
                },
            ],
        });

        const sent = wire.commands[0];
        if (sent?.kind !== 'send-midi-note') {
            throw new Error('the batch must serialize as send-midi-note');
        }
        expect(sent).toEqual({
            kind: 'send-midi-note',
            trackId: 'track-1',
            deviceId: 'dev-plugin',
            note: 60,
            velocity: 100,
            channel: 5,
            isNoteOn: true,
        });
        // Flattened, not nested: the mirror has no `target` field to read.
        expect(Object.keys(sent)).toEqual(['kind', 'trackId', 'deviceId', 'note', 'velocity', 'channel', 'isNoteOn']);
    });

    /**
     * The contract nests the strip and the device in a target; `graph.rs` reads
     * them as the variant's own fields. That flattening is the whole of what
     * this serializer does for the command, so it is stated as literals.
     */
    it('flattens a scheduled note batch onto the graph.rs schedule-midi spelling', () => {
        const wire = serializeAudioGraphCommandBatch({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'schedule-midi',
                    target: { trackId: 'track-1', deviceId: 'dev-plugin' },
                    probabilitySeed: 0xdecafbad,
                    notes: [
                        {
                            time: 0.25,
                            note: 60,
                            velocity: 100,
                            channel: 1,
                            isNoteOn: true,
                            probability: 0.5,
                            clipIdHash: 11,
                            eventIdHash: 22,
                            absoluteOccurrenceIndex: 33,
                        },
                        // Everything optional left unstated: absence is the
                        // contract's "always plays", and it must stay absent.
                        { time: 0.5, note: 60, velocity: 0, channel: 1, isNoteOn: false },
                    ],
                },
            ],
        });

        const scheduled = wire.commands[0];
        if (scheduled?.kind !== 'schedule-midi') {
            throw new Error('the batch must serialize as schedule-midi');
        }
        expect(scheduled).toEqual({
            kind: 'schedule-midi',
            trackId: 'track-1',
            deviceId: 'dev-plugin',
            // A project value: one per command, never one per note.
            probabilitySeed: 0xdecafbad,
            notes: [
                {
                    time: 0.25,
                    note: 60,
                    velocity: 100,
                    channel: 1,
                    isNoteOn: true,
                    probability: 0.5,
                    clipIdHash: 11,
                    eventIdHash: 22,
                    absoluteOccurrenceIndex: 33,
                },
                { time: 0.5, note: 60, velocity: 0, channel: 1, isNoteOn: false },
            ],
        });
        // `toEqual` reads an explicit `undefined` as absence; the mirror does
        // not, so the keys themselves are what say the optionals stayed off.
        expect(Object.keys(scheduled.notes[1] ?? {})).toEqual(['time', 'note', 'velocity', 'channel', 'isNoteOn']);
    });

    it('carries a clear-midi window onto the wire with an open end left null', () => {
        const wire = serializeAudioGraphCommandBatch({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'clear-midi',
                    target: { trackId: 'track-1', deviceId: 'dev-plugin' },
                    fromTime: 1,
                    toTime: 2,
                },
                {
                    kind: 'clear-midi',
                    target: { trackId: 'track-1', deviceId: 'dev-plugin' },
                    fromTime: 0,
                    // The end of the store, which is what clears it whole.
                    toTime: null,
                },
            ],
        });

        expect(wire.commands).toEqual([
            { kind: 'clear-midi', trackId: 'track-1', deviceId: 'dev-plugin', fromTime: 1, toTime: 2 },
            { kind: 'clear-midi', trackId: 'track-1', deviceId: 'dev-plugin', fromTime: 0, toTime: null },
        ]);
    });

    it('leaves an absent correlation absent — absence is meaningful in the contract', () => {
        const wire = serializeAudioGraphCommandBatch({ schemaVersion: 1, commands: [] });

        expect('correlation' in wire).toBe(false);
    });

    it('keeps an absent fade side absent and a time-less side empty, never invented', () => {
        const wire = serializeAudioGraphCommandBatch({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'schedule-clip',
                    playback: {
                        trackId: 'track-1',
                        source: { sourceId: 'take-1' },
                        startTime: 0,
                        sourceOffsetSeconds: 0,
                        durationSeconds: 0.5,
                        playbackRate: 1,
                        gain: 1,
                        // No fadeIn: this playback continues an unbroken sound.
                        fade: { fadeOut: {}, microFadeSeconds: 0 },
                    },
                },
            ],
        });

        expect(wire.commands[0]).toEqual({
            kind: 'schedule-clip',
            playback: {
                trackId: 'track-1',
                source: { sourceId: 'take-1' },
                startTime: 0,
                sourceOffsetSeconds: 0,
                durationSeconds: 0.5,
                playbackRate: 1,
                gain: 1,
                fade: { fadeOut: {}, microFadeSeconds: 0 },
            },
        });
    });
});

describe('collectBufferedClipSources', () => {
    it('collects each buffered source once, first appearance winning', () => {
        const first = fakeAudioBuffer(8);
        const again = fakeAudioBuffer(4);
        const playbackOf = (sourceId: string, buffer?: AudioBuffer) =>
            ({
                kind: 'schedule-clip',
                playback: {
                    trackId: 'track-1',
                    source: buffer ? { sourceId, buffer } : { sourceId },
                    startTime: 0,
                    sourceOffsetSeconds: 0,
                    durationSeconds: 0.1,
                    playbackRate: 1,
                    gain: 1,
                    fade: { microFadeSeconds: 0 },
                },
            }) as const;

        const sources = collectBufferedClipSources([
            playbackOf('take-1', first),
            playbackOf('take-1', again),
            // Identity only: the pool may already hold it, so nothing to send.
            playbackOf('take-2'),
            { kind: 'set-transport', playing: true, positionSeconds: 0 },
        ]);

        expect(sources).toEqual([{ sourceId: 'take-1', buffer: first }]);
    });
});
