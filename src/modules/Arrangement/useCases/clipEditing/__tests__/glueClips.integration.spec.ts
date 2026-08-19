import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { defaultStepRecordState, midiStore, stepRecordStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { setWarpState, warpStates } from '../../../stores/warpStates';
import { getGlueEligibleClipPairs } from '../getGlueEligibleClipPairs';
import { glueClips } from '../glueClips';

describe('glueClips MIDI state integration', () => {
    beforeEach(() => {
        const first = ClipDummy.create({
            id: 'clip-a',
            trackId: 'track-midi',
            type: 'midi',
            startBeat: 8,
            endBeat: 12,
            midiOffsetBeats: 2,
        });
        const second = ClipDummy.create({
            id: 'clip-b',
            trackId: 'track-midi',
            type: 'midi',
            startBeat: 12,
            endBeat: 16,
            midiOffsetBeats: 1,
        });
        const track = TrackDummy.create({ id: 'track-midi', kind: 'midi', clips: [first, second] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({
            notesByClipId: {
                'clip-a': [
                    { id: 'note-a', pitch: 60, startBeat: 3, duration: 1, velocity: 100 },
                    { id: 'note-a-cropped', pitch: 62, startBeat: 1, duration: 2, velocity: 100 },
                    { id: 'note-a-hidden', pitch: 63, startBeat: 7, duration: 1, velocity: 100 },
                ],
                'clip-b': [{ id: 'note-b', pitch: 64, startBeat: 2, duration: 1, velocity: 100 }],
            },
            ccByClipId: {
                'clip-a': [{ id: 'cc-a-hidden', controller: 1, value: 0.25, beat: 6, channel: 0 }],
                'clip-b': [{ id: 'cc-b', controller: 1, value: 0.5, beat: 2, channel: 0 }],
            },
            pitchBendByClipId: {
                'clip-a': [{ id: 'bend-a-hidden', value: 0.1, beat: 6, channel: 0 }],
                'clip-b': [{ id: 'bend-b', value: 0.25, beat: 3, channel: 0 }],
            },
        });
        automationStore.set({ lanes: [] });
        takeLaneStore.set({ lanes: [] });
        stepRecordStore.set(null);
        __resetGainEnvelopesForTest();
        warpStates.clear();
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        takeLaneStore.set({ lanes: [] });
        stepRecordStore.set(null);
        __resetGainEnvelopesForTest();
        warpStates.clear();
    });

    it('projects only adjacent plain source pairs without hidden clip dependencies', () => {
        expect(getGlueEligibleClipPairs()).toEqual([['clip-a', 'clip-b']]);

        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) =>
                    clip.id === 'clip-a' ? { ...clip, stretchMode: 'timestretch' as const } : clip
                ),
            })),
        });
        expect(getGlueEligibleClipPairs()).toEqual([]);

        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) =>
                    clip.id === 'clip-a' ? { ...clip, stretchMode: 'off' as const } : clip
                ),
            })),
        });
        // A source's gain envelope no longer disqualifies the pair: it migrates
        // onto the glued clip rather than blocking the glue (ledger #2108).
        setEnvelope('clip-a', { clipId: 'clip-a', points: [], enabled: true });
        expect(getGlueEligibleClipPairs()).toEqual([['clip-a', 'clip-b']]);
    });

    it('projects an adjacent source pair across an unrelated overlapping clip', () => {
        const overlapping = ClipDummy.create({
            id: 'clip-overlap',
            trackId: 'track-midi',
            type: 'midi',
            startBeat: 9,
            endBeat: 10,
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: [track.clips[0]!, overlapping, track.clips[1]!],
            })),
        });

        expect(getGlueEligibleClipPairs()).toContainEqual(['clip-a', 'clip-b']);
    });

    it('does not advertise a pair whose MIDI rows cannot be glued', () => {
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                'clip-b': [{ id: 'note-a', pitch: 64, startBeat: 2, duration: 1, velocity: 100 }],
            },
        });

        expect(getGlueEligibleClipPairs()).toEqual([]);
        expect(glueClips(['clip-a', 'clip-b'])).toBe(false);
    });

    it('does not advertise clips whose declared owner disagrees with their containing track', () => {
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => (clip.id === 'clip-a' ? { ...clip, trackId: 'track-other' } : clip)),
            })),
        });

        expect(getGlueEligibleClipPairs()).toEqual([]);
        expect(glueClips(['clip-a', 'clip-b'])).toBe(false);
    });

    it.each(['alternative', 'ghost'] as const)(
        'does not advertise or glue a source id duplicated in a hidden %s clip',
        (hiddenLocation) => {
            const source = structuredClone(trackStore.value!.tracks[0]!.clips[0]!);
            const tracks = trackStore.value!.tracks.map((track) => {
                if (hiddenLocation !== 'alternative') {
                    return track;
                }
                return {
                    ...track,
                    alternatives: track.alternatives.map((alternative, index) =>
                        index === 0 ? { ...alternative, clips: [source] } : alternative
                    ),
                };
            });
            const ghostClips =
                hiddenLocation === 'ghost'
                    ? [
                          {
                              ...source,
                              isGhost: true,
                          },
                      ]
                    : [];
            trackStore.set({ ...trackStore.value!, tracks, ghostClips });
            const originalState = structuredClone(trackStore.value);

            expect(getGlueEligibleClipPairs()).toEqual([]);
            expect(glueClips(['clip-a', 'clip-b'])).toBe(false);
            expect(trackStore.value).toEqual(originalState);
        }
    );

    it('does not advertise or glue a source targeted by active step recording', () => {
        stepRecordStore.set({
            ...defaultStepRecordState,
            active: true,
            clipId: 'clip-a',
            activeNotes: new Set<number>(),
        });
        const originalTracks = structuredClone(trackStore.value!.tracks);
        const originalMidi = structuredClone(midiStore.value);

        expect(getGlueEligibleClipPairs()).toEqual([]);
        expect(glueClips(['clip-a', 'clip-b'])).toBe(false);
        expect(trackStore.value!.tracks).toEqual(originalTracks);
        expect(midiStore.value).toEqual(originalMidi);
    });

    it('does not glue into a generated target id used by active step recording', () => {
        const targetClipId = 'clip-generated-target';
        stepRecordStore.set({
            ...defaultStepRecordState,
            active: true,
            clipId: targetClipId,
            activeNotes: new Set<number>(),
        });
        const originalTracks = structuredClone(trackStore.value!.tracks);
        const originalMidi = structuredClone(midiStore.value);

        expect(glueClips(['clip-a', 'clip-b'], targetClipId)).toBe(false);
        expect(trackStore.value!.tracks).toEqual(originalTracks);
        expect(midiStore.value).toEqual(originalMidi);
    });

    it('rebases every source MIDI event into the glued clip local timeline', () => {
        expect(glueClips(['clip-a', 'clip-b'])).toBe(true);

        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        expect(glued).toMatchObject({ startBeat: 8, endBeat: 16, type: 'midi' });
        expect(midiStore.value!.notesByClipId[glued.id]).toMatchObject([
            { id: 'note-a-cropped', startBeat: 0, duration: 1 },
            { id: 'note-a', startBeat: 1 },
            { id: 'note-b', startBeat: 5 },
        ]);
        expect(midiStore.value!.ccByClipId[glued.id]).toMatchObject([{ id: 'cc-b', beat: 5 }]);
        expect(midiStore.value!.pitchBendByClipId[glued.id]).toMatchObject([{ id: 'bend-b', beat: 6 }]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([glued.id]);
    });

    it('retires a source clip automation lane instead of refusing the glue or stranding the lane (regression #2108)', () => {
        automationStore.set({
            lanes: [
                {
                    id: 'lane-clip-a-gain',
                    trackId: 'track-midi',
                    clipId: 'clip-a',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ id: 'point-a', beat: 9, value: 0.5, curve: 'linear', tension: 0.5 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        expect(glueClips(['clip-a', 'clip-b'])).toBe(true);

        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        // No coherent per-clip merge exists for automation: the source's lane
        // is retired rather than migrated onto the glued clip.
        expect(automationStore.value!.lanes).toEqual([]);
        expect(midiStore.value!.notesByClipId).not.toHaveProperty('clip-a');
        expect(midiStore.value!.notesByClipId).toHaveProperty(glued.id);
    });

    it('migrates the FIRST source clip gain envelope onto the glued clip (regression #2108)', () => {
        // clip-a starts at beat 8, clip-b at beat 12 — clip-a sorts first.
        const gainEnvelope = { clipId: 'clip-a', enabled: true, points: [{ id: 'p1', beatOffset: 0, gainDb: -6 }] };
        setEnvelope('clip-a', gainEnvelope);

        expect(glueClips(['clip-a', 'clip-b'])).toBe(true);

        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        expect(getEnvelope('clip-a')).toBeUndefined();
        expect(getEnvelope(glued.id)).toEqual({ ...gainEnvelope, clipId: glued.id });
    });

    it('retires the SECOND source clip gain envelope and warp state instead of migrating them (regression #2108)', () => {
        setEnvelope('clip-b', { clipId: 'clip-b', enabled: true, points: [{ id: 'p1', beatOffset: 0, gainDb: -3 }] });
        setWarpState('clip-b', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 0, warpedBeat: 0 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });

        expect(glueClips(['clip-a', 'clip-b'])).toBe(true);

        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        expect(getEnvelope('clip-b')).toBeUndefined();
        expect(warpStates.has('clip-b')).toBe(false);
        // Only the first source migrates its satellites — the glued clip must
        // not inherit the second source's envelope or warp state.
        expect(getEnvelope(glued.id)).toBeUndefined();
        expect(warpStates.has(glued.id)).toBe(false);
    });

    it('refuses glue while an active comp region depends on a source clip take', () => {
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-track-midi',
                    trackId: 'track-midi',
                    takes: [
                        {
                            id: 'take-clip-a',
                            clipId: 'clip-a',
                            name: 'Take A',
                            startBeat: 8,
                            endBeat: 12,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: 'take-clip-a' }],
                },
            ],
        });
        const previousTakeLanes = structuredClone(takeLaneStore.value);

        expect(glueClips(['clip-a', 'clip-b'])).toBe(false);

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
        expect(midiStore.value!.notesByClipId).toHaveProperty('clip-a');
        expect(midiStore.value!.notesByClipId).toHaveProperty('clip-b');
        expect(takeLaneStore.value).toEqual(previousTakeLanes);
    });

    it('preserves an unrelated take lane while gluing the selected clips', () => {
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-unrelated',
                    trackId: 'track-unrelated',
                    takes: [
                        {
                            id: 'take-unrelated',
                            clipId: 'clip-unrelated',
                            name: 'Unrelated take',
                            startBeat: 20,
                            endBeat: 24,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 20, endBeat: 24, takeId: 'take-unrelated' }],
                },
            ],
        });
        const previousTakeLanes = structuredClone(takeLaneStore.value);

        expect(glueClips(['clip-a', 'clip-b'])).toBe(true);

        expect(trackStore.value!.tracks[0]!.clips).toHaveLength(1);
        expect(takeLaneStore.value).toEqual(previousTakeLanes);
    });

    it('refuses glue when another clip is linked to a source', () => {
        const linked = ClipDummy.create({
            id: 'clip-linked',
            trackId: 'track-child',
            type: 'midi',
            parentClipId: 'clip-a',
            isLinkedInstance: true,
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                ...trackStore.value!.tracks,
                TrackDummy.create({ id: 'track-child', kind: 'midi', clips: [linked] }),
            ],
        });

        expect(glueClips(['clip-a', 'clip-b'])).toBe(false);

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
        expect(trackStore.value!.tracks[1]!.clips).toMatchObject([{ id: 'clip-linked', parentClipId: 'clip-a' }]);
    });

    it('refuses glue when a ghost clip is linked to a source', () => {
        const ghost = ClipDummy.create({
            id: 'clip-ghost',
            trackId: 'track-midi',
            type: 'midi',
            parentClipId: 'clip-a',
            isGhost: true,
        });
        trackStore.set({ ...trackStore.value!, ghostClips: [ghost] });

        expect(glueClips(['clip-a', 'clip-b'])).toBe(false);

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
        expect(trackStore.value!.ghostClips).toMatchObject([{ id: 'clip-ghost', parentClipId: 'clip-a' }]);
    });
});
