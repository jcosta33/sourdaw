import { logger } from '#/infra/logger/appLogger';

import { audioEngine } from '../createWebAudioEngine';

import {
    inputMonitoringAdmissionChecks,
    inputMonitoringSession,
    monitorOwnersFor,
    type MonitorCapture,
    type MonitorCaptureKey,
} from './inputMonitoringSession';
import { releaseMonitorCapture } from './releaseMonitorCapture';
import { releaseTrackMonitorEdge } from './releaseTrackMonitorEdge';
import { stopStreamTracks } from './stopStreamTracks';
import { stopTrackInputMonitoring } from './stopTrackInputMonitoring';

/**
 * Gives one track a listening edge from the capture of its selected input.
 *
 * Captures are keyed by selected input, so two tracks recording different
 * devices never share a source: each key owns its own stream, source node and
 * edge map. A track changing input releases its old edge and ownership first,
 * so a track asked for a different key is never handed another key's source.
 * Edges are per track within a key — the first interested track acquires the
 * device and every later track only adds an edge from the same source, so
 * stopping one track's monitoring can never disconnect another. Idempotent per
 * track and key — a track already monitoring this key only re-ensures its edge.
 */
export async function startInputMonitoring(
    trackId: string,
    inputId: string | null = null,
    isCurrent?: () => boolean | 'retain'
): Promise<boolean> {
    if (isCurrent && !isCurrent()) {
        return false;
    }
    if (isCurrent) {
        inputMonitoringAdmissionChecks.set(trackId, isCurrent);
    } else {
        inputMonitoringAdmissionChecks.delete(trackId);
    }
    const key = inputId;
    const previousKey = inputMonitoringSession.trackKeys.get(trackId);
    try {
        if (previousKey !== undefined && previousKey !== key) {
            inputMonitoringSession.trackKeys.delete(trackId);
            releaseTrackMonitorEdge(trackId, previousKey);
        }
        inputMonitoringSession.trackKeys.set(trackId, key);
        const capture = inputMonitoringSession.captures.get(key);
        if (capture) {
            // Also re-ensures an existing owner's edge against HMR strip replacement.
            if (isCurrent?.() !== 'retain') {
                connectMonitorEdge(trackId, capture);
            }
            return true;
        }
        const request = beginCaptureAcquisition(key);
        await request.catch(() => null);
        // The capture settlement connected every owner still interested in this key.
        return inputMonitoringSession.trackKeys.get(trackId) === key && inputMonitoringSession.captures.has(key);
    } catch (error) {
        try {
            stopTrackInputMonitoring(trackId);
        } catch (cleanupError) {
            logger.error(new Error(`Failed to release input monitoring on track ${trackId}`, { cause: cleanupError }));
        }
        logger.error(new Error(`Failed to connect input monitoring on track ${trackId}`, { cause: error }));
        return false;
    }
}

/**
 * Begins one capture request per key and decides its fate at settlement:
 * remaining interested owners adopt the late stream, while a superseded grant
 * — every owner stopped before it resolved, or an explicit teardown replaced
 * the request — is released exactly once and never becomes a source or an edge.
 * Ownership is read from the session at settlement, never captioned on the
 * request, so an owner that left or arrived before the grant is decided by the
 * interest that exists then.
 */
function beginCaptureAcquisition(key: MonitorCaptureKey): Promise<MediaStream> {
    const existing = inputMonitoringSession.pendingRequests.get(key);
    if (existing) {
        return existing;
    }
    const request = navigator.mediaDevices.getUserMedia({ audio: deviceConstraints(key) });
    inputMonitoringSession.pendingRequests.set(key, request);
    void request.then(
        (stream) => {
            const ownsRequest = inputMonitoringSession.pendingRequests.get(key) === request;
            try {
                settleCaptureGrant(key, request, stream);
            } catch (error) {
                releaseFailedCaptureGrant(key, stream, error, ownsRequest);
            }
        },
        () => {
            refuseCaptureGrant(key, request);
        }
    );
    return request;
}

