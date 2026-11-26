import { type Track } from '#/modules/Arrangement/stores';

import { readPrintedAdjustmentLayer } from './readPrintedAdjustmentLayer';
import { readPrintedAutomationLane } from './readPrintedAutomationLane';
import { readPrintedModulator } from './readPrintedModulator';
import { readPrintedTakeLane } from './readPrintedTakeLane';
import { readPrintedTrack } from './readPrintedTrack';
import { resolveContributorVcaMultiplier } from './resolveContributorVcaMultiplier';
import { type SubgraphPrintInput } from './selectSubgraphPrintInput';

/** The caller's own account of what a track's clips and chain sound like. */
export type DescribeTrackContent = (content: Pick<Track, 'clips' | 'devices'>) => unknown;

function sortedById<Row extends { id: string }>(rows: readonly Row[] | undefined): Row[] {
    return (rows ?? []).toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * A source's group id reaches the print only as its `vcaMultiplier`, so two groups of one gain
 * sound alike. Change detection still reads the id, which is why the print reader keeps it.
 */
function omitVcaGroupId<Printed extends object>(printed: Printed) {
    if (!('vcaGroupId' in printed)) {
        return printed;
    }
    const { vcaGroupId: _vcaGroupId, ...rest } = printed;
    return rest;
}

type DescribeTrackInput = {
    track: Track;
    input: SubgraphPrintInput;
    describeTrackContent: DescribeTrackContent;
};

/** One strip as the keep-live render builds it, with its clips and chain told by the caller. */
function describeTrack({ track, input, describeTrackContent }: DescribeTrackInput) {
    const isTarget = track.id === input.targetTrackId;
    const { clips, devices, ...read } = readPrintedTrack({
        track,
        isTarget,
        honoursMute: input.muteHonoringTrackIds.has(track.id),
    });
    return {
        ...omitVcaGroupId(read),
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
        toasterPadOrders: input.toasterPadOrders,
        routes: input.routes,
        automationLanes: input.automationLanes.map(readPrintedAutomationLane),
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
