import { isBuiltinSynthDevice, isDrumDevice } from '#/utils/deviceTypeMatching';

/**
 * Device types that legitimately contribute no node to the offline device
 * chain, because some *other* offline path renders them.
 *
 * This predicate is a load-bearing exemption from "an unbuildable device fails
 * the export", so it must name the same device families the schedulers do —
 * exactly, not approximately.
 *
 * It used to hold its own table of ids, and that table had already drifted: it
 * listed `builtin-drum-kit` and the `builtin-drum-machine` prefix but not the
 * bare `drum-kit` arm, which `scheduleTrackClips` resolves through
 * `getDrumKitDefByIndex` and renders correctly. Two hand-maintained lists that
 * must agree is the defect, not the row that was missing, so the drum and synth
 * families now come straight from the shared matchers in
 * `#/utils/deviceTypeMatching` — the same functions the live and offline
 * schedulers select on.
 *
 * Anything that is *not* one of those families needs an individual entry below,
 * stating which code path renders it. There is deliberately no wildcard and no
 * "starts with builtin-" catch-all: `builtin-crumbs` shipped unrenderable for
 * exactly as long as its failure looked like every other `builtin-` failure.
 */
type NodelessOfflineDeviceType = {
    /** Exact device type. */
    readonly match: string;
    /** Which offline path renders this device instead of the device chain. */
    readonly renderedBy: string;
};

const NODELESS_OFFLINE_DEVICE_TYPES: readonly NodelessOfflineDeviceType[] = [
    {
        match: 'yeast',
        // Yeast is a MIDI FX rack: it transforms notes and produces no audio.
        // `scheduleTrackClips` discovers it on `track.devices` and routes the
        // track's notes through `projectOfflineYeastTrackNotes`, so it must be
        // absent from the audio chain rather than merely tolerated in it.
        renderedBy: 'scheduleTrackClips → projectOfflineYeastTrackNotes (MIDI only, emits no audio)',
    },
];

/**
 * True when this device type is rendered offline by a path other than the
 * device chain, and its absence from the chain is therefore correct.
 */
export function isNodelessOfflineDeviceType(deviceType: string): boolean {
    // Voiced by `scheduleTrackClips → scheduleNoteOffline`, parameterised from
    // `getSynthParamsFromDevices`, which selects on this same predicate.
    if (isBuiltinSynthDevice(deviceType)) {
        return true;
    }
    // Voiced by `scheduleTrackClips` through `scheduleKitNote` /
    // `scheduleDrumKitNote`, which between them cover all three arms.
    if (isDrumDevice(deviceType)) {
        return true;
    }
    return NODELESS_OFFLINE_DEVICE_TYPES.some((entry) => deviceType === entry.match);
}
