/** Stops every device track of a stream exactly once. */
export function stopStreamTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
        track.stop();
    }
}
