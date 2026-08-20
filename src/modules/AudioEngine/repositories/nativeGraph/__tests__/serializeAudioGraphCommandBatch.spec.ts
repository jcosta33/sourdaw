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
            ],
        });
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
