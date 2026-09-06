/**
 * A track's automation, projected into the contract's `write-parameter`
 * shape (#2225, #3068).
 *
 * `scheduleTrackAutomation` carries the lane laws — link resolution, the
 * decibel fader law, the VCA fold, the send clamp, clip windows, tempo
 * projection, latency compensation — and speaks them onto `AudioParam`s. The
 * desktop export runs it against a recording parameter
 * (`createAutomationRecorder`) and converts what was recorded
 * (`convertRecordedAutomationEvents`) rather than keeping a second copy of
 * those laws; this module is that recording-and-converting projection, pulled
 * out of the export so the live producer (`projectLiveAutomationWrites.ts`)
 * can run the identical projection instead of a second one that agrees today
 * and drifts tomorrow.
 *
 * Times on every returned write are relative to `regionStartSeconds`, exactly
 * as `compileAutomationEvents` emits them — this projection adds nothing to
 * them. The export caller has always treated the region start as the write
 * origin; the live caller adds `regionStartSeconds` back to reach its
 * absolute engine clock (see `projectLiveAutomationWrites.ts`).
 *
 * ── Device parameters ───────────────────────────────────────────────────
 *
 * A caller that can name devices the backend will actually accept a parameter
 * write for hands them in ({@link StripAutomationWritesInput.deviceEntries}),
 * and each one's lanes come back as `device-parameter` entries carrying step
 * writes (#3568). A caller that names none gets exactly what this projection
 * gave before: the scheduler resolves a device lane against an empty chain and
 * drops it, which is what the export wants and what main did for an orphan
 * lane.
 */

import { type Track } from '#/modules/Arrangement/stores';

import {
    type AudioGraphParameterTarget,
    type AudioGraphParameterWrite,
    type AudioGraphStripParameterTarget,
} from '../../models/AudioGraphBackend';
import { type AutomationLane } from '../../models/AutomationViewTypes';
import { type OfflineAutomationSegment } from '../../repositories/deviceStrategy/AudioDeviceStrategy';
import {
    scheduleTrackAutomation,
    type OfflineDeviceAutomationLaw,
} from '../../repositories/offlineScheduler/automationScheduling';

import { clipBoundsById } from './clipBoundsById';
import { convertRecordedAutomationEvents } from './convertRecordedAutomationEvents';
import { convertRecordedAutomationSegments } from './convertRecordedAutomationSegments';
import { createAutomationRecorder, type AutomationRecorder } from './createAutomationRecorder';

/**
 * One device on this strip whose parameters the caller's backend can carry.
 *
 * A hosted plugin carries its instance id because the law it is held to is the
 * instance's own published parameter list — a question no device type answers,
 * since every external plugin device spells the same type. A built-in the
 * engine addresses by its own vocabulary carries none: its law is the device
 * type's declared descriptor, which the type alone already names.
 */
export type StripAutomationDeviceEntry = Readonly<{
    deviceId: string;
    deviceType: string;
    externalInstanceId?: string;
}>;

export type StripAutomationWritesEntry = Readonly<{
    target: AudioGraphParameterTarget;
    writes: readonly AudioGraphParameterWrite[];
}>;

export type StripAutomationWritesResult =
    | Readonly<{ outcome: 'converted'; entries: readonly StripAutomationWritesEntry[] }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

export type StripAutomationWritesInput = Readonly<{
    track: Track;
    /**
     * Bus ids this strip's sends may actually address — the same admission
     * `sendCommands` applies in `renderOfflineWithNativeEngine.ts` and
     * `admittedSendBusIds` applies in `livePlayback/admittedSendBusIds.ts`.
     * A send the caller did not admit gets no recorder and no target here,
     * matching that its `add-send` command was never emitted either.
     */
    admittedSendBusIds: readonly string[];
    lanes: readonly AutomationLane[];
    regionStartSeconds: number;
    durationSeconds: number;
    defaultTempo: number;
    changes: readonly { beat: number; tempo: number }[];
    projectBeatToSeconds: (beat: number) => number;
    sampleRate: number;
    compensationDelaySec: number;
    vcaMultiplier: number;
    slewTickSeconds: number;
    resolveLaneCeiling: (lane: Pick<AutomationLane, 'parameterId' | 'minValue' | 'maxValue' | 'clipId'>) => number;
    /**
     * Devices on this strip whose parameter lanes the caller wants converted.
     * Omitted — the export's own case — means no device lane resolves at all.
     */
    deviceEntries?: readonly StripAutomationDeviceEntry[];
    /**
     * The law those entries are held to. Omitted with {@link deviceEntries},
     * because a caller that names devices without a law would be asking this
     * projection to invent one.
     */
    deviceParameterLaw?: OfflineDeviceAutomationLaw;
}>;

