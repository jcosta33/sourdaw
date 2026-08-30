/**
 * What the live session actually plays (#3068).
 *
 * The producer's failure mode is the same omission the topology producer's is,
 * one level down: a clip that never becomes a `schedule-clip` is not an error
 * anywhere — it is an engine quietly playing less than the arrangement. Every
 * case here asserts a playback's presence, or names the one reason it is
 * absent.
 *
 * The arithmetic itself is not re-derived here: it is
 * `projectOfflineAudioClipPlaybacks`, the export's own, and that the two paths
 * agree end-to-end is proven by rendering both
 * (`projectLiveGraphProgrammeParity.spec.ts`). What this file owns is the
 * selection: which sources are played, which are dropped, and on what grounds.
 *
 * The clock is a flat-tempo stand-in rather than Transport's injected
 * projector, because AudioEngine may not import Transport's use cases and the
 * producer takes the projection as an argument for exactly that reason.
 */

import { describe, expect, it } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import {
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { projectLiveGraphProgramme } from '../projectLiveGraphProgramme';

const SAMPLE_RATE = 48_000;
const TEMPO = 120;
const SECONDS_PER_BEAT = 60 / TEMPO;

/** Flat tempo, rounded onto the sample grid exactly as `projectPpqEndpoints` is. */
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

const resolveTempoAtBeat: OfflineTempoAtBeatResolver = () => TEMPO;

/** jsdom has no `AudioBuffer`; the producer reads `duration` and nothing else. */
function material(durationSeconds: number): AudioBuffer {
    return { duration: durationSeconds, sampleRate: SAMPLE_RATE, numberOfChannels: 2 } as unknown as AudioBuffer;
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
        automationMode: 'read',
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

function audioClip(
    overrides: Partial<Track['clips'][number]> & { id: string; trackId: string }
): Track['clips'][number] {
    return {
        name: overrides.id,
        startBeat: 0,
        endBeat: 2,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function projectProgramme(input: {
    stripTracks: readonly Track[];
    buffers?: Record<string, AudioBuffer>;
    compensationDelaySeconds?: (stripId: string) => number;
}) {
    const buffers = input.buffers ?? {};
    return projectLiveGraphProgramme({
        stripTracks: input.stripTracks,
        sampleRate: SAMPLE_RATE,
        defaultTempo: TEMPO,
        changes: [],
        projectPpqEndpoints,
        resolveTempoAtBeat,
        readBuffer: (bufferId) => buffers[bufferId],
        compensationDelaySeconds: input.compensationDelaySeconds ?? (() => 0),
    });
}

describe('projectLiveGraphProgramme', () => {
    it('plays an ordinary audio clip where the arrangement puts it', () => {
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [
                        audioClip({
                            id: 'clip-1',
                            trackId: 'audio-1',
                            startBeat: 2,
                            endBeat: 4,
                            gain: 0.6,
                            audioBufferId: 'mat-1',
                        }),
                    ],
                }),
            ],
            buffers: { 'mat-1': material(10) },
        });

        const playbacks = programme.playbacksByStripId.get('audio-1');
        expect(playbacks).toHaveLength(1);
        expect(playbacks?.[0]).toMatchObject({
            trackId: 'audio-1',
            source: { sourceId: 'mat-1' },
            startTime: 2 * SECONDS_PER_BEAT,
            durationSeconds: 2 * SECONDS_PER_BEAT,
            playbackRate: 1,
            gain: 0.6,
        });
    });

    it('plays a frozen track’s baked buffer, and none of the clips it was baked from', () => {
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    frozen: true,
                    freezeState: { status: 'frozen', freezeId: 'freeze-1', frozenBufferId: 'bake-1' },
                    clips: [
                        audioClip({
                            id: 'clip-1',
                            trackId: 'audio-1',
                            startBeat: 2,
                            endBeat: 4,
                            audioBufferId: 'mat-1',
                        }),
                    ],
                }),
            ],
            buffers: { 'bake-1': material(3), 'mat-1': material(10) },
        });

        const playbacks = programme.playbacksByStripId.get('audio-1');
        expect(playbacks).toHaveLength(1);
        expect(playbacks?.[0]).toMatchObject({
            source: { sourceId: 'bake-1' },
            // `scheduleFrozenTrack` bakes from the track's earliest clip start.
            startTime: 2 * SECONDS_PER_BEAT,
            sourceOffsetSeconds: 0,
            durationSeconds: 3,
            gain: 1,
        });
        expect(programme.bakedStripIds.has('audio-1')).toBe(true);
    });

    it('names a frozen track whose bake is not loaded rather than playing its clips instead', () => {
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    frozen: true,
                    freezeState: { status: 'frozen', freezeId: 'freeze-1', frozenBufferId: 'bake-1' },
                    clips: [audioClip({ id: 'clip-1', trackId: 'audio-1', audioBufferId: 'mat-1' })],
                }),
            ],
            buffers: { 'mat-1': material(10) },
        });

        expect(programme.playbacksByStripId.get('audio-1')).toBeUndefined();
        expect(programme.exclusions).toEqual([
            { stripId: 'audio-1', subjectId: 'bake-1', reason: expect.stringContaining('baked buffer is not loaded') },
        ]);
    });

    it('excludes a stretched clip per clip, leaving its unstretched neighbour playing', () => {
        // `schedule-clip` refuses any non-unity rate whole-batch
        // (`stretched-clip-unsupported`), so one stretched clip must not cost
        // the session the strip it sits on, let alone every other strip.
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [
                        audioClip({
                            id: 'stretched',
                            trackId: 'audio-1',
                            startBeat: 0,
                            endBeat: 2,
                            audioBufferId: 'mat-1',
                            stretchMode: 'repitch',
                            stretchRatio: 1.5,
                        }),
                        audioClip({
                            id: 'plain',
                            trackId: 'audio-1',
                            startBeat: 4,
                            endBeat: 6,
                            audioBufferId: 'mat-1',
                        }),
                    ],
                }),
            ],
            buffers: { 'mat-1': material(10) },
        });

        const playbacks = programme.playbacksByStripId.get('audio-1');
        expect(playbacks).toHaveLength(1);
        expect(playbacks?.[0]?.startTime).toBe(4 * SECONDS_PER_BEAT);
        expect(programme.exclusions).toEqual([
            { stripId: 'audio-1', subjectId: 'stretched', reason: expect.stringContaining('cannot stretch') },
        ]);
    });

    it('names a clip whose material is not decoded, because the pool would refuse it', () => {
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [audioClip({ id: 'clip-1', trackId: 'audio-1', audioBufferId: 'missing' })],
                }),
            ],
        });

        expect(programme.playbacksByStripId.size).toBe(0);
        expect(programme.exclusions).toEqual([
            { stripId: 'audio-1', subjectId: 'clip-1', reason: expect.stringContaining('no decoded material') },
        ]);
    });

    it('schedules nothing onto a bus, which the engine refuses by name', () => {
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'bus-1',
                    kind: 'bus',
                    clips: [audioClip({ id: 'clip-1', trackId: 'bus-1', audioBufferId: 'mat-1' })],
                }),
            ],
            buffers: { 'mat-1': material(10) },
        });

        expect(programme.playbacksByStripId.size).toBe(0);
    });

    it('skips a muted clip and a MIDI clip without calling either an exclusion', () => {
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [
                        audioClip({ id: 'muted', trackId: 'audio-1', audioBufferId: 'mat-1', muted: true }),
                        audioClip({ id: 'midi', trackId: 'audio-1', startBeat: 4, endBeat: 6, type: 'midi' }),
                    ],
                }),
            ],
            buffers: { 'mat-1': material(10) },
        });

        expect(programme.playbacksByStripId.size).toBe(0);
        expect(programme.exclusions).toEqual([]);
    });

    it('shifts a playback by the strip’s latency compensation', () => {
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [
                        audioClip({
                            id: 'clip-1',
                            trackId: 'audio-1',
                            startBeat: 2,
                            endBeat: 4,
                            audioBufferId: 'mat-1',
                        }),
                    ],
                }),
            ],
            buffers: { 'mat-1': material(10) },
            compensationDelaySeconds: () => 0.25,
        });

        expect(programme.playbacksByStripId.get('audio-1')?.[0]?.startTime).toBe(2 * SECONDS_PER_BEAT + 0.25);
    });
});
