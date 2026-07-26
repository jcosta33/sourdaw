/**
 * Device types that legitimately contribute no node to the offline device
 * chain, because some *other* offline path renders them.
 *
 * This list is a load-bearing exemption from "an unbuildable device fails the
 * export". Every entry states which code path renders it instead, so that
 * adding an entry is a reviewable claim about the renderer rather than a quiet
 * way to make a failing export go green. A device type that renders nowhere
 * does not belong here — it belongs in a bug fix.
 *
 * Entries are matched individually. There is deliberately no wildcard and no
 * "starts with builtin-" catch-all: `builtin-crumbs` shipped unrenderable for
 * exactly as long as its failure looked like every other `builtin-` failure.
 */
type NodelessOfflineDeviceType = {
    /** Exact device type, or a prefix when the catalog generates variants. */
    readonly match: string;
    readonly isPrefix: boolean;
    /** Which offline path renders this device instead of the device chain. */
    readonly renderedBy: string;
};

const NODELESS_OFFLINE_DEVICE_TYPES: readonly NodelessOfflineDeviceType[] = [
    {
        match: 'yeast',
        isPrefix: false,
        // Yeast is a MIDI FX rack: it transforms notes and produces no audio.
        // `scheduleTrackClips` discovers it on `track.devices` and routes the
        // track's notes through `projectOfflineYeastTrackNotes`, so it must be
        // absent from the audio chain rather than merely tolerated in it.
        renderedBy: 'scheduleTrackClips → projectOfflineYeastTrackNotes (MIDI only, emits no audio)',
    },
    {
        match: 'synth',
        isPrefix: false,
        renderedBy: 'scheduleTrackClips → scheduleNoteOffline, voiced from getSynthParamsFromDevices',
    },
    {
        match: 'builtin-synth',
        isPrefix: true,
        // The built-in synth and its catalog variants are voiced directly by the
        // offline note scheduler. `getSynthParamsFromDevices` matches this same
        // prefix, so the device carries parameters but never an insert node.
        renderedBy: 'scheduleTrackClips → scheduleNoteOffline, voiced from getSynthParamsFromDevices',
    },
    {
        match: 'builtin-drum-kit',
        isPrefix: false,
        renderedBy: 'scheduleTrackClips → scheduleKitNote, kit resolved by resolveDrumKit',
    },
    {
        match: 'builtin-drum-machine',
        isPrefix: true,
        // `resolveDrumKit` matches this prefix and plays one-shot samples; the
        // drum machines are sample players, not insert effects.
        renderedBy: 'scheduleTrackClips → scheduleKitNote, kit resolved by resolveDrumKit',
    },
];

/**
 * True when this device type is rendered offline by a path other than the
 * device chain, and its absence from the chain is therefore correct.
 */
export function isNodelessOfflineDeviceType(deviceType: string): boolean {
    return NODELESS_OFFLINE_DEVICE_TYPES.some((entry) => {
        if (entry.isPrefix) {
            return deviceType.startsWith(entry.match);
        }
        return deviceType === entry.match;
    });
}
