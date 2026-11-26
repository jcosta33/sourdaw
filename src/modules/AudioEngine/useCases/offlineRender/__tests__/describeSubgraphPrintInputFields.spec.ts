import { describe, expect, it } from 'vitest';

import { type Clip, type Device } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { describeSubgraphPrintInput } from '../describeSubgraphPrintInput';
import { selectSubgraphPrintInput, type SubgraphPrintInputSource } from '../selectSubgraphPrintInput';

const TARGET_ID = 'track-target';
const MEMBER_ID = 'track-member';
const OTHER_ID = 'track-other';
const COMPRESSOR_ID = 'device-compressor';

type Lane = SubgraphPrintInputSource['automationLanes'][number];
type Group = SubgraphPrintInputSource['vcaGroups'][number];
type Track = ReturnType<typeof createTrack>;

const lane: Lane = {
    id: 'lane-1',
    trackId: TARGET_ID,
    parameterId: 'device-1:cutoff',
    parameterName: 'Cutoff',
    points: [{ beat: 0, value: 0.2, curve: 'linear', tension: 0 }],
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
    minValue: 0,
    maxValue: 1,
};

const point = { beat: 1, value: 0.9, curve: 'linear' as const, tension: 0 };

const compressor: Device = {
    id: COMPRESSOR_ID,
    name: 'Compressor',
    type: 'builtin-sidechain-compressor',
    bypassed: false,
    parameterValues: {},
};

const clip: Clip = {
    id: 'clip-1',
    trackId: TARGET_ID,
    name: 'Clip',
    startBeat: 0,
    endBeat: 4,
    type: 'midi',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#000000',
    locked: false,
    muted: false,
};

const groups: Group[] = [
    { id: 'group-1', name: 'One', gain: 0.5, muted: false, trackIds: [MEMBER_ID] },
    { id: 'group-2', name: 'Two', gain: 0.25, muted: false, trackIds: [] },
];

// Built once: a track a fresh `createTrack` mints carries ids that differ between calls.
const target: Track = {
    ...createTrack({ id: TARGET_ID, name: 'Target', kind: 'midi' }),
    devices: [compressor],
};
const member: Track = {
    ...createTrack({ id: MEMBER_ID, name: 'Member', kind: 'audio' }),
    outputId: TARGET_ID,
    vcaGroupId: 'group-1',
};
const other = createTrack({ id: OTHER_ID, name: 'Other', kind: 'audio' });

/** The keep-live target, one source track that keys the target's compressor, and a track outside the subgraph. */
type Scene = { target: Track; member: Track; lanes: Lane[] };

function select(scene: Scene) {
    const source: SubgraphPrintInputSource = {
        tracks: { tracks: [scene.target, scene.member, other], selectedTrackId: null, ghostClips: [] },
        midi: null,
        automationLanes: scene.lanes,
        sidechainRoutes: [
            {
                id: 'route-1',
                sourceTrackId: MEMBER_ID,
                targetTrackId: TARGET_ID,
                targetDeviceId: COMPRESSOR_ID,
                targetParameterId: 'threshold',
                gain: 1,
            },
        ],
        vcaGroups: groups,
        takeLanes: { lanes: [] },
        gainEnvelopes: {},
        adjustmentLayers: [],
        modulators: [],
    };
    return selectSubgraphPrintInput({
        targetTrackId: TARGET_ID,
        renderTracks: [scene.target, scene.member],
        source,
    });
}

function describeScene(scene: Scene) {
    return describeSubgraphPrintInput(select(scene), (content) => content);
}

const baseline: Scene = { target, member, lanes: [lane] };
const printedBaseline = describeScene(baseline);
const baselineRefs = select(baseline).refs;

function withLane(edit: Partial<Lane>): Scene {
    return { ...baseline, lanes: [{ ...lane, ...edit }] };
}

function withTarget(edit: Partial<Track>): Scene {
    return { ...baseline, target: { ...target, ...edit } };
}

function withMember(edit: Partial<Track>): Scene {
    return { ...baseline, member: { ...member, ...edit } };
}

/** The two outputs change detection and the signature read from a selection. */
function readScene(scene: Scene) {
    return { description: describeScene(scene), refs: select(scene).refs };
}

const baselineRead = { description: printedBaseline, refs: baselineRefs };