/**
 * Fader node-domain back to the seam's stored linear amplitude.
 *
 * The scheduler recorded `clampFaderGain(converted * vcaMultiplier)`; the seam
 * wants the value **pre-clamp and pre-VCA**, because the backend folds the VCA
 * and applies the fader clamp itself (`AudioGraphStripParameterTarget`).
 * Dividing the multiplier back out is exact under the round trip: the backend
 * computes `clamp(seam * vca) = clamp(clamp(x * vca)) = clamp(x * vca)`, the
 * very value the web path wrote. A zero multiplier silences the strip whatever
 * the lane holds, so any finite seam value is faithful — `0` is used.
 */
function seamFaderValue(recorded: number, vcaMultiplier: number): number {
    return vcaMultiplier === 0 ? 0 : recorded / vcaMultiplier;
}

/** Pan node-domain (−1…1) back to the seam's −50…50 project scale. */
function seamPanValue(recorded: number): number {
    return recorded * 50;
}

/**
 * What a caller that names no devices is held to.
 *
 * With an empty entry list this law's `acceptsAutomation` never actually runs
 * — it states the refusal explicitly rather than leaving it as an implication
 * of an empty list. `scheduleTrackAutomation` resolves a device-parameter lane
 * against the entries, finds nothing, and silently drops it — the same outcome
 * main gave a project holding an orphan lane on a device the user has since
 * removed (`prepareRemoveDevice.ts` deletes the device, never its lanes). This
 * projection preserves that silent drop rather than declining the whole strip
 * over it; the live producer names such a lane on its own
 * (`projectLiveAutomationWrites.ts`), because live has an exclusion channel
 * the export does not.
 *
 * Exported because a caller that *could* name devices but has no law to judge
 * them by is held to the same refusal — see `readLiveAutomationWrites.ts`, whose
 * seam may be unwired. Two copies of "no device parameter is carried" is one
 * copy too many: a later loosening of one of them would silently split the
 * export's behaviour from the live producer's.
 */
export const REFUSE_DEVICE_AUTOMATION: OfflineDeviceAutomationLaw = {
    acceptsAutomation: () => false,
    clampValue: ({ value }) => value,
    quantiseValue: ({ value }) => value,
};

/** What one named device's lanes compiled to, by parameter, in the order they were scheduled. */
type RecordedDeviceSegments = Map<string, readonly OfflineAutomationSegment[]>;

/**
 * A scheduler device entry that records rather than plays.
 *
 * `resolveOfflineAutomation` answers for every parameter it is asked about,
 * because whether the parameter may be automated at all has already been
 * settled by the caller's law — the binding's job is only to say how the curve
 * reaches the device, and for a device the backend addresses by name that is
 * the segment stream, never an `AudioParam` this side owns.
 */
function recordingDeviceEntry(entry: StripAutomationDeviceEntry, recorded: RecordedDeviceSegments) {
    return {
        deviceId: entry.deviceId,
        deviceType: entry.deviceType,
        strategy: {
            resolveOfflineAutomation: (parameterId: string) => ({
                kind: 'segments' as const,
                apply: (segments: readonly OfflineAutomationSegment[]): void => {
                    recorded.set(parameterId, segments);
                },
            }),
        },
    };
}

/**
 * The device-parameter entries one strip's recorded segments compile into.
 *
 * A parameter no lane touched recorded nothing and gets no entry, for the same
 * reason an untouched strip position gets none: "no entry" and "converted,
 * wrote nothing" then read the same to every caller.
 */
