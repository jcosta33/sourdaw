import { sharedStreamState } from './recordingSession';

export function releaseSharedMediaStream(): void {
    if (sharedStreamState.usageCount > 0) {
        sharedStreamState.usageCount--;
    }
    if (sharedStreamState.usageCount === 0 && sharedStreamState.stream) {
        for (const track of sharedStreamState.stream.getTracks()) {
            track.stop();
        }
        sharedStreamState.stream = null;
    }
}
