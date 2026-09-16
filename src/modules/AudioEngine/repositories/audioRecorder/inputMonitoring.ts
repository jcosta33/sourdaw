import { audioEngine } from '../createWebAudioEngine';

import { inputMonitoringSession } from './inputMonitoringSession';
import { stopStreamTracks } from './stopStreamTracks';

/**
 * Gives one track a listening edge from the shared monitor capture.
 *
 * Edges are per track: the first interested track acquires the microphone once
 * and every later track only adds an edge from the same source, so stopping one
 * track's monitoring can never disconnect another. Idempotent per track — a
 * track that already owns an edge is left untouched.
 */
export async function startInputMonitoring(trackId: string, inputId: string | null = null): Promise<boolean> {
    try {
        if (inputMonitoringSession.monitorSource) {
            // Also re-ensures an existing owner's edge against HMR strip replacement.
            connectMonitorEdge(trackId);
            return true;
        }
        beginMonitorCapture(deviceConstraints(inputId));
        inputMonitoringSession.pendingOwners.add(trackId);
        await inputMonitoringSession.pendingRequest?.catch(() => null);
        // The capture settlement connected every owner still interested.
        return inputMonitoringSession.monitorEdges.has(trackId);
    } catch {
        return false;
    }
}

/**
 * Begins the one shared capture request and decides its fate at settlement:
 * remaining interested owners adopt the late stream, while a superseded grant
 * — every owner stopped before it resolved — is released exactly once and
 * never becomes a source or an edge.
 */
function beginMonitorCapture(constraints: MediaTrackConstraints): void {
    if (inputMonitoringSession.pendingRequest) {
        return;
    }
    const request = navigator.mediaDevices.getUserMedia({ audio: constraints });
    inputMonitoringSession.pendingRequest = request;
    void request.then(
        (stream) => {
            if (inputMonitoringSession.pendingRequest !== request) {
                // Orphaned by an explicit global teardown; the late stream has no owner.
                stopStreamTracks(stream);
                return;
            }
            inputMonitoringSession.pendingRequest = null;
            if (inputMonitoringSession.pendingOwners.size === 0) {
                stopStreamTracks(stream);
                return;
            }
            inputMonitoringSession.monitorStream = stream;
            inputMonitoringSession.monitorSource = audioEngine.context.createMediaStreamSource(stream);
            for (const trackId of [...inputMonitoringSession.pendingOwners]) {
                inputMonitoringSession.pendingOwners.delete(trackId);
                connectMonitorEdge(trackId);
            }
        },
        () => {
            if (inputMonitoringSession.pendingRequest === request) {
                inputMonitoringSession.pendingRequest = null;
                inputMonitoringSession.pendingOwners.clear();
            }
        }
    );
}

function connectMonitorEdge(trackId: string): void {
    const source = inputMonitoringSession.monitorSource;
    if (!source) {
        return;
    }
    // Reconnect to the current strip: HMR can replace strips under a live edge.
    const strip = audioEngine.ensureTrackStrip(trackId);
    const previous = inputMonitoringSession.monitorEdges.get(trackId);
    if (previous !== undefined && previous !== strip.gainNode) {
        source.disconnect(previous);
    }
    source.connect(strip.gainNode);
    inputMonitoringSession.monitorEdges.set(trackId, strip.gainNode);
}

function deviceConstraints(inputId: string | null): MediaTrackConstraints {
    const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
    };
    if (inputId) {
        audioConstraints.deviceId = { exact: inputId };
    }
    return audioConstraints;
}
