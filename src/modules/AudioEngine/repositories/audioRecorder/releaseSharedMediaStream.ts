import { sharedStreamState } from './recordingSession';

// Releases one session's hold on the stream it was given, not whatever the
// cache currently points at: concurrent acquisition can leave several streams
// owned at once, so only the released stream's tracks stop, and only when its
// last session ends.
export function releaseSharedMediaStream(stream: MediaStream): void {
    const usage = sharedStreamState.streamUsage;
    const remaining = (usage.get(stream) ?? 0) - 1;
    if (remaining > 0) {
        usage.set(stream, remaining);
        return;
    }
    usage.delete(stream);
    for (const track of stream.getTracks()) {
        track.stop();
    }
    if (sharedStreamState.stream === stream) {
        sharedStreamState.stream = null;
    }
}
