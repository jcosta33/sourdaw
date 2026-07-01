import { sharedStreamState } from './recordingSession';

export async function acquireSharedMediaStream(constraints: MediaTrackConstraints): Promise<MediaStream> {
    if (!sharedStreamState.stream) {
        sharedStreamState.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    }
    sharedStreamState.usageCount++;
    return sharedStreamState.stream;
}
