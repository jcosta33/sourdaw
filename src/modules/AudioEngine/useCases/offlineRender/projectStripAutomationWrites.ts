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
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphParameterWrite, type AudioGraphStripParameterTarget } from '../../models/AudioGraphBackend';
import { type AutomationLane } from '../../models/AutomationViewTypes';
import {
    scheduleTrackAutomation,
    type OfflineDeviceAutomationLaw,
} from '../../repositories/offlineScheduler/automationScheduling';

import { clipBoundsById } from './clipBoundsById';
import { convertRecordedAutomationEvents } from './convertRecordedAutomationEvents';
import { createAutomationRecorder, type AutomationRecorder } from './createAutomationRecorder';

export type StripAutomationWritesEntry = Readonly<{
    target: AudioGraphStripParameterTarget;
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
 * No built-in device has a native automation body yet (#3124). `deviceEntries`
 * stays empty below because there is nothing to resolve a device lane
 * against, so this law's `acceptsAutomation` never actually runs — it exists
 * to state the refusal explicitly rather than leave it as an implication of
 * an empty list. `scheduleTrackAutomation` resolves a device-parameter lane
 * against `deviceEntries`, finds nothing, and silently drops it — the same
 * outcome main gave a project holding an orphan lane on a device the user has
 * since removed (`prepareRemoveDevice.ts` deletes the device, never its
 * lanes). This projection preserves that silent drop rather than declining
 * the whole strip over it; the live producer detects and excludes such a lane
 * on its own (`projectLiveAutomationWrites.ts`), because live has an
 * exclusion channel this shared, byte-identical-with-main extraction does not.
 */
const REFUSE_DEVICE_AUTOMATION: OfflineDeviceAutomationLaw = {
    acceptsAutomation: () => false,
    clampValue: ({ value }) => value,
    quantiseValue: ({ value }) => value,
};

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

    scheduleTrackAutomation({
        lanes: [...lanes],
        trackId: track.id,
        trackGainNode: { gain: gainRecorder.param },
        trackPanNode: { pan: panRecorder.param },
        sendAutomationParams,
        // The content gate admits device-free tracks only on the export, so a
        // device-parameter lane on an exported track has nothing to resolve
        // against here — the same outcome the web path reaches with an empty
        // chain, and main's silent drop for an orphan lane on a device the
        // user has since removed (see `REFUSE_DEVICE_AUTOMATION` above).
        deviceEntries: [],
        durationSeconds,
        defaultTempo,
        changes: [...changes],
        slewTickSeconds,
        deviceParameterLaw: REFUSE_DEVICE_AUTOMATION,
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
    return { outcome: 'converted', entries };
}