const unprintedEdits: [string, Scene][] = [
    [
        'the track MIDI FX is bypassed',
        withTarget({ midiFx: [{ id: 'fx', name: 'Arp', type: 'arp', bypassed: true, parameterValues: {} }] }),
    ],
    ['the track MIDI output route changes', withTarget({ midiOutputTrackId: OTHER_ID })],
    ['the track active alternative changes', withTarget({ activeAlternativeId: 'alt-2' })],
    ['a lane gets ghost points', withLane({ ghostPoints: [point] })],
    ['a lane gets trim points', withLane({ trimPoints: [point] })],
    ['a lane clip automation mode changes', withLane({ clipAutomationMode: 'additive' })],
    ['a lane is renamed', withLane({ parameterName: 'Renamed' })],
    [
        'a lane gets an automation object',
        withLane({ objects: [{ id: 'obj', laneId: lane.id, startBeat: 0, endBeat: 4, points: [], name: 'Obj' }] }),
    ],
    ['a lane is hidden', withLane({ visible: false })],
    ['a lane is collapsed', withLane({ collapsed: true })],
    ['a lane is recoloured', withLane({ color: '#123456' })],
    ['a lane view range changes', withLane({ viewMinValue: 0.1, viewMaxValue: 0.8 })],
    // The target prints at unity and centre, with no VCA master, freeze state, output or mute of its own.
    ['the target fader moves', withTarget({ gain: 0.3 })],
    ['the target pan moves', withTarget({ pan: -0.5 })],
    ['the target is muted', withTarget({ muted: true })],
    ['the target output changes', withTarget({ outputId: OTHER_ID })],
    ['the target joins a VCA group', withTarget({ vcaGroupId: 'group-2' })],
    ['the target is flagged frozen', withTarget({ frozen: true })],
    ['the target names a frozen buffer', withTarget({ frozenBufferId: 'buffer-1' })],
    ['the target is renamed, recoloured and resized', withTarget({ name: 'Renamed', color: '#123456', height: 200 })],
];

const printedTrackEdits: [string, Scene][] = [
    ['a source track changes kind', withMember({ kind: 'midi' })],
    ['a source track is muted (its key feeds a detector)', withMember({ muted: true })],
    ['a source track fader moves', withMember({ gain: 0.3 })],
    ['a source track pan moves', withMember({ pan: -0.5 })],
    ['a source track gains a clip', withMember({ clips: [{ ...clip, trackId: MEMBER_ID }] })],
    ['a source track chain gains a device', withMember({ devices: [{ ...compressor, id: 'device-2' }] })],
    ['a source track gets a send', withMember({ sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] })],
    ['a source track gets a parent', withMember({ parentId: 'folder-1' })],
    ['a source track is disabled', withMember({ disabled: true })],
    ['a source track automation mode changes', withMember({ automationMode: 'off' })],
    ['a source track follows the chord track', withMember({ followChordTrack: true })],
    ['a source track output changes', withMember({ outputId: OTHER_ID })],
    ['a source track joins another VCA group', withMember({ vcaGroupId: 'group-2' })],
    ['a source track is flagged frozen', withMember({ frozen: true })],
    ['a source track names a frozen buffer', withMember({ frozenBufferId: 'buffer-1' })],
    [
        'a source track plays a frozen take',
        withMember({ freezeState: { status: 'frozen', frozenBufferId: 'buffer-1' } }),
    ],
    ['the target kind changes', withTarget({ kind: 'audio' })],
    ['the target gains a clip', withTarget({ clips: [clip] })],
    ['the target chain gains a device', withTarget({ devices: [compressor, { ...compressor, id: 'device-2' }] })],
    ['the target gets a send', withTarget({ sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] })],
    ['the target gets a parent', withTarget({ parentId: 'folder-1' })],
    ['the target is disabled', withTarget({ disabled: true })],
    ['the target automation mode changes', withTarget({ automationMode: 'off' })],
    ['the target follows the chord track', withTarget({ followChordTrack: true })],
];

const printedLaneEdits: [string, Scene][] = [
    ['a lane point changes', withLane({ points: [point] })],
    ['a lane minimum changes', withLane({ minValue: -1 })],
    ['a lane maximum changes', withLane({ maxValue: 2 })],
    ['a lane is disabled', withLane({ enabled: false })],
    ['a lane follows another lane', withLane({ linkedLaneId: 'lane-2' })],
    ['a lane drives another parameter', withLane({ parameterId: 'device-1:resonance' })],
    ['a lane moves to a clip', withLane({ clipId: 'clip-1' })],
    ['a lane moves to a source track', withLane({ trackId: MEMBER_ID })],
];

