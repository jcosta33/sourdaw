import { bounceTrack } from './bounceTrack';

type BounceToNewTrackOptions = {
    /** Forwarded to `bounceTrack`; see `BounceOptions.deferUndoEntry`. */
    deferUndoEntry?: (file: () => void) => void;
};

export async function bounceToNewTrack(trackId: string, options?: BounceToNewTrackOptions): Promise<boolean> {
    return bounceTrack(trackId, {
        includeInserts: true,
        includeSends: false,
        includeAutomation: true,
        normalization: 'protection',
        tailHandling: 'auto',
        destination: 'new-track',
        ...(options?.deferUndoEntry === undefined ? {} : { deferUndoEntry: options.deferUndoEntry }),
    });
}
