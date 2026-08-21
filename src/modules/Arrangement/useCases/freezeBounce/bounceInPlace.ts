import { bounceTrack } from './bounceTrack';

type BounceInPlaceOptions = {
    /** Forwarded to `bounceTrack`; see `BounceOptions.recordUndoEntry`. */
    recordUndoEntry?: boolean;
};

export async function bounceInPlace(trackId: string, options?: BounceInPlaceOptions): Promise<boolean> {
    return bounceTrack(trackId, {
        includeInserts: true,
        includeSends: false,
        includeAutomation: true,
        normalization: 'protection',
        tailHandling: 'auto',
        destination: 'replace',
        ...(options?.recordUndoEntry === undefined ? {} : { recordUndoEntry: options.recordUndoEntry }),
    });
}