function leaderChain(...ids: string[]): Lane[] {
    return ids.map((id, index) => ({
        ...lane,
        id,
        trackId: index === 0 ? TARGET_ID : OTHER_ID,
        linkedLaneId: ids[index + 1],
    }));
}

function withPointsOn(lanes: Lane[], id: string): Lane[] {
    return lanes.map((entry) => {
        if (entry.id !== id) {
            return entry;
        }
        return { ...entry, points: [point] };
    });
}

const mixerLane: Lane = { ...lane, id: 'gain-lane', trackId: TARGET_ID, parameterId: 'gain' };

describe('describeSubgraphPrintInput track and automation lane fields', () => {
    it.each(unprintedEdits)('selects and describes the same input when %s', (_name, scene) => {
        expect(readScene(scene)).toEqual(baselineRead);
    });

    it.each([...printedTrackEdits, ...printedLaneEdits])(
        'selects and describes another input when %s',
        (_name, scene) => {
            const read = readScene(scene);
            expect(read.description).not.toEqual(baselineRead.description);
            expect(read.refs).not.toEqual(baselineRead.refs);
        }
    );

    it('does not read a lane on a track outside the subgraph that no follower reads', () => {
        const unrelated: Lane = { ...lane, id: 'unrelated', trackId: OTHER_ID };
        expect(readScene({ ...baseline, lanes: [lane, unrelated] })).toEqual(baselineRead);
    });

    it('selects and describes another input when only the link scale of an already linked lane changes', () => {
        const leader: Lane = { ...lane, id: 'leader', trackId: OTHER_ID };
        const linked: Lane = { ...lane, linkedLaneId: leader.id, linkScale: 1 };
        const linkedBaseline = readScene({ ...baseline, lanes: [linked, leader] });
        const inverted = readScene({ ...baseline, lanes: [{ ...linked, linkScale: -1 }, leader] });
        expect(inverted.description).not.toEqual(linkedBaseline.description);
        expect(inverted.refs).not.toEqual(linkedBaseline.refs);
    });

    describe('leaders of follower lanes', () => {
        it('reads the leader of a follower that sits on a track outside the subgraph', () => {
            const lanes = leaderChain('follower', 'leader');
            const read = describeScene({ ...baseline, lanes });
            expect(read.automationLanes.map((entry) => entry.id)).toEqual(['follower', 'leader']);
            const changed = { ...baseline, lanes: withPointsOn(lanes, 'leader') };
            expect(describeScene(changed)).not.toEqual(read);
            expect(select(changed).refs).not.toEqual(select({ ...baseline, lanes }).refs);
        });

        it('follows a chain of leaders to its far end', () => {
            const lanes = leaderChain('follower', 'middle', 'leader');
            const read = describeScene({ ...baseline, lanes });
            expect(read.automationLanes.map((entry) => entry.id)).toEqual(['follower', 'middle', 'leader']);
            const changed = { ...baseline, lanes: withPointsOn(lanes, 'leader') };
            expect(describeScene(changed)).not.toEqual(read);
            expect(select(changed).refs).not.toEqual(select({ ...baseline, lanes }).refs);
        });

        it('terminates on a cycle of followers', () => {
            const lanes = leaderChain('first', 'second').map((entry) => ({
                ...entry,
                linkedLaneId: entry.id === 'first' ? 'second' : 'first',
            }));
            const read = describeScene({ ...baseline, lanes });
            expect(read.automationLanes.map((entry) => entry.id)).toEqual(['first', 'second']);
        });

        it('reads no lane that drives the target fader, as the render drops it as a leader', () => {
            const lanes = [{ ...lane, linkedLaneId: mixerLane.id }, mixerLane];
            const scene = { ...baseline, lanes };
            const changed = { ...baseline, lanes: [lanes[0]!, { ...mixerLane, points: [point] }] };
            expect(describeScene(scene).automationLanes.map((entry) => entry.id)).toEqual([lane.id]);
            expect(describeScene(changed)).toEqual(describeScene(scene));
            expect(select(changed).refs).toEqual(select(scene).refs);
        });

        it('does not walk through a lane that drives the target pan to reach a leader beyond it', () => {
            const farLeader: Lane = { ...lane, id: 'far-leader', trackId: OTHER_ID };
            const panLane: Lane = { ...mixerLane, id: 'pan-lane', parameterId: 'pan', linkedLaneId: farLeader.id };
            const lanes = [{ ...lane, linkedLaneId: panLane.id }, panLane, farLeader];
            const scene = { ...baseline, lanes };
            const changed = { ...baseline, lanes: withPointsOn(lanes, farLeader.id) };
            expect(describeScene(changed)).toEqual(describeScene(scene));
            expect(select(changed).refs).toEqual(select(scene).refs);
        });

        describe('a follower on a member track of a lane that drives the target', () => {
            const memberFollower: Lane = {
                ...lane,
                id: 'member-follower',
                trackId: MEMBER_ID,
                linkedLaneId: 'gain-lane',
            };
            const panLane: Lane = { ...mixerLane, id: 'pan-lane', parameterId: 'pan' };
            const lanes = [memberFollower, mixerLane, panLane];
            const scene = { ...baseline, lanes };

            it('reads the target fader lane the follower follows, as the render resolves it over the full list', () => {
                const changed = { ...baseline, lanes: withPointsOn(lanes, mixerLane.id) };
                expect(describeScene(scene).automationLanes.map((entry) => entry.id)).toEqual([
                    memberFollower.id,
                    mixerLane.id,
                ]);
                expect(describeScene(changed)).not.toEqual(describeScene(scene));
                expect(select(changed).refs).not.toEqual(select(scene).refs);
            });

            it('does not read the target pan lane the follower does not follow', () => {
                const changed = { ...baseline, lanes: withPointsOn(lanes, panLane.id) };
                expect(describeScene(changed)).toEqual(describeScene(scene));
                expect(select(changed).refs).toEqual(select(scene).refs);
            });

            it('walks on through the target fader lane to the lane it follows', () => {
                const farLeader: Lane = { ...lane, id: 'far-leader', trackId: OTHER_ID };
                const chained = [memberFollower, { ...mixerLane, linkedLaneId: farLeader.id }, farLeader];
                const changed = { ...baseline, lanes: withPointsOn(chained, farLeader.id) };
                expect(describeScene(changed)).not.toEqual(describeScene({ ...baseline, lanes: chained }));
            });
        });

        it('walks each follower chain on its own when a target chain and a member chain reach one leader', () => {
            const sharedLeader: Lane = { ...lane, id: 'shared-leader', trackId: OTHER_ID, linkedLaneId: 'gain-lane' };
            const farLeader: Lane = { ...lane, id: 'far-leader', trackId: OTHER_ID };
            const targetFollower: Lane = { ...lane, linkedLaneId: sharedLeader.id };
            const memberFollower: Lane = {
                ...lane,
                id: 'member-follower',
                trackId: MEMBER_ID,
                linkedLaneId: sharedLeader.id,
            };
            const lanes = [
                targetFollower,
                memberFollower,
                sharedLeader,
                { ...mixerLane, linkedLaneId: farLeader.id },
                farLeader,
            ];
            const scene = { ...baseline, lanes };
            expect(
                describeScene(scene)
                    .automationLanes.map((entry) => entry.id)
                    .toSorted()
            ).toEqual(['far-leader', 'gain-lane', 'lane-1', 'member-follower', 'shared-leader']);
            for (const id of [mixerLane.id, farLeader.id]) {
                const changed = { ...baseline, lanes: withPointsOn(lanes, id) };
                expect(describeScene(changed)).not.toEqual(describeScene(scene));
                expect(select(changed).refs).not.toEqual(select(scene).refs);
            }
        });

        it('reads no lane that drives the target fader, whether or not a follower names it', () => {
            const scene = { ...baseline, lanes: [lane, mixerLane] };
            const changed = { ...baseline, lanes: [lane, { ...mixerLane, points: [point] }] };
            expect(describeScene(scene).automationLanes.map((entry) => entry.id)).toEqual([lane.id]);
            expect(describeScene(changed)).toEqual(describeScene(scene));
            expect(select(changed).refs).toEqual(select(scene).refs);
        });
    });
});
