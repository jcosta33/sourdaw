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
import { MICRO_FADE_SECONDS } from '../../offlineRender/constants';
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

/** jsdom has no `AudioBuffer`; the producer reads its length and its shape. */
function material(durationSeconds: number): AudioBuffer {
    return {
        duration: durationSeconds,
        length: Math.round(durationSeconds * SAMPLE_RATE),
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 2,
    } as unknown as AudioBuffer;
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

/**
 * The one ceiling a producer owes the engine: a strip holds `MAX_TRACK_CLIPS`.
 *
 * A `schedule-clip` past it is a refusal, and a refusal is whole-batch — so what
 * these hold is that one pathological clip costs itself and nothing else.
 */
describe('projectLiveGraphProgramme — what one clip may cost', () => {
    /** A clip that expands into `iterations` loop passes of one beat each. */
    function loopingClip(input: { id: string; startBeat: number; iterations: number }): Track['clips'][number] {
        return audioClip({
            id: input.id,
            trackId: 'audio-1',
            startBeat: input.startBeat,
            endBeat: input.startBeat + input.iterations,
            loopEnabled: true,
            loopLength: 1,
            audioBufferId: 'mat-1',
        });
    }

    function programmeFor(clips: readonly Track['clips'][number][], materialSeconds = 2) {
        return projectProgramme({
            stripTracks: [createTrack({ id: 'audio-1', name: 'Looper', clips: [...clips] })],
            buffers: { 'mat-1': material(materialSeconds) },
        });
    }

    it('carries a one-bar loop dragged across a four-minute arrangement, which is ordinary arranging', () => {
        // 120 loop passes over one take, well inside the strip's 1024 slots.
        const programme = programmeFor([loopingClip({ id: 'ordinary', startBeat: 0, iterations: 120 })]);

        expect(programme.playbacksByStripId.get('audio-1')).toHaveLength(120);
        expect(programme.exclusions).toEqual([]);
    });

    it('carries a long take whatever its material costs, because the engine shares one copy of it', () => {
        // Twenty minutes of stereo material, scheduled whole. The engine holds
        // that allocation once for every clip cut from it (`TimelineClip` takes
        // an `Arc<[f32]>`), so length is not a producer's business.
        const programme = programmeFor(
            [audioClip({ id: 'long-take', trackId: 'audio-1', startBeat: 0, endBeat: 2, audioBufferId: 'mat-1' })],
            1_200
        );

        expect(programme.playbacksByStripId.get('audio-1')).toHaveLength(1);
        expect(programme.exclusions).toEqual([]);
    });

    it('fills a track’s 1024 native clip slots exactly and admits every one of them', () => {
        // The engine's own ceiling is per strip (`MAX_TRACK_CLIPS`), so it is
        // spent across a track's clips rather than by any one of them.
        const clips = Array.from({ length: 16 }, (_unused, index) =>
            loopingClip({ id: `filler-${String(index)}`, startBeat: index * 100, iterations: 64 })
        );

        const programme = programmeFor(clips);

        expect(programme.playbacksByStripId.get('audio-1')).toHaveLength(1024);
        expect(programme.exclusions).toEqual([]);
    });

    it('excludes the clip that would overflow those slots, leaving the ones that fit playing', () => {
        const clips = [
            ...Array.from({ length: 16 }, (_unused, index) =>
                loopingClip({ id: `filler-${String(index)}`, startBeat: index * 100, iterations: 64 })
            ),
            loopingClip({ id: 'overflow', startBeat: 1_700, iterations: 2 }),
        ];

        const programme = programmeFor(clips);

        expect(programme.playbacksByStripId.get('audio-1')).toHaveLength(1024);
        expect(programme.exclusions).toEqual([
            {
                stripId: 'audio-1',
                subjectId: 'overflow',
                reason: expect.stringContaining('needs 2 of the 0 native clip slots'),
            },
        ]);
    });
});

/**
 * Fades, against the bounds the playback actually has.
 *
 * Two ordinary edits pull a clip's fade endpoints outside its own sound, and
 * the native mapper refuses both by name — whole-batch. See
 * `projectNativeClipFade`.
 */
describe('projectLiveGraphProgramme — fades the engine can take', () => {
    it('leaves an ordinary clip’s fade endpoints exactly where the arrangement drew them', () => {
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [
                        audioClip({
                            id: 'clip-1',
                            trackId: 'audio-1',
                            startBeat: 2,
                            endBeat: 6,
                            fadeInBeats: 1,
                            fadeOutBeats: 1,
                            audioBufferId: 'mat-1',
                        }),
                    ],
                }),
            ],
            buffers: { 'mat-1': material(10) },
        });

        expect(programme.playbacksByStripId.get('audio-1')?.[0]?.fade).toMatchObject({
            fadeIn: { reachesFullAt: 3 * SECONDS_PER_BEAT },
            fadeOut: { beginsAt: 5 * SECONDS_PER_BEAT },
        });
    });

    it('pulls a slipped clip’s fade-in up to the first frame anyone hears', () => {
        // A negative `audioOffsetBeats` puts the clip's head before the start
        // of its material, so the sound begins a silent span later than the
        // clip does, and the clip's 0.5-beat fade-in is entirely inside that
        // silent pre-roll — it requests a non-positive duration once measured
        // from the playback's own start. The shared fade law
        // (`clampClipFadeInDurationSeconds`) floors that to the anti-click
        // micro-fade rather than dropping it, so the ramp collapses to the
        // first audible frame plus `MICRO_FADE_SECONDS`, not vanishing — the
        // same floor the Web Audio legs and the engine's own resolve apply.
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [
                        audioClip({
                            id: 'slipped',
                            trackId: 'audio-1',
                            startBeat: 2,
                            endBeat: 6,
                            fadeInBeats: 0.5,
                            audioOffsetBeats: -1,
                            audioBufferId: 'mat-1',
                        }),
                    ],
                }),
            ],
            buffers: { 'mat-1': material(10) },
        });

        const playback = programme.playbacksByStripId.get('audio-1')?.[0];
        // One beat of pre-roll at 120 BPM: the sound starts half a second late.
        expect(playback?.startTime).toBe(2 * SECONDS_PER_BEAT + SECONDS_PER_BEAT);
        expect(playback?.fade.fadeIn?.reachesFullAt).toBeCloseTo((playback?.startTime ?? 0) + MICRO_FADE_SECONDS, 10);
    });

    it('pulls a truncated clip’s fade-out back to the last frame anyone hears', () => {
        // The clip is four seconds long and its material is one, so the
        // playback is clamped to what the buffer holds. The user's fade-out
        // still points at the clip's visual end, which the mapper refuses as
        // beginning after the clip ends.
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [
                        audioClip({
                            id: 'truncated',
                            trackId: 'audio-1',
                            startBeat: 0,
                            endBeat: 8,
                            fadeOutBeats: 1,
                            audioBufferId: 'mat-1',
                        }),
                    ],
                }),
            ],
            buffers: { 'mat-1': material(1) },
        });

        const playback = programme.playbacksByStripId.get('audio-1')?.[0];
        expect(playback?.durationSeconds).toBe(1);
        expect(playback?.fade.fadeOut).toEqual({ beginsAt: 1 });
    });
});
