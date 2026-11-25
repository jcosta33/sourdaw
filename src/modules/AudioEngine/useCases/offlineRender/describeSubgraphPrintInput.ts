import { type Track } from '#/modules/Arrangement/stores';

import { readPrintedAdjustmentLayer } from './readPrintedAdjustmentLayer';
import { readPrintedModulator } from './readPrintedModulator';
import { readPrintedTakeLane } from './readPrintedTakeLane';
import { readPrintedTrack } from './readPrintedTrack';
import { resolveContributorVcaMultiplier } from './resolveContributorVcaMultiplier';
import { type SubgraphPrintInput } from './selectSubgraphPrintInput';

/** The caller's own account of what a track's clips and chain sound like. */
export type DescribeTrackContent = (content: Pick<Track, 'clips' | 'devices'>) => unknown;

/** Lane fields that set only how a lane is drawn. */
function omitLaneViewFields(lane: SubgraphPrintInput['automationLanes'][number]) {
    const {
        visible: _visible,
        collapsed: _collapsed,
        viewMinValue: _viewMinValue,
        viewMaxValue: _viewMaxValue,
        color: _color,
        ...read
    } = lane;
    return read;
}

function sortedById<Row extends { id: string }>(rows: readonly Row[] | undefined): Row[] {
    return (rows ?? []).toSorted((left, right) => left.id.localeCompare(right.id));
}

type DescribeTrackInput = {
    track: Track;
    input: SubgraphPrintInput;
    describeTrackContent: DescribeTrackContent;
};

/** One strip as the keep-live render builds it, with its clips and chain told by the caller. */
function describeTrack({ track, input, describeTrackContent }: DescribeTrackInput) {
    const isTarget = track.id === input.targetTrackId;
    const { clips, devices, ...printed } = readPrintedTrack({
        track,
        isTarget,
        honoursMute: input.muteHonoringTrackIds.has(track.id),
    });
    return {
        ...printed,
        content: describeTrackContent({ clips, devices }),
        vcaMultiplier: resolveContributorVcaMultiplier({ track, isTarget, groups: [...input.vcaGroups] }),
    };
}

/**
 * The plain value a digest of a keep-live subgraph render's input is taken over: every selected
 * input, with each field the render's own rules ignore left out by those same rules, and MIDI rows
 * ordered by id, since their order is not content.
 */
export function describeSubgraphPrintInput(input: SubgraphPrintInput, describeTrackContent: DescribeTrackContent) {
    return {
        tracks: input.tracks.map((track) => describeTrack({ track, input, describeTrackContent })),
        routes: input.routes,
        automationLanes: input.automationLanes.map(omitLaneViewFields),
        midiRows: input.midiRows.map((rows) => ({
            clipId: rows.clipId,
            notes: sortedById(rows.notes),
            cc: sortedById(rows.cc),
            pitchBend: sortedById(rows.pitchBend),
        })),
        probabilitySeed: input.probabilitySeed,
        takeLanes: input.takeLanes.map(readPrintedTakeLane),
        gainEnvelopes: input.gainEnvelopes.filter((entry) => entry.envelope !== undefined),
        adjustmentLayersByTrack: input.adjustmentLayersByTrack.map((layers) => layers.map(readPrintedAdjustmentLayer)),
        modulators: input.modulators.map(readPrintedModulator),
    };
}
