import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { defaultStepRecordState, midiStore, stepRecordStore } from '#/modules/MIDI/stores';
import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { isGeneratedMidiStateCurrent } from '../../../handlers/isGeneratedMidiStateCurrent';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { removeWarpState, setWarpState, warpStates } from '../../../stores/warpStates';
import { duplicateClipCore } from '../../clip/duplicateClipCore';
import { addManualWarpMarker } from '../../warp/addManualWarpMarker';
import { enableWarp } from '../../warp/enableWarp';
import { setStretchMode } from '../../warp/setStretchMode';
import { getGlueEligibleClipPairs } from '../getGlueEligibleClipPairs';
import { glueClips } from '../glueClips';
import { hasClipGlueDependencies } from '../hasClipGlueDependencies';
import { prepareClipGlue } from '../prepareClipGlue';
import { restoreClipGlueState } from '../restoreClipGlueState';

type AutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];
type AutomationLanePoints = AutomationLane['points'];

/** One clip-scoped lane, with absolute-beat points, on the given source clip. */
function clipAutomationLane(
    laneId: string,
    clipId: string,
    parameterId: string,
    points: AutomationLanePoints
): AutomationLane {
    return {
        id: laneId,
        trackId: 'track-midi',
        clipId,
        parameterId,
        parameterName: parameterId,
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function setClipAutomationLanes(lanes: readonly AutomationLane[]): void {
    automationStore.set({ lanes: [...lanes] });
}

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

    it('migrates a source clip automation lane onto the glued clip instead of refusing or retiring it (regression #2108)', () => {
        setClipAutomationLanes([
            clipAutomationLane('lane-clip-a-gain', 'clip-a', 'gain', [
                { id: 'point-a', beat: 9, value: 0.5, curve: 'linear', tension: 0.5 },
            ]),
        ]);

        expect(glueClips(['clip-a', 'clip-b'])).toBe(true);

        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        // Points are absolute timeline beats and the glued clip spans the
        // union of the source windows, so re-keying the lane preserves
        // playback exactly. Retiring it would silence automation that played
        // a moment earlier.
        expect(automationStore.value!.lanes).toHaveLength(1);
        expect(automationStore.value!.lanes[0]).toMatchObject({
            clipId: glued.id,
            parameterId: 'gain',
            points: [{ id: 'point-a', beat: 9, value: 0.5, curve: 'linear', tension: 0.5 }],
        });
        expect(automationStore.value!.lanes[0]!.id).not.toBe('lane-clip-a-gain');
        expect(midiStore.value!.notesByClipId).not.toHaveProperty('clip-a');
        expect(midiStore.value!.notesByClipId).toHaveProperty(glued.id);
    });

    it('merges two sources automating the same parameter into one lane on the glued clip (regression #2108)', () => {
        setClipAutomationLanes([
            clipAutomationLane('lane-a-gain', 'clip-a', 'gain', [
                { id: 'point-a', beat: 9, value: 0.25, curve: 'linear', tension: 0 },
            ]),
            clipAutomationLane('lane-b-gain', 'clip-b', 'gain', [
                { id: 'point-b', beat: 13, value: 0.75, curve: 'linear', tension: 0 },
            ]),
            clipAutomationLane('lane-b-pan', 'clip-b', 'pan', [
                { id: 'point-c', beat: 14, value: 0.5, curve: 'linear', tension: 0 },
            ]),
        ]);

        expect(glueClips(['clip-a', 'clip-b'])).toBe(true);

        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        const lanes = automationStore.value!.lanes;
        expect(lanes).toHaveLength(2);
        expect(lanes.every((lane) => lane.clipId === glued.id)).toBe(true);
        // The source windows are disjoint, so the two gain lanes interleave
        // into one without conflict.
        expect(lanes.find((lane) => lane.parameterId === 'gain')!.points).toEqual([
            { id: 'point-a', beat: 9, value: 0.25, curve: 'linear', tension: 0 },
            { id: 'point-b', beat: 13, value: 0.75, curve: 'linear', tension: 0 },
        ]);
        expect(lanes.find((lane) => lane.parameterId === 'pan')!.points).toEqual([
            { id: 'point-c', beat: 14, value: 0.5, curve: 'linear', tension: 0 },
        ]);
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

    it('keeps a duplicated MIDI clip glue-eligible (regression: spurious default warp entry blocked gluing)', () => {
        // Duplicate clip-b immediately after itself so the copy is adjacent to
        // an existing plain MIDI clip and would be a valid glue candidate on
        // its own merits. Neither clip-b nor its copy ever had warp markers.
        expect(
            duplicateClipCore({
                clipId: 'clip-b',
                targetClipId: 'clip-b-copy',
                computeStartBeat: () => 16,
            })
        ).toBe(true);

        // `hasClipGlueDependencies` (clipEditing/hasClipGlueDependencies.ts)
        // must not treat the duplicate as carrying warp state it never had.
        expect(hasClipGlueDependencies(['clip-b-copy'])).toBe(false);

        // And the production surface the UI uses to offer gluing must list the
        // duplicate as a real candidate, not silently drop it forever.
        expect(getGlueEligibleClipPairs()).toEqual([
            ['clip-a', 'clip-b'],
            ['clip-b', 'clip-b-copy'],
        ]);
    });

    it('does not count a clip whose warp state was written but is content-identical to default as carrying satellite state', () => {
        // A real write path — not a poke at the map — that leaves the clip's
        // warp state value-identical to `defaultWarpState`: the clip has no
        // prior entry, and `repitch` is already `defaultWarpState.stretchMode`.
        setStretchMode('clip-a', 'repitch');
        expect(warpStates.has('clip-a')).toBe(true);

        // `hasClipGlueDependencies` must not block gluing a clip whose only
        // warp-state footprint is a value-identical-to-default map entry.
        expect(hasClipGlueDependencies(['clip-a'])).toBe(false);
        expect(getGlueEligibleClipPairs()).toEqual([['clip-a', 'clip-b']]);

        // `isGeneratedMidiStateCurrent`'s undo guard must still admit the clip:
        // an exact entity/MIDI match with no *real* satellite state is current.
        const clip = trackStore.value!.tracks[0]!.clips.find((candidate) => candidate.id === 'clip-a')!;
        expect(
            isGeneratedMidiStateCurrent({
                entityId: 'clip-a',
                entityType: 'clip',
                guard: {
                    entityJson: JSON.stringify(clip),
                    midiByClipIdJson: serializeMidiStateForClips(['clip-a']),
                },
            })
        ).toBe(true);
    });

    it('still counts a clip with a real warp marker, enabled warp, or a non-default stretch mode as a stale generated-MIDI guard (regression #2108: gluing itself migrates rather than blocks on this state)', () => {
        const clip = trackStore.value!.tracks[0]!.clips.find((candidate) => candidate.id === 'clip-a')!;
        // `clip` itself never changes across these cases — only the warp store
        // does — so the same guard is reused for every sub-case.
        const guard = { entityJson: JSON.stringify(clip), midiByClipIdJson: serializeMidiStateForClips(['clip-a']) };
        const isCurrent = () => isGeneratedMidiStateCurrent({ entityId: 'clip-a', entityType: 'clip', guard });

        // `hasClipGlueDependencies` deliberately does not check any of these —
        // gluing migrates the first source's warp state onto the glued clip
        // and retires the rest (ledger #2108), so their presence never blocks
        // the glue. `isGeneratedMidiStateCurrent` guards a different question
        // (is a previously generated MIDI snapshot still fresh) and keeps
        // treating real warp state as disqualifying it.
        addManualWarpMarker({ clipId: 'clip-a', beat: 1 });
        expect(isCurrent()).toBe(false);
        removeWarpState('clip-a');

        enableWarp('clip-a');
        expect(isCurrent()).toBe(false);
        removeWarpState('clip-a');

        setStretchMode('clip-a', 'complex');
        expect(isCurrent()).toBe(false);
    });

    it('sweeps the consumed source clips warp state when a glue with a content-default entry commits', () => {
        // Real write path, not a map poke: `repitch` is `defaultWarpState.stretchMode`,
        // so this is exactly the regression scenario above — content-identical to
        // default, which the content-aware gate now lets through.
        setStretchMode('clip-a', 'repitch');
        expect(warpStates.has('clip-a')).toBe(true);

        expect(glueClips(['clip-a', 'clip-b'])).toBe(true);

        // Both consumed source clip ids must be gone from the map — a stale
        // entry keyed to a retired clip id can never re-attach (ids are never
        // reused) but it still has to be swept, not left to leak forever.
        expect(warpStates.has('clip-a')).toBe(false);
        expect(warpStates.has('clip-b')).toBe(false);
    });

    it('does not destroy a source clip warp entry through a full apply/undo/redo round trip', () => {
        // Every entry below is content-default on purpose: `hasClipGlueDependencies`
        // gates both the apply *and* the restore direction on the same
        // `expected`/`replacement` participant set, so a genuinely non-default
        // entry on any of them would block the call outright rather than
        // exercise the sweep. Content-default is exactly the shape the
        // content-aware gate lets through, and its presence in the map is
        // still observable via `warpStates.has`, which is what this test
        // exercises.
        setStretchMode('clip-a', 'repitch');
        const plan = prepareClipGlue({ clipIds: ['clip-a', 'clip-b'] });
        expect(plan).not.toBeNull();
        const { previous, next, targetClipId: gluedId } = plan!;

        expect(restoreClipGlueState({ expected: previous, replacement: next })).toBe(true);
        expect(warpStates.has('clip-a')).toBe(false);
        expect(warpStates.has('clip-b')).toBe(false);

        // Normal usage after gluing: the glued clip picks up its own warp
        // footprint. This is what undo must retire — it is the clip undo
        // consumes.
        setStretchMode(gluedId, 'repitch');
        expect(warpStates.has(gluedId)).toBe(true);

        // A real map entry sitting under the restored clips' ids at the moment
        // undo runs — exactly what an unconditional sweep (one that clears
        // both sides of the operation, or the wrong side) would destroy the
        // instant it reinserts `clip-a` and `clip-b` back onto the track.
        setStretchMode('clip-a', 'repitch');
        setStretchMode('clip-b', 'repitch');

        expect(restoreClipGlueState({ expected: next, replacement: previous })).toBe(true);

        // The glued clip's own entry is gone — it is the id undo consumed.
        expect(warpStates.has(gluedId)).toBe(false);
        // The restored clips keep whatever satellite state they had.
        expect(warpStates.has('clip-a')).toBe(true);
        expect(warpStates.has('clip-b')).toBe(true);

        // Redo: the third step a user actually performs — glue, undo to hear
        // the parts again, redo. `handleGlueClips.describe` captures
        // `plan.previous`/`plan.next` exactly once and wires `redoAction` as
        // the same forward direction the initial apply used, never a freshly
        // recomputed snapshot — so this call reuses the very `previous`/`next`
        // objects from the original `prepareClipGlue`, not a new call to it.
        // Redo re-consumes `clip-a` and `clip-b`, so their entries (set again
        // above, right before undo ran) must be swept a second time, landing
        // on exactly the state the first apply produced: no entry for either
        // source id, and none for the glued id either, since nothing wrote
        // one for it between undo and redo.
        expect(restoreClipGlueState({ expected: previous, replacement: next })).toBe(true);
        expect(warpStates.has(gluedId)).toBe(false);
        expect(warpStates.has('clip-a')).toBe(false);
        expect(warpStates.has('clip-b')).toBe(false);
    });
});
