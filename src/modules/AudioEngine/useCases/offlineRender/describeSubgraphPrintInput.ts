import { type Track } from '#/modules/Arrangement/stores';

import { collectWiredSidechainDetectorRoutes } from './collectWiredSidechainDetectorRoutes';
import { projectStripTrack } from './projectStripTrack';
import { readPlayedFrozenBufferId } from './readPlayedFrozenBufferId';
import { resolveContributorVcaMultiplier } from './resolveContributorVcaMultiplier';
import { resolveMuteHonoringTrackIds } from './resolveMuteHonoringTrackIds';
import { type SubgraphPrintInput } from './selectSubgraphPrintInput';

/** The caller's own account of what a track's clips and chain sound like. */
export type DescribeTrackContent = (content: Pick<Track, 'clips' | 'devices'>) => unknown;

/**
 * Track fields no subgraph render reads: naming, layout and lane display, recording and monitoring
 * setup, edit grouping, the stored inactive alternatives, and solo (a freeze or bounce prints every
 * strip it builds whatever is soloed: it passes `resolvePrintReachability` no solo gate).
 */
type UnreadTrackField =
    | 'name'
    | 'color'
    | 'height'
    | 'collapsed'
    | 'hidden'
    | 'notes'
    | 'showVariationLanes'
    | 'armed'
    | 'inputMonitoring'
    | 'inputId'
    | 'groupId'
    | 'alternatives'
    | 'soloed'
    | 'soloSafe';

function omitUnreadFields(track: Track): Omit<Track, UnreadTrackField> {
    const {
        name: _name,
        color: _color,
        height: _height,
        collapsed: _collapsed,
        hidden: _hidden,
        notes: _notes,
        showVariationLanes: _showVariationLanes,
        armed: _armed,
        inputMonitoring: _inputMonitoring,
        inputId: _inputId,
        groupId: _groupId,
        alternatives: _alternatives,
        soloed: _soloed,
        soloSafe: _soloSafe,
        ...read
    } = track;
    return read;
}

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
    muteHonoringTrackIds: ReadonlySet<string>;
    describeTrackContent: DescribeTrackContent;
};

/**
 * One strip as the keep-live render builds it, by the render's own rules: the target at unity and
 * centre with no VCA master and no output of its own (it prints), and a mute only where the render
 * honours one. The target's own freeze state is what this render produces, so it is not an input.
 */
function describeTrack({ track, input, muteHonoringTrackIds, describeTrackContent }: DescribeTrackInput) {
    const isTarget = track.id === input.targetTrackId;
    const strip = projectStripTrack({
        track,
        isTarget,
        includeInserts: true,
        includeAutomation: true,
        targetMixer: 'keepLive',
    });
    const {
        clips,
        devices,
        muted,
        vcaGroupId: _vcaGroupId,
        freezeState: _freezeState,
        frozen,
        frozenBufferId,
        outputId,
        ...read
    } = omitUnreadFields(strip);
    const described = {
        ...read,
        content: describeTrackContent({ clips, devices }),
        vcaMultiplier: resolveContributorVcaMultiplier({ track, isTarget, groups: [...input.vcaGroups] }),
        muted: muteHonoringTrackIds.has(track.id) ? muted : null,
    };
    if (isTarget) {
        return described;
    }
    return { ...described, outputId, frozen, frozenBufferId, playedFrozenBufferId: readPlayedFrozenBufferId(track) };
}

/**
 * The plain value a digest of a keep-live subgraph render's input is taken over: every selected
 * input, with each field the render's own rules ignore left out by those same rules, and MIDI rows
 * ordered by id, since their order is not content.
 */
export function describeSubgraphPrintInput(input: SubgraphPrintInput, describeTrackContent: DescribeTrackContent) {
    const muteHonoringTrackIds = resolveMuteHonoringTrackIds(
        collectWiredSidechainDetectorRoutes({ tracks: input.tracks, routes: input.routes })
    );
    return {
        tracks: input.tracks.map((track) =>
            describeTrack({ track, input, muteHonoringTrackIds, describeTrackContent })
        ),
        routes: input.routes,
        automationLanes: input.automationLanes.map(omitLaneViewFields),
        midiRows: input.midiRows.map((rows) => ({
            clipId: rows.clipId,
            notes: sortedById(rows.notes),
            cc: sortedById(rows.cc),
            pitchBend: sortedById(rows.pitchBend),
        })),
        probabilitySeed: input.probabilitySeed,
        takeLanes: input.takeLanes,
        gainEnvelopes: input.gainEnvelopes.filter((entry) => entry.envelope !== undefined),
        adjustmentLayersByTrack: input.adjustmentLayersByTrack,
        modulators: input.modulators,
    };
}
