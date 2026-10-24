import { type EngineTransportPosition } from '../../models/EngineTransportPosition';
import {
    type NativeRecordingAdmission,
    type NativeRecordingGeometry,
    type NativeRecordingRootWitness,
} from '../../models/NativeRecordingCapture';

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
let admissionSerial = 0;
let feedGeneration = 0;
let mutationSerial = 0;
type MutationKind = 'maps' | 'locate' | 'start';
type CaptureMutation = Readonly<{
    serial: number;
    session: number;
    feedGeneration: number;
    root: NativeRecordingRootWitness | null;
    kind: MutationKind;
}>;
type Mutation = {
    token: CaptureMutation;
    outcome: 'pending' | 'applied' | 'rejected' | 'unknown';
    admission: number | null;
};
const mutations = new Map<number, Mutation>();
const owners = new Set<WeakRef<RecordingCaptureClockOwner>>();

function resetNativeRecordingCaptureClock(): void {
    feedGeneration++;
    mutations.clear();
    calibration = null;
    datedReading = null;
}

function beginCaptureMutation(kind: MutationKind = 'locate', owner?: NativeRecordingRootWitness): CaptureMutation {
    const token = {
        serial: ++mutationSerial,
        session: nativeLiveGraphSession.rearmEpoch,
        feedGeneration,
        root: owner ?? nativeLiveGraphSession.captureAdmissions.at(-1)?.owner ?? null,
        kind,
    };
    mutations.set(token.serial, { token, outcome: 'pending', admission: null });
    return token;
}

function settleCaptureMutation(token: CaptureMutation, outcome: 'applied' | 'rejected' | 'unknown'): boolean {
    const mutation = mutations.get(token.serial);
    if (
        mutation?.token !== token ||
        token.session !== nativeLiveGraphSession.rearmEpoch ||
        token.feedGeneration !== feedGeneration ||
        !token.root?.isCurrent()
    ) {
        return false;
    }
    mutation.outcome = outcome;
    return true;
}

function authorizesForward(admission: NativeRecordingAdmission, rootIdentity: string): boolean {
    if (admission.serial !== nativeLiveGraphSession.captureAdmissions.at(-1)?.serial) {
        return false;
    }
    for (const mutation of mutations.values()) {
        const root = mutation.token.root;
        if (
            mutation.token.session !== nativeLiveGraphSession.rearmEpoch ||
            mutation.token.feedGeneration !== feedGeneration ||
            !root ||
            root.identity !== rootIdentity ||
            !root.isCurrent() ||
            mutation.outcome === 'rejected'
        ) {
            continue;
        }
        const installed = nativeLiveGraphSession.captureAdmissions.find(
            (candidate) => candidate.serial === mutation.admission
        );
        if (mutation.outcome === 'applied' && installed && installed.admittedBatch <= admission.admittedBatch) {
            continue;
        }
        // Only a later witnessed replacement of the same transport facet can
        // settle an uncertain operation. A maps receipt cannot settle a locate.
        const superseded =
            mutation.outcome !== 'pending' &&
            [...mutations.values()].some((later) => {
                const replacement = nativeLiveGraphSession.captureAdmissions.find(
                    (candidate) => candidate.serial === later.admission
                );
                return (
                    later.token.serial > mutation.token.serial &&
                    later.outcome === 'applied' &&
                    replacement &&
                    replacement.admittedBatch <= admission.admittedBatch &&
                    (later.token.kind === 'start' || later.token.kind === mutation.token.kind)
                );
            });
        if (!superseded) {
            return false;
        }
    }
    return true;
}

/** Request/settlement enclose the query, not the callback's presentation edge. */
function observeNativeRecordingCaptureClock(
    reading: EngineTransportPosition,
    sentSeconds: number,
    receivedSeconds: number
): void {
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
    // Raw callback dates are retained before any input's first-frame reader is
    // admitted. Output timestamp availability must not erase that history.
    for (const reference of owners) {
        const owner = reference.deref();
        if (owner) {
            owner.observe();
        } else {
            owners.delete(reference);
        }
    }
}

