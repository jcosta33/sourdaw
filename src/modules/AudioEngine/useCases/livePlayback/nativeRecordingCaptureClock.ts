import { type EngineTransportPosition } from '../../models/EngineTransportPosition';
import { type NativeRecordingAdmission, type NativeRecordingGeometry } from '../../models/NativeRecordingCapture';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

type Calibration = Readonly<{
    epoch: number;
    streamEpoch: number;
    lowerOffset: number;
    upperOffset: number;
    nativeAnchorSeconds: number;
    rendererAnchorSeconds: number;
    measuredAtSeconds: number;
}>;

let calibration: Calibration | null = null;
let datedReading: EngineTransportPosition | null = null;
let latestReading: EngineTransportPosition | null = null;
let admissionSerial = 0;

function resetNativeRecordingCaptureClock(): void {
    calibration = null;
    datedReading = null;
    latestReading = null;
}

/** Request/settlement enclose the query, not the callback's presentation edge. */
function observeNativeRecordingCaptureClock(
    reading: EngineTransportPosition,
    sentSeconds: number,
    receivedSeconds: number
): void {
    latestReading = reading;
    const stamp = reading.captureClock;
    const query = reading.captureClockQuery;
    datedReading = null;
    if (!stamp || !query || stamp.epoch !== query.epoch || receivedSeconds < sentSeconds) {
        return;
    }
    const lowerOffset = sentSeconds - query.enteredSeconds;
    const upperOffset = receivedSeconds - query.leavingSeconds;
    if (!Number.isFinite(lowerOffset) || !Number.isFinite(upperOffset) || lowerOffset > upperOffset) {
        calibration = null;
        return;
    }
    const sameClock = calibration?.epoch === stamp.epoch && calibration.streamEpoch === stamp.streamEpoch;
    if (sameClock && calibration && (lowerOffset > calibration.upperOffset || upperOffset < calibration.lowerOffset)) {
        // A discontinuity cannot silently move a recording's frozen clock.
        calibration = null;
        return;
    }
    if (!sameClock || !calibration || upperOffset - lowerOffset < calibration.upperOffset - calibration.lowerOffset) {
        calibration = {
            epoch: stamp.epoch,
            streamEpoch: stamp.streamEpoch,
            lowerOffset,
            upperOffset,
            nativeAnchorSeconds: query.enteredSeconds,
            rendererAnchorSeconds: sentSeconds + (upperOffset - lowerOffset) / 2,
            measuredAtSeconds: receivedSeconds,
        };
    }
    datedReading = reading;
}

function retainNativeRecordingAdmission(
    geometry: NativeRecordingGeometry | undefined,
    admittedBatch: number | null,
    located = false
): void {
    if (admittedBatch === null || !Number.isSafeInteger(admittedBatch) || admittedBatch < 0) {
        nativeLiveGraphSession.captureAdmissions = [];
        return;
    }
    nativeLiveGraphSession.captureAdmissions.push({
        geometry: geometry ?? null,
        admittedBatch,
        serial: ++admissionSerial,
        located,
    });
}

function admittedGeometry(batchesApplied: number): NativeRecordingAdmission | null {
    const admissions = nativeLiveGraphSession.captureAdmissions;
    let index = admissions.length - 1;
    while (index >= 0 && admissions[index]!.admittedBatch > batchesApplied) {
        index--;
    }
    if (index < 0) {
        return null;
    }
    const admitted = admissions[index]!;
    // Older snapshots are already retained by recording owners. Keep the live
    // admitted geometry and every command still waiting for its native fence.
    if (index > 0) {
        admissions.splice(0, index);
    }
    return admitted;
}

export type NativeRecordingCaptureSnapshot = Readonly<{
    songSeconds: number;
    contextSeconds: number;
    audibleContextSeconds: number;
    loopWraps: number;
    admission: NativeRecordingAdmission;
    geometry: NativeRecordingGeometry;
    clockIdentity: string;
    uncertaintySeconds: number;
    calibrationAgeSeconds: number;
    localUncertaintySeconds: number | null;
    quality: 'estimated' | 'degraded';
}>;

export type NativeRecordingCaptureRead =
    | { carrier: 'browser' }
    | { carrier: 'native'; status: 'unavailable' }
    | { carrier: 'native'; status: 'available'; snapshot: NativeRecordingCaptureSnapshot };

