import { type ClipGainEnvelope, type Track } from '#/modules/Arrangement/stores';

import { affectsTrack } from './affectsTrack';
import { collectWiredSidechainDetectorRoutes } from './collectWiredSidechainDetectorRoutes';
import { drivesTrackMixer } from './drivesTrackMixer';
import { listPrintedFieldRefs } from './listPrintedFieldRefs';
import { listPrintedTakeLaneRefs } from './listPrintedTakeLaneRefs';
import { type OfflineRenderProjectSource, type OfflineRenderSessionSource } from './OfflineRenderSource';
import { readPrintedAdjustmentLayer } from './readPrintedAdjustmentLayer';
import { readPrintedModulator } from './readPrintedModulator';
import { readPrintedTrack } from './readPrintedTrack';
import { resolveMuteHonoringTrackIds } from './resolveMuteHonoringTrackIds';

/** The owner read models a subgraph print reads, live or captured. */
export type SubgraphPrintInputSource = Pick<
    OfflineRenderProjectSource,
    'tracks' | 'midi' | 'automationLanes' | 'sidechainRoutes' | 'vcaGroups' | 'takeLanes' | 'gainEnvelopes'
> &
    OfflineRenderSessionSource;

type MidiState = NonNullable<OfflineRenderProjectSource['midi']>;

type MidiClipRows = {
    clipId: string;
    notes: MidiState['notesByClipId'][string] | undefined;
    cc: MidiState['ccByClipId'][string] | undefined;
    pitchBend: MidiState['pitchBendByClipId'][string] | undefined;
};

/**
 * What of a source a render of one target with `targetMixer: 'keepLive'` (a freeze) can print,
 * selected by reference, and `refs`, every reference it was selected from in selection order: two
 * selections whose refs are identical select the same input, so comparing them costs no digest.
 */
export type SubgraphPrintInput = {
    targetTrackId: string;
    /** The target and every track its render builds, ordered by id. */
    tracks: readonly Track[];
    /** The sidechain routes joining two of `tracks`, the only ones the render wires. */
    routes: readonly OfflineRenderProjectSource['sidechainRoutes'][number][];
    /** The tracks whose mute the render honours: the keys of the detectors `routes` wires. */
    muteHonoringTrackIds: ReadonlySet<string>;
    /** The lanes on `tracks`, except the target's own fader and pan lanes, which stay live. */
    automationLanes: readonly OfflineRenderProjectSource['automationLanes'][number][];
    midiRows: readonly MidiClipRows[];
    probabilitySeed: number | null;
    takeLanes: readonly NonNullable<OfflineRenderProjectSource['takeLanes']>['lanes'][number][];
    gainEnvelopes: readonly { clipId: string; envelope: ClipGainEnvelope | undefined }[];
    /** The VCA groups a source of the render belongs to; the target's master stays live. */
    vcaGroups: readonly OfflineRenderProjectSource['vcaGroups'][number][];
    /** Per track of `tracks`: the adjustment layers reaching it, none for the target, whose strip stays live. */
    adjustmentLayersByTrack: readonly (readonly OfflineRenderSessionSource['adjustmentLayers'][number][])[];
    /** The modulators mapped onto a track of `tracks`. */
    modulators: readonly OfflineRenderSessionSource['modulators'][number][];
    refs: readonly unknown[];
};

type SelectSubgraphPrintInputInput = {
    targetTrackId: string;
    /** The render subgraph of the target, as the caller selects it for the render. */
    renderTracks: readonly Track[];
    source: SubgraphPrintInputSource;
};

/** Selects the input a keep-live subgraph render reads from `source`, without copying it. */
export function selectSubgraphPrintInput({
    targetTrackId,
    renderTracks,
    source,
}: SelectSubgraphPrintInputInput): SubgraphPrintInput {
    const refs: unknown[] = [];
    function take<Value>(value: Value): Value {
        refs.push(value);
        return value;
    }
    // A row of the session or take lanes is taken by the fields its print reads, as a track is.
    function takePrinted<Row>(row: Row, printedRefs: readonly unknown[]): Row {
        refs.push(...printedRefs);
        return row;
    }
    const tracks = renderTracks.toSorted((left, right) => left.id.localeCompare(right.id));
    const memberIds = new Set(tracks.map((track) => track.id));
    const routes = source.sidechainRoutes
        .filter((route) => memberIds.has(route.sourceTrackId) && memberIds.has(route.targetTrackId))
        .map(take);
    const muteHonoringTrackIds = resolveMuteHonoringTrackIds(collectWiredSidechainDetectorRoutes({ tracks, routes }));
    // A track is taken by the fields its print reads, so a write to any other field (a rename, a
    // resize, the target's own fader) or a track object rebuilt around the same values (a write to
    // another track) selects the same input.
    for (const track of tracks) {
        const printed = readPrintedTrack({
            track,
            isTarget: track.id === targetTrackId,
            honoursMute: muteHonoringTrackIds.has(track.id),
        });
        refs.push(track.id);
        for (const [field, value] of Object.entries(printed).toSorted(([left], [right]) => left.localeCompare(right))) {
            refs.push(field, value);
        }
    }
    const sourceTracks = tracks.filter((track) => track.id !== targetTrackId);
    const allTrackIds = (source.tracks?.tracks ?? []).map((track) => track.id);
    const clips = tracks.flatMap((track) => track.clips);
    const midi = source.midi;
    return {
        targetTrackId,
        tracks,
        routes,
        muteHonoringTrackIds,
        automationLanes: source.automationLanes
            .filter((lane) => memberIds.has(lane.trackId) && !drivesTrackMixer(lane, targetTrackId))
            .map(take),
        midiRows: clips
            .filter((clip) => clip.type === 'midi')
            .map((clip) => ({
                clipId: clip.id,
                notes: take(midi?.notesByClipId[clip.id]),
                cc: take(midi?.ccByClipId[clip.id]),
                pitchBend: take(midi?.pitchBendByClipId[clip.id]),
            })),
        probabilitySeed: take(midi?.probabilitySeed ?? null),
        takeLanes: (source.takeLanes?.lanes ?? [])
            .filter((lane) => memberIds.has(lane.trackId))
            .map((lane) => takePrinted(lane, listPrintedTakeLaneRefs(lane))),
        gainEnvelopes: clips.map((clip) => ({ clipId: clip.id, envelope: take(source.gainEnvelopes[clip.id]) })),
        vcaGroups: source.vcaGroups
            .filter((group) => sourceTracks.some((track) => track.vcaGroupId === group.id))
            .map(take),
        adjustmentLayersByTrack: tracks.map((track) => {
            if (track.id === targetTrackId) {
                return [];
            }
            return source.adjustmentLayers
                .filter((layer) => affectsTrack(layer, track.id, allTrackIds))
                .map((layer) => takePrinted(layer, listPrintedFieldRefs(readPrintedAdjustmentLayer(layer))));
        }),
        modulators: source.modulators
            .filter((modulator) => modulator.mappings.some((mapping) => memberIds.has(mapping.targetTrackId)))
            .map((modulator) => takePrinted(modulator, listPrintedFieldRefs(readPrintedModulator(modulator)))),
        refs,
    };
}