function retainNativeRecordingAdmission(
    geometry: NativeRecordingGeometry | undefined,
    admittedBatch: number | null,
    located = false,
    mutation?: CaptureMutation,
    owner?: NativeRecordingRootWitness
): void {
    if (admittedBatch === null || !Number.isSafeInteger(admittedBatch) || admittedBatch < 0) {
        if (mutation) {
            settleCaptureMutation(mutation, 'unknown');
        }
        return;
    }
    const root = mutation?.root ?? owner;
    if (!root?.isCurrent()) {
        return;
    }
    const serial = ++admissionSerial;
    if (mutation) {
        const operation = mutations.get(mutation.serial);
        if (!operation || operation.token !== mutation) {
            return;
        }
        operation.admission = serial;
    }
    nativeLiveGraphSession.captureAdmissions.push({
        owner: root,
        geometry: geometry ?? null,
        admittedBatch,
        serial,
        located,
        rootIdentity: root.identity,
    });
    nativeLiveGraphSession.captureAdmissions.sort((left, right) => left.admittedBatch - right.admittedBatch);
}

function admittedGeometry(batchesApplied: number, rootIdentity: string): NativeRecordingAdmission | null {
    const admissions = nativeLiveGraphSession.captureAdmissions;
    let index = admissions.length - 1;
    while (
        index >= 0 &&
        (admissions[index]!.admittedBatch > batchesApplied ||
            admissions[index]!.rootIdentity !== rootIdentity)
    ) {
        index--;
    }
    if (index < 0) {
        return null;
    }
    const admitted = admissions[index]!;
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
    /** First genuinely observed point of this same admitted epoch. */
    observedFrom?: Readonly<{ songSeconds: number; contextSeconds: number; loopWraps: number }>;
    /** At most the first/latest observed points of each epoch held by this owner. */
    observations?: readonly NativeRecordingCaptureSnapshot[];
    forwardAuthorized?: boolean;
    sampleRate?: number;
}>;

export type NativeRecordingCaptureRead =
    | { carrier: 'browser' }
    | { carrier: 'native'; status: 'unavailable' }
    | { carrier: 'native'; status: 'available'; snapshot: NativeRecordingCaptureSnapshot };