/** A failed graph attachment still owns a granted device until its terminal cleanup completes. */
function releaseFailedCaptureGrant(
    key: MonitorCaptureKey,
    stream: MediaStream,
    error: unknown,
    ownsRequest: boolean
): void {
    const capture = inputMonitoringSession.captures.get(key);
    const ownsCapture = capture?.monitorStream === stream;
    if (ownsRequest && !inputMonitoringSession.pendingRequests.has(key) && (!capture || ownsCapture)) {
        for (const trackId of monitorOwnersFor(key)) {
            inputMonitoringSession.trackKeys.delete(trackId);
            inputMonitoringAdmissionChecks.delete(trackId);
        }
    }
    try {
        if (capture && ownsCapture) {
            capture.monitorEdges.clear();
            releaseMonitorCapture(key);
        } else {
            stopStreamTracks(stream);
        }
    } catch (cleanupError) {
        logger.error(new Error('Failed to release granted input monitoring', { cause: cleanupError }));
    }
    logger.error(new Error('Failed to attach granted input monitoring', { cause: error }));
}

/** Adopts a granted stream, or releases a superseded one exactly once. */
function settleCaptureGrant(key: MonitorCaptureKey, request: Promise<MediaStream>, stream: MediaStream): void {
    if (inputMonitoringSession.pendingRequests.get(key) !== request) {
        stopSupersededCaptureStream(stream);
        return;
    }
    inputMonitoringSession.pendingRequests.delete(key);
    const interested = monitorOwnersFor(key);
    for (const trackId of interested) {
        const isCurrent = inputMonitoringAdmissionChecks.get(trackId);
        if (isCurrent && !isCurrent()) {
            interested.delete(trackId);
            inputMonitoringSession.trackKeys.delete(trackId);
            inputMonitoringAdmissionChecks.delete(trackId);
        }
    }
    if (interested.size === 0) {
        stopSupersededCaptureStream(stream);
        return;
    }
    const capture: MonitorCapture = {
        monitorStream: stream,
        monitorSource: audioEngine.context.createMediaStreamSource(stream),
        monitorEdges: new Map(),
    };
    inputMonitoringSession.captures.set(key, capture);
    for (const trackId of interested) {
        if (inputMonitoringAdmissionChecks.get(trackId)?.() === 'retain') {
            continue;
        }
        try {
            connectMonitorEdge(trackId, capture);
        } catch (error) {
            inputMonitoringSession.trackKeys.delete(trackId);
            inputMonitoringAdmissionChecks.delete(trackId);
            logger.error(new Error(`Failed to attach granted input monitoring on track ${trackId}`, { cause: error }));
        }
    }
    if (monitorOwnersFor(key).size === 0) {
        try {
            releaseMonitorCapture(key);
        } catch (error) {
            logger.error(new Error('Failed to release unattached input monitoring', { cause: error }));
        }
    }
}

function stopSupersededCaptureStream(stream: MediaStream): void {
    try {
        stopStreamTracks(stream);
    } catch (error) {
        logger.error(new Error('Failed to release granted input monitoring', { cause: error }));
    }
}

/** Drops this key's pending interest so a later start acquires afresh. */
function refuseCaptureGrant(key: MonitorCaptureKey, request: Promise<MediaStream>): void {
    if (inputMonitoringSession.pendingRequests.get(key) !== request) {
        return;
    }
    inputMonitoringSession.pendingRequests.delete(key);
    for (const trackId of monitorOwnersFor(key)) {
        inputMonitoringSession.trackKeys.delete(trackId);
        inputMonitoringAdmissionChecks.delete(trackId);
    }
}

function connectMonitorEdge(trackId: string, capture: MonitorCapture): void {
    // Reconnect to the current strip: HMR can replace strips under a live edge.
    const strip = audioEngine.ensureTrackStrip(trackId);
    const previous = capture.monitorEdges.get(trackId);
    if (previous !== undefined && previous !== strip.gainNode) {
        capture.monitorSource.disconnect(previous);
    }
    capture.monitorSource.connect(strip.gainNode);
    capture.monitorEdges.set(trackId, strip.gainNode);
}

function deviceConstraints(inputId: MonitorCaptureKey): MediaTrackConstraints {
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
