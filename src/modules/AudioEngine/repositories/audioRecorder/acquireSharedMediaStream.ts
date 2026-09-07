import { sharedStreamState } from './recordingSession';

export async function acquireSharedMediaStream(constraints: MediaTrackConstraints): Promise<MediaStream> {
    const stream = sharedStreamState.stream ?? (await ensureStreamRequest(constraints));
    retainSharedMediaStream(stream);
    return stream;
}

// Concurrent arming calls must share one getUserMedia request: whoever arrives
// while a request is in flight awaits it instead of opening a second stream,
// which would overwrite the cached pointer and orphan the first microphone.
async function ensureStreamRequest(constraints: MediaTrackConstraints): Promise<MediaStream> {
    const pending = sharedStreamState.pendingRequest;
    if (pending) {
        return pending;
    }
    const request = navigator.mediaDevices.getUserMedia({ audio: constraints });
    sharedStreamState.pendingRequest = request;
    // Cache-side bookkeeping only; every real consumer awaits `request`
    // directly, so this chain swallows the rejection to stay unobserved.
    void request.then(
        (stream) => {
            sharedStreamState.stream = stream;
            sharedStreamState.pendingRequest = null;
        },
        () => {
            sharedStreamState.pendingRequest = null;
        }
    );
    return request;
}

function retainSharedMediaStream(stream: MediaStream): void {
    const usage = sharedStreamState.streamUsage.get(stream) ?? 0;
    sharedStreamState.streamUsage.set(stream, usage + 1);
}