function deviceParameterEntries(input: {
    trackId: string;
    deviceEntries: readonly StripAutomationDeviceEntry[];
    recordedByDeviceId: ReadonlyMap<string, RecordedDeviceSegments>;
    sampleRate: number;
}): StripAutomationWritesEntry[] {
    const { trackId, deviceEntries, recordedByDeviceId, sampleRate } = input;
    const entries: StripAutomationWritesEntry[] = [];
    for (const entry of deviceEntries) {
        for (const [parameterId, segments] of recordedByDeviceId.get(entry.deviceId)!) {
            const writes = convertRecordedAutomationSegments({ segments, sampleRate });
            if (writes.length > 0) {
                entries.push({
                    target: { kind: 'device-parameter', trackId, deviceId: entry.deviceId, parameterId },
                    writes,
                });
            }
        }
    }
    return entries;
}

export function projectStripAutomationWrites(input: StripAutomationWritesInput): StripAutomationWritesResult {
    const {
        track,
        admittedSendBusIds,
        lanes,
        regionStartSeconds,
        durationSeconds,
        defaultTempo,
        changes,
        projectBeatToSeconds,
        sampleRate,
        compensationDelaySec,
        vcaMultiplier,
        slewTickSeconds,
        resolveLaneCeiling,
        deviceEntries = [],
        deviceParameterLaw = REFUSE_DEVICE_AUTOMATION,
    } = input;

    // The same lane set, gate and grain the web scheduler reads
    // (`scheduleTrackClips`); the mixdown always includes mixer lanes.
    if (track.automationMode === 'off') {
        return { outcome: 'converted', entries: [] };
    }

    const gainRecorder = createAutomationRecorder();
    const panRecorder = createAutomationRecorder();
    const sendRecorders: { busId: string; recorder: AutomationRecorder }[] = [];
    const sendAutomationParams = new Map<string, AudioParam>();
    for (const busId of admittedSendBusIds) {
        const recorder = createAutomationRecorder();
        sendRecorders.push({ busId, recorder });
        sendAutomationParams.set(`send:${busId}`, recorder.param);
    }

    const recordedByDeviceId = new Map<string, RecordedDeviceSegments>(
        deviceEntries.map((entry): [string, RecordedDeviceSegments] => [entry.deviceId, new Map()])
    );

    scheduleTrackAutomation({
        lanes: [...lanes],
        trackId: track.id,
        trackGainNode: { gain: gainRecorder.param },
        trackPanNode: { pan: panRecorder.param },
        sendAutomationParams,
        deviceEntries: deviceEntries.map((entry) =>
            recordingDeviceEntry(entry, recordedByDeviceId.get(entry.deviceId)!)
        ),
        durationSeconds,
        defaultTempo,
        changes: [...changes],
        slewTickSeconds,
        deviceParameterLaw,
        regionStartSeconds,
        projectBeatToSeconds,
        sampleRate,
        compensationDelaySec,
        clipBoundsById: clipBoundsById(track),
        vcaMultiplier,
        resolveLaneCeiling,
    });

    const conversions: {
        target: AudioGraphStripParameterTarget;
        recorder: AutomationRecorder;
        valueToSeam: (value: number) => number;
    }[] = [
        {
            target: { kind: 'track-fader', trackId: track.id },
            recorder: gainRecorder,
            valueToSeam: (value) => seamFaderValue(value, vcaMultiplier),
        },
        {
            target: { kind: 'track-pan', trackId: track.id },
            recorder: panRecorder,
            valueToSeam: seamPanValue,
        },
        ...sendRecorders.map(({ busId, recorder }) => ({
            target: { kind: 'track-send-level', trackId: track.id, busId } as const,
            recorder,
            valueToSeam: (value: number) => value,
        })),
    ];

    const entries: StripAutomationWritesEntry[] = [];
    for (const { target, recorder, valueToSeam } of conversions) {
        const converted = convertRecordedAutomationEvents({ events: recorder.events, sampleRate, valueToSeam });
        if (converted.outcome === 'declined') {
            return {
                outcome: 'declined',
                reason: `automation on track "${track.name}": ${converted.reason}`,
            };
        }
        // A target with nothing recorded (no lane touched it) carries no
        // information forward — omitting it here is what lets the live
        // producer treat "no entry" and "converted, wrote nothing" the same
        // way, without every caller re-filtering empty write lists itself.
        if (converted.writes.length > 0) {
            entries.push({ target, writes: converted.writes });
        }
    }
    entries.push(...deviceParameterEntries({ trackId: track.id, deviceEntries, recordedByDeviceId, sampleRate }));
    return { outcome: 'converted', entries };
}