export const nativeRecordingCaptureClockState = {
    reset: resetNativeRecordingCaptureClock,
    observe: observeNativeRecordingCaptureClock,
    retainAdmission: retainNativeRecordingAdmission,
    beginMutation: beginCaptureMutation,
    settleMutation: settleCaptureMutation,
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

type CaptureContext = Partial<Pick<AudioContext, 'getOutputTimestamp' | 'state'>>;
type RawObservation = Readonly<{
    reading: EngineTransportPosition;
    admission: NativeRecordingAdmission;
    geometry: NativeRecordingGeometry;
    authorized: boolean;
}>;
type RawEpoch = { first: RawObservation; latest: RawObservation };

function usableObservation(reading: EngineTransportPosition | null): reading is EngineTransportPosition {
    return Boolean(
        reading?.running &&
        reading.playing &&
        reading.captureClock &&
        Number.isFinite(reading.positionSeconds) &&
        Number.isSafeInteger(reading.playheadFrame) &&
        reading.playheadFrame >= 0 &&
        Number.isSafeInteger(reading.loopWraps) &&
        reading.loopWraps >= 0 &&
        Number.isSafeInteger(reading.batchesApplied) &&
        reading.batchesApplied >= 0
    );
}

/** Implementation state stays private to the existing per-recording callable. */
class RecordingCaptureClockOwner {
    constructor(private readonly root: NativeRecordingRootWitness) {
        owners.add(new WeakRef(this));
    }
    observe(): void {
        this.retain();
    }
    private frozen: Calibration | null = null;
    private session: number | null = nativeLiveGraphSession.audibleCarrier ? nativeLiveGraphSession.rearmEpoch : null;
    private generation: number | null = nativeLiveGraphSession.audibleCarrier ? feedGeneration : null;
    private interrupted = false;
    private readonly epochs = new Map<number, RawEpoch>();
    last: NativeRecordingCaptureSnapshot | null = null;

    private isCompatibleClock(
        stamp: NonNullable<EngineTransportPosition['captureClock']>,
        current: Calibration
    ): boolean {
        return (
            this.session === nativeLiveGraphSession.rearmEpoch &&
            this.generation === feedGeneration &&
            this.frozen!.epoch === stamp.epoch &&
            this.frozen!.streamEpoch === stamp.streamEpoch &&
            this.frozen!.lowerOffset <= current.upperOffset &&
            this.frozen!.upperOffset >= current.lowerOffset
        );
    }

    private retain(): RawObservation | null {
        const reading = datedReading;
        const currentCalibration = calibration;
        if (
            !this.root.isCurrent() ||
            !nativeLiveGraphSession.audibleCarrier ||
            !usableObservation(reading) ||
            !currentCalibration ||
            this.interrupted
        ) {
            return null;
        }
        const stamp = reading.captureClock!;
        const admission = admittedGeometry(reading.batchesApplied, this.root.identity);
        if (!admission?.geometry) {
            return null;
        }
        this.frozen ??= currentCalibration;
        this.session ??= nativeLiveGraphSession.rearmEpoch;
        this.generation ??= feedGeneration;
        if (!this.isCompatibleClock(stamp, currentCalibration)) {
            this.interrupted = true;
            return null;
        }
        const raw = {
            reading,
            admission,
            geometry: admission.geometry,
            authorized: authorizesForward(admission, this.root.identity),
        };
        const epoch = this.epochs.get(admission.serial);
        if (epoch) {
            const previous = epoch.latest.reading;
            if (
                stamp.presentationSeconds < previous.captureClock!.presentationSeconds ||
                reading.loopWraps < previous.loopWraps ||
                (stamp.presentationSeconds === previous.captureClock!.presentationSeconds &&
                    (reading.positionSeconds !== previous.positionSeconds || reading.loopWraps !== previous.loopWraps))
            ) {
                this.interrupted = true;
                return null;
            }
            epoch.latest = raw;
        } else {
            this.epochs.set(admission.serial, { first: raw, latest: raw });
        }
        return raw;
    }

    get admission() {
        const raw = this.retain();
        if (!raw) {
            return null;
        }
        if (!raw.authorized) {
            return null;
        }
        return { serial: raw.admission.serial, clockIdentity: this.clockIdentity(), loopWraps: raw.reading.loopWraps };
    }

    private clockIdentity(): string {
        return `${this.frozen!.epoch}:${this.frozen!.streamEpoch}:${this.session}:${this.generation}`;
    }

    private map(raw: RawObservation, timestamp: AudioTimestamp): NativeRecordingCaptureSnapshot {
        const stamp = raw.reading.captureClock!;
        const frozen = this.frozen!;
        const outputContext = timestamp.contextTime!;
        const outputPerformance = timestamp.performanceTime! / 1000;
        return {
            songSeconds: raw.reading.positionSeconds,
            // Differences precede the large origins, including retrospective dates.
            contextSeconds:
                outputContext +
                (stamp.presentationSeconds -
                    frozen.nativeAnchorSeconds +
                    (frozen.rendererAnchorSeconds - outputPerformance)),
            audibleContextSeconds: outputContext + (performance.now() / 1000 - outputPerformance),
            loopWraps: raw.reading.loopWraps,
            admission: raw.admission,
            geometry: raw.geometry,
            clockIdentity: this.clockIdentity(),
            uncertaintySeconds: (frozen.upperOffset - frozen.lowerOffset) / 2,
            calibrationAgeSeconds: Math.max(0, performance.now() / 1000 - frozen.measuredAtSeconds),
            localUncertaintySeconds: stamp.uncertaintySeconds,
            quality: stamp.quality,
            sampleRate: stamp.sampleRate,
            forwardAuthorized: raw.authorized,
        };
    }

    read(context: CaptureContext): NativeRecordingCaptureRead {
        if (!nativeLiveGraphSession.audibleCarrier) {
            return { carrier: 'browser' };
        }
        const unavailable = { carrier: 'native', status: 'unavailable' } as const;
        if (context.state !== 'running') {
            this.interrupted = true;
            resetNativeRecordingCaptureClock();
            return unavailable;
        }
        const raw = this.retain();
        const timestamp = readOutputTimestamp(context);
        if (!raw || !timestamp) {
            return unavailable;
        }
        const observations: NativeRecordingCaptureSnapshot[] = [];
        for (const epoch of this.epochs.values()) {
            const first = this.map(epoch.first, timestamp);
            const observedFrom = {
                songSeconds: first.songSeconds,
                contextSeconds: first.contextSeconds,
                loopWraps: first.loopWraps,
            };
            observations.push({ ...first, observedFrom });
            if (epoch.latest !== epoch.first) {
                observations.push({ ...this.map(epoch.latest, timestamp), observedFrom });
            }
        }
        const current = observations.findLast((point) => point.admission.serial === raw.admission.serial)!;
        this.last = { ...current, observations };
        return { carrier: 'native', status: 'available', snapshot: this.last };
    }
}

/** Each recording freezes its correlation; receipt lag cannot redate its PCM. */
export function createNativeRecordingCaptureClock(root: NativeRecordingRootWitness) {
    const owner = new RecordingCaptureClockOwner(root);
    return {
        get admission() {
            return owner.admission;
        },
        get last() {
            return owner.last;
        },
        read: (context: CaptureContext): NativeRecordingCaptureRead => owner.read(context),
    };
}
