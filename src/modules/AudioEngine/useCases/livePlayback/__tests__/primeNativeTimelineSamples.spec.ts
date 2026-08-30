/**
 * The prime pass: what it sends, and what it refuses to spend (#3068).
 *
 * The doubles are the two repository roots the use case is allowed to know
 * about — `probeNativeGraphTransport` for whether a native engine is reachable,
 * and the sample pool for the registration itself. Everything between them is
 * the real thing: the real `trackStore`, the real projector, the real
 * programme. That is deliberate, because the property worth proving is that the
 * primed set is the *projected* set — the same batch the play gesture will
 * send — rather than a second rule about which buffers a project needs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphCommand } from '../../../models/AudioGraphBackend';
import { type NativeGraphAvailability } from '../../../repositories/nativeGraph/probeNativeGraphTransport';
import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
} from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { primeNativeTimelineSamples } from '../primeNativeTimelineSamples';

const SAMPLE_RATE = 48_000;
const TEMPO = 120;
const SECONDS_PER_BEAT = 60 / TEMPO;

const mocks = vi.hoisted(() => ({
    availability: null as unknown,
    /** Counted, because a prime with nothing to send must not pay for a probe. */
    probes: vi.fn(),
    registerNativeTimelineSamples: vi.fn<(input: { commands: readonly unknown[] }) => Promise<unknown>>(),
    audioBuffers: new Map<string, unknown>(),
}));

vi.mock('../../../repositories/nativeGraph/probeNativeGraphTransport', () => ({
    probeNativeGraphTransport: () => {
        mocks.probes();
        return Promise.resolve(mocks.availability as NativeGraphAvailability);
    },
}));
vi.mock('../../../repositories/nativeGraph/nativeTimelineSamplePool', () => ({
    registerNativeTimelineSamples: (input: { commands: readonly unknown[] }) =>
        mocks.registerNativeTimelineSamples(input),
}));
vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: (id: string) => mocks.audioBuffers.get(id),
        has: (id: string) => mocks.audioBuffers.has(id),
        set: () => undefined,
    },
}));

/** jsdom has no `AudioBuffer`; the projection reads only `duration`. */
const MATERIAL = { duration: 2, sampleRate: SAMPLE_RATE, numberOfChannels: 1, length: 2 * SAMPLE_RATE } as AudioBuffer;

const projectPpqEndpoints: OfflinePpqEndpointProjector = ({ startPpq, endPpq, sampleRate }) => {
    const startSamples = Math.round(startPpq * SECONDS_PER_BEAT * sampleRate);
    const endSamples = Math.round(endPpq * SECONDS_PER_BEAT * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
};

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

/** A track holding one two-beat audio clip of `bufferId`. */
function trackPlaying(bufferId: string, overrides?: Partial<Track>): Track {
    return createTrack({
        ...overrides,
        clips: [
            {
                id: `clip-${bufferId}`,
                trackId: overrides?.id ?? 'track-1',
                name: `clip-${bufferId}`,
                startBeat: 0,
                endBeat: 2,
                type: 'audio',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#00ff00',
                locked: false,
                muted: false,
                audioBufferId: bufferId,
            } as Track['clips'][number],
        ],
    });
}

function setTracks(tracks: readonly Track[]): void {
    trackStore.set({ tracks: [...tracks], selectedTrackId: null, ghostClips: [] });
}

/** The sample ids the batch handed to the pool actually names. */
function primedSourceIds(): string[] {
    const [input] = mocks.registerNativeTimelineSamples.mock.calls.at(-1) ?? [];
    return ((input?.commands ?? []) as readonly AudioGraphCommand[]).flatMap((command) =>
        command.kind === 'schedule-clip' ? [command.playback.source.sourceId] : []
    );
}

beforeEach(() => {
    mocks.availability = { available: true, transport: {} };
    mocks.probes.mockClear();
    mocks.registerNativeTimelineSamples.mockReset();
    mocks.registerNativeTimelineSamples.mockResolvedValue({ outcome: 'registered', sampleIds: ['mat-a'] });
    mocks.audioBuffers = new Map<string, unknown>([['mat-a', MATERIAL]]);
    offlinePpqEndpointProjectorState.project = projectPpqEndpoints;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = () => TEMPO;
    setTracks([trackPlaying('mat-a')]);
});

afterEach(() => {
    offlinePpqEndpointProjectorState.project = null;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = null;
    setTracks([]);
});

describe('primeNativeTimelineSamples', () => {
    it('registers the material the batch a play gesture would send actually names', async () => {
        const result = await primeNativeTimelineSamples({ sampleRate: SAMPLE_RATE });

        expect(result).toEqual({ outcome: 'primed', sampleIds: ['mat-a'] });
        expect(primedSourceIds()).toEqual(['mat-a']);
    });

    it('spends no bridge round trip on a project with nothing to schedule', async () => {
        // This runs on every project edit, and most edits add no material. A
        // probe here would put a bridge call behind every fader move.
        setTracks([createTrack({ id: 'empty' })]);

        const result = await primeNativeTimelineSamples({ sampleRate: SAMPLE_RATE });

        expect(result).toEqual({ outcome: 'primed', sampleIds: [] });
        expect(mocks.probes).not.toHaveBeenCalled();
        expect(mocks.registerNativeTimelineSamples).not.toHaveBeenCalled();
    });

    it('declines with the probe’s reason when there is no native engine to prime', async () => {
        // A browser build is the ordinary case, and it is a platform fact
        // rather than a fault.
        mocks.availability = { available: false, reason: 'no desktop runtime' };

        const result = await primeNativeTimelineSamples({ sampleRate: SAMPLE_RATE });

        expect(result).toEqual({ outcome: 'declined', reason: 'no desktop runtime' });
        expect(mocks.registerNativeTimelineSamples).not.toHaveBeenCalled();
    });

    it('declines with the registration’s reason rather than reporting material it never sent', async () => {
        mocks.registerNativeTimelineSamples.mockResolvedValue({
            outcome: 'declined',
            reason: 'register_timeline_sample "mat-a": the bridge is closed',
        });

        const result = await primeNativeTimelineSamples({ sampleRate: SAMPLE_RATE });

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'register_timeline_sample "mat-a": the bridge is closed',
        });
    });

    it('primes nothing when the clock it would place the programme on is unconfigured', async () => {
        // `readLiveGraphProgramme` answers no programme rather than a guessed
        // one, and a prime with no programme has nothing to register.
        offlinePpqEndpointProjectorState.project = null;

        const result = await primeNativeTimelineSamples({ sampleRate: SAMPLE_RATE });

        expect(result).toEqual({ outcome: 'primed', sampleIds: [] });
        expect(mocks.probes).not.toHaveBeenCalled();
    });
});
