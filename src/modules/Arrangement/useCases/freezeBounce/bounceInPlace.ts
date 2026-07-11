import { bounceTrack } from './bounceTrack';

export async function bounceInPlace(trackId: string): Promise<void> {
    return bounceTrack(trackId, {
        includeInserts: true,
        includeSends: false,
        includeAutomation: true,
        normalization: 'protection',
        tailHandling: 'auto',
        destination: 'replace',
    });
}
