import { createStore } from '#/infra/store/createStore';

/** Which kind of project reference lost its audio. `clip` is relinkable today
 * (drop a file on the clip's waveform editor); `frozenTrack` is not — the only
 * repair is to unfreeze and re-render. */
export type MissingMediaKind = 'clip' | 'frozenTrack';

export type MissingMediaItem = {
    /** The buffer id that resolved to nothing in the audio buffer cache. */
    bufferId: string;
    /** Track owning the dangling reference. */
    trackId: string;
    /** Track name captured at scan time. */
    trackName: string;
    /** Row label: the clip name for `clip`, the track name for `frozenTrack`. */
    label: string;
    kind: MissingMediaKind;
    /** Set only for `kind: 'clip'` — the id a relink would target. */
    clipId?: string;
};

export type MissingMediaStoreState = {
    items: MissingMediaItem[];
    /** `Date.now()` of the scan that produced `items`; `0` before any scan. */
    scannedAt: number;
};

export const defaultMissingMediaStoreState: MissingMediaStoreState = {
    items: [],
    scannedAt: 0,
};

/**
 * Durable record of project audio that could not be resolved on load.
 *
 * Ephemeral by design: this is a *derived* scan of track state against the
 * audio buffer cache, not project truth, so it is never written to the CRDT —
 * a reload re-scans and re-derives it. It is nonetheless durable in the sense
 * that matters to the user: unlike the load-time toast, it stays readable for
 * the whole session, carries a count, and names every affected clip and track.
 *
 * Every scan publishes, including a clean one. A load that resolves all of its
 * media must clear the previous project's rows, otherwise the panel keeps
 * showing a count for media that is no longer missing.
 */
export const missingMediaStore = createStore<MissingMediaStoreState>({
    initialData: defaultMissingMediaStoreState,
});