export const nativeRecordingCaptureClockState = {
    reset: resetNativeRecordingCaptureClock,
    observe: observeNativeRecordingCaptureClock,
    retainAdmission: retainNativeRecordingAdmission,
};

function readOutputTimestamp(context: Partial<Pick<AudioContext, 'getOutputTimestamp'>>): AudioTimestamp | null {
    try {
        const timestamp = context.getOutputTimestamp?.();
        if (
            !timestamp ||
            !Number.isFinite(timestamp.contextTime) ||
            !Number.isFinite(timestamp.performanceTime) ||
            timestamp.performanceTime! <= 0 ||
            timestamp.contextTime! <= 0
        ) {
            return null;
        }
        return timestamp;
    } catch {
        return null;
    }
}

/** Each recording freezes its correlation; receipt lag cannot redate its PCM. */
export function createNativeRecordingCaptureClock() {
    let frozen: Calibration | null = null;
    let session: number | null = nativeLiveGraphSession.audibleCarrier ? nativeLiveGraphSession.rearmEpoch : null;
    let last: NativeRecordingCaptureSnapshot | null = null;
    let interrupted = false;
    return {
        get admission() {
            const stamp = latestReading?.captureClock;
            const admission = latestReading ? admittedGeometry(latestReading.batchesApplied) : null;
            if (!stamp || !admission?.geometry) {
                return null;
            }
            return { serial: admission.serial, clockIdentity: `${stamp.epoch}:${stamp.streamEpoch}` };
        },
        get last() {
            return last;
        },
        read(context: Partial<Pick<AudioContext, 'getOutputTimestamp' | 'state'>>): NativeRecordingCaptureRead {
            if (!nativeLiveGraphSession.audibleCarrier) {
                return { carrier: 'browser' };
            }
            const unavailable = { carrier: 'native', status: 'unavailable' } as const;
            if (context.state !== 'running') {
                interrupted = true;
                resetNativeRecordingCaptureClock();
                return unavailable;
            }
            if (interrupted) {
                return unavailable;
            }
            const reading = datedReading;
            const stamp = reading?.captureClock;
            if (!reading?.running || !reading.playing || !stamp || !calibration) {
                return unavailable;
            }
            const timestamp = readOutputTimestamp(context);
            if (!timestamp) {
                return unavailable;
            }
            const admission = admittedGeometry(reading.batchesApplied);
            if (!admission?.geometry) {
                return unavailable;
            }
            frozen ??= calibration;
            session ??= nativeLiveGraphSession.rearmEpoch;
            if (
                session !== nativeLiveGraphSession.rearmEpoch ||
                frozen.epoch !== stamp.epoch ||
                frozen.streamEpoch !== stamp.streamEpoch ||
                frozen.lowerOffset > calibration.upperOffset ||
                frozen.upperOffset < calibration.lowerOffset
            ) {
                return unavailable;
            }
            const outputContextSeconds = timestamp.contextTime!;
            const outputPerformanceSeconds = timestamp.performanceTime! / 1000;
            last = {
                songSeconds: reading.positionSeconds,
                // Form differences within each clock before adding the output
                // origin. rendererAnchor-nativeAnchor is the same midpoint
                // offset, without summing two large origins then subtracting one.
                contextSeconds:
                    outputContextSeconds +
                    (stamp.presentationSeconds -
                        frozen.nativeAnchorSeconds +
                        (frozen.rendererAnchorSeconds - outputPerformanceSeconds)),
                audibleContextSeconds: outputContextSeconds + (performance.now() / 1000 - outputPerformanceSeconds),
                loopWraps: reading.loopWraps,
                admission,
                geometry: admission.geometry,
                clockIdentity: `${frozen.epoch}:${frozen.streamEpoch}`,
                uncertaintySeconds: (frozen.upperOffset - frozen.lowerOffset) / 2,
                calibrationAgeSeconds: Math.max(0, performance.now() / 1000 - frozen.measuredAtSeconds),
                localUncertaintySeconds: stamp.uncertaintySeconds,
                quality: stamp.quality,
            };
            return { carrier: 'native', status: 'available', snapshot: last };
        },
    };
}
