import { describe, expect, it } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { describeSubgraphPrintInput } from '../describeSubgraphPrintInput';
import { selectSubgraphPrintInput, type SubgraphPrintInputSource } from '../selectSubgraphPrintInput';

const TARGET_ID = 'track-target';
const OTHER_ID = 'track-other';

type Lane = SubgraphPrintInputSource['automationLanes'][number];
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

// Built once: a track a fresh `createTrack` mints carries ids that differ between calls.
const target = createTrack({ id: TARGET_ID, name: 'Target', kind: 'midi' });
const other = createTrack({ id: OTHER_ID, name: 'Other', kind: 'audio' });

type Rows = { target: Track; lanes: Lane[] };

function select(rows: Rows) {
    const source: SubgraphPrintInputSource = {
        tracks: { tracks: [rows.target, other], selectedTrackId: null, ghostClips: [] },
        midi: null,
        automationLanes: rows.lanes,
        sidechainRoutes: [],
        vcaGroups: [],
        takeLanes: { lanes: [] },
        gainEnvelopes: {},
        adjustmentLayers: [],
        modulators: [],
    };
    return selectSubgraphPrintInput({ targetTrackId: TARGET_ID, renderTracks: [rows.target], source });
}

function describeRows(rows: Rows) {
    return describeSubgraphPrintInput(select(rows), () => null);
}

const baseline: Rows = { target, lanes: [lane] };
const printedBaseline = describeRows(baseline);
const baselineRefs = select(baseline).refs;

function withLane(edit: Partial<Lane>): Rows {
    return { target, lanes: [{ ...lane, ...edit }] };
}

const point = { beat: 1, value: 0.9, curve: 'linear' as const, tension: 0 };

const unprintedEdits: [string, Rows][] = [
    [
        'the track MIDI FX is bypassed',
        {
            target: {
                ...target,
                midiFx: [{ id: 'fx', name: 'Arp', type: 'arp', bypassed: true, parameterValues: {} }],
            },
            lanes: [lane],
        },
    ],
    ['the track MIDI output route changes', { target: { ...target, midiOutputTrackId: OTHER_ID }, lanes: [lane] }],
    ['the track active alternative changes', { target: { ...target, activeAlternativeId: 'alt-2' }, lanes: [lane] }],
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
];

const printedEdits: [string, Rows][] = [
    ['a lane point changes', withLane({ points: [point] })],
    ['a lane range changes', withLane({ maxValue: 2 })],
    ['a lane is disabled', withLane({ enabled: false })],
    ['a lane follows another lane', withLane({ linkedLaneId: 'lane-2' })],
    ['a lane link scale changes', withLane({ linkedLaneId: 'lane-2', linkScale: -1 })],
    ['a lane drives another parameter', withLane({ parameterId: 'device-1:resonance' })],
    ['the track is disabled', { target: { ...target, disabled: true }, lanes: [lane] }],
    ['the track automation mode changes', { target: { ...target, automationMode: 'off' }, lanes: [lane] }],
];

describe('describeSubgraphPrintInput track and automation lane fields', () => {
    it.each(unprintedEdits)('selects and describes the same input when %s', (_name, rows) => {
        expect(describeRows(rows)).toEqual(printedBaseline);
        expect(select(rows).refs).toEqual(baselineRefs);
    });

    it.each(printedEdits)('describes another value when %s', (_name, rows) => {
        expect(describeRows(rows)).not.toEqual(printedBaseline);
    });

    it('reads the leader of a follower lane that sits on a track outside the subgraph', () => {
        const leader: Lane = { ...lane, id: 'leader', trackId: OTHER_ID };
        const follower: Lane = { ...lane, id: 'follower', linkedLaneId: leader.id };
        const printedWithLeader = describeRows({ target, lanes: [follower, leader] });
        const changedLeader = describeRows({ target, lanes: [follower, { ...leader, points: [point] }] });
        expect(printedWithLeader.automationLanes.map((read) => read.id)).toEqual(['follower', 'leader']);
        expect(changedLeader).not.toEqual(printedWithLeader);
    });

    it('does not read a lane on a track outside the subgraph that no follower reads', () => {
        const unrelated: Lane = { ...lane, id: 'unrelated', trackId: OTHER_ID };
        expect(describeRows({ target, lanes: [lane, unrelated] })).toEqual(printedBaseline);
    });
});
