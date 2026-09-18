import { sharedStreamState } from './recordingSession';

/**
 * The cache key for one requested input. Recording selects the track's input
 * by exact deviceId (#3773), so two armed tracks assigned different inputs must
 * never share a stream even though the cache exists to make concurrent arming
 * of the *same* input share one getUserMedia request.
 */
function streamKey(constraints: MediaTrackConstraints): string {
    const deviceId = constraints.deviceId;
    if (typeof deviceId !== 'object' || deviceId === null || Array.isArray(deviceId)) {
        return 'default-input';
    }
    const exact = deviceId.exact;
    return typeof exact === 'string' && exact !== '' ? `device:${exact}` : 'default-input';
}

export async function acquireSharedMediaStream(constraints: MediaTrackConstraints): Promise<MediaStream> {
    const key = streamKey(constraints);
    const stream = sharedStreamState.streams.get(key) ?? (await ensureStreamRequest(key, constraints));
    retainSharedMediaStream(stream);
    return stream;
}

// Concurrent arming calls on one input must share one getUserMedia request:
// whoever arrives while a request is in flight awaits it instead of opening a
// second stream for the same device, which would overwrite the cached pointer
// and orphan the first microphone.
async function ensureStreamRequest(key: string, constraints: MediaTrackConstraints): Promise<MediaStream> {
    const pending = sharedStreamState.pendingRequests.get(key);
    if (pending) {
        return pending;
    }
    const request = navigator.mediaDevices.getUserMedia({ audio: constraints });
    sharedStreamState.pendingRequests.set(key, request);
    // Cache-side bookkeeping only; every real consumer awaits `request`
    // directly, so this chain swallows the rejection to stay unobserved.
    void request.then(
        (stream) => {
            sharedStreamState.streams.set(key, stream);
            sharedStreamState.pendingRequests.delete(key);
        },
        () => {
            sharedStreamState.pendingRequests.delete(key);
        }
    );
    return request;
}

function retainSharedMediaStream(stream: MediaStream): void {
    const usage = sharedStreamState.streamUsage.get(stream) ?? 0;
    sharedStreamState.streamUsage.set(stream, usage + 1);
}
