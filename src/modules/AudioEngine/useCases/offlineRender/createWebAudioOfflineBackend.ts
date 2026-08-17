/**
 * The Web Audio offline renderer, behind {@link AudioGraphBackend}.
 *
 * Every law in this file arrived by being **moved**, not written: the strip is
 * `createOfflineTrackStrip`, the chain is `buildDeviceChain`, the output route
 * and the send wiring are the two loops `renderOffline` used to run inline, and
 * the clip envelope is `scheduleOfflineClipSource`. The point of the exercise is
 * that the contract can carry what the export already does without any of it
 * changing shape — an export rendered through this backend is the same graph,
 * node for node, that an export rendered before it was.
 *
 * ── What it refuses, and why refusing is the honest answer ────────────────
 *
 * An `OfflineAudioContext` builds its graph once and renders it faster than
 * real time. There is no rack to splice a device into while it plays and no
 * playhead to move. Those commands are therefore **rejected** rather than
 * accepted-and-ignored: a caller that assumed a bounce could seek finds out
 * from the result instead of from a silent file.
 *
 * ── The web-only surface ──────────────────────────────────────────────────
 *
 * {@link WebAudioOfflineBackend} adds node accessors the contract deliberately
 * has none of. They exist because the rest of the export — sidechain routing,
 * Toaster pad routing, clip and note scheduling — reaches into the strip
 * directly, and pretending otherwise in this slice would mean rewriting those
 * paths rather than routing this one. They are the *implementation's* surface,
 * not the seam's, and a native backend answers none of them.
 */

import { clampFaderGain } from '#/utils/audioLevelLaw';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphClipPlayback,
    type AudioGraphCommand,
    type AudioGraphCommandBatch,
    type AudioGraphCorrelation,
    type AudioGraphDeviceParameterTarget,
    type AudioGraphParameterWrite,
    type AudioGraphRouteTarget,
    type AudioGraphStepWrite,
    type AudioGraphStripParameterTarget,
    type AudioGraphStripReport,
} from '../../models/AudioGraphBackend';
import { type DeviceNodeEntry } from '../buildDeviceChain';

import { createOfflineBusStrip } from './createOfflineBusStrip';
import { createOfflineTrackStrip } from './createOfflineTrackStrip';
import { destroyOfflineDeviceStrategies } from './destroyOfflineDeviceStrategies';
import { scheduleOfflineClipSource } from './scheduleOfflineClipSource';
import { type OfflineBusStrip, type OfflineTrackStrip } from './types';

/** The key a send's level parameter is filed under, per track. */
function sendParameterKey(busId: string): string {
    return `send:${busId}`;
}

export type WebAudioOfflineBackendDeps = {
    /** The render's context. Every node this backend builds belongs to it. */
    context: OfflineAudioContext;
    /** Where a strip routed to `master` lands. */
    masterNode: AudioNode;
    /** The export's user-visible warning channel, for degraded devices. */
    onWarning?: (message: string) => void;
    /**
     * Composition-owned staleness check for a correlated batch, mirroring
     * `RuntimeGraphProjectRevisionValidator`. A render of a snapshot passes no
     * correlation and needs none; a caller that does pass one gets it checked.
     */
    acceptCorrelation?: (correlation: AudioGraphCorrelation) => boolean;
};

export type WebAudioOfflineBackend = AudioGraphBackend & {
    /** The nodes a strip is made of, for the export paths that wire into it. */
    getTrackStrip: (trackId: string) => OfflineTrackStrip | undefined;
    getBusStrip: (busId: string) => OfflineBusStrip | undefined;
    /** Send level params by `send:<busId>`, as the automation scheduler wants them. */
    getSendAutomationParams: (trackId: string) => ReadonlyMap<string, AudioParam> | undefined;
    /** Every device this backend built, by track, for runtime-failure collection. */
    getDeviceEntriesByTrack: () => ReadonlyMap<string, DeviceNodeEntry[]>;
};

/** Command kinds an offline render cannot answer, with the reason a caller needs. */
const UNSUPPORTED_COMMAND_REASONS: Partial<Record<AudioGraphCommand['kind'], string>> = {
    'insert-device': 'an offline render builds each device chain once, at strip creation',
    'remove-device': 'an offline render builds each device chain once, at strip creation',
    'set-transport': "an offline render's transport is fixed by the region it was created for",
};

/**
 * Why this backend cannot apply `command`, or `null` when it can.
 *
 * Kind alone does not decide it: this backend's material *is* an `AudioBuffer`,
 * so a playback carrying only a `sourceId` names material it has no pool to
 * resolve against. Refusing says so; scheduling nothing would render a rest
 * that reads as a correct file.
 */
function describeUnsupported(command: AudioGraphCommand): string | null {
    const byKind = UNSUPPORTED_COMMAND_REASONS[command.kind];
    if (byKind) {
        return byKind;
    }
    if (command.kind === 'schedule-clip' && !command.playback.source.buffer) {
        return `this backend resolves clip material from a decoded buffer, and source "${command.playback.source.sourceId}" carried none`;
    }
    return null;
}

export function createWebAudioOfflineBackend(deps: WebAudioOfflineBackendDeps): WebAudioOfflineBackend {
    const { context, masterNode, onWarning, acceptCorrelation } = deps;

    const trackStrips = new Map<string, OfflineTrackStrip>();
    const busStrips = new Map<string, OfflineBusStrip>();
    const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
    const sendGainsByTrack = new Map<string, Map<string, GainNode>>();
    const sendParamsByTrack = new Map<string, Map<string, AudioParam>>();
    /** Folded into every fader write, exactly as the strip was seeded with it. */
    const vcaMultiplierByTrack = new Map<string, number>();
    let runtimeRevision = 0;
    let disposed = false;

    function resolveRouteTarget(target: AudioGraphRouteTarget): AudioNode {
        if (target.kind === 'bus') {
            // The unresolved cases fall back to master rather than dropping the
            // strip's audio: an export that loses a track because its output
            // names something the render did not build is a silently wrong
            // file, and a track summed to master is a wrong mix the user hears.
            return busStrips.get(target.busId)?.gainNode ?? masterNode;
        }
        if (target.kind === 'track') {
            return trackStrips.get(target.trackId)?.inputNode ?? masterNode;
        }
        return masterNode;
    }

    function resolveParameter(
        target: AudioGraphStripParameterTarget
    ): { param: AudioParam; toNodeValue: (value: number) => number } | null {
        const strip = trackStrips.get(target.trackId);
        if (!strip) {
            return null;
        }
        switch (target.kind) {
            case 'track-fader':
                // The fader clamp and the VCA fold are the strip's own law, in
                // the order the strip composes them: multiply, then clamp.
                // A write that skipped either would render a level the fader
                // cannot produce.
                return {
                    param: strip.faderNode.gain,
                    toNodeValue: (value) => clampFaderGain(value * (vcaMultiplierByTrack.get(target.trackId) ?? 1)),
                };
            case 'track-pan':
                return {
                    param: strip.panNode.pan,
                    toNodeValue: (value) => Math.max(-1, Math.min(1, value / 50)),
                };
            case 'track-mute-gate':
                return { param: strip.postFaderGain.gain, toNodeValue: (value) => value };
            case 'track-solo-gate':
                return { param: strip.preFaderTap.gain, toNodeValue: (value) => value };
            case 'track-send-level': {
                const param = sendParamsByTrack.get(target.trackId)?.get(sendParameterKey(target.busId));
                if (!param) {
                    return null;
                }
                return { param, toNodeValue: (value) => Math.max(0, Math.min(1, value)) };
            }
        }
        // Unreachable while the switch covers the union. Typed `never` so a
        // parameter target added to the contract fails the typecheck here
        // rather than silently resolving to nothing at render time.
        const unhandled: never = target;
        throw new Error(`unhandled parameter target: ${JSON.stringify(unhandled)}`);
    }

    function applyParameterWrite(
        param: AudioParam,
        write: AudioGraphParameterWrite,
        toNodeValue: (value: number) => number
    ): void {
        switch (write.shape) {
            case 'step':
                param.setValueAtTime(toNodeValue(write.value), write.time);
                return;
            case 'ramp-to':
                // Cancel and replace: re-anchor at where the parameter actually
                // is and drop stale future events, so each write continues the
                // trajectory rather than compounding onto an older target.
                param.cancelScheduledValues(write.startTime);
                param.setValueAtTime(param.value, write.startTime);
                param.linearRampToValueAtTime(toNodeValue(write.value), write.landTime);
                return;
            case 'smoothed':
                param.setTargetAtTime(toNodeValue(write.value), write.time, write.timeConstantSeconds);
                return;
            case 'hold':
                param.cancelScheduledValues(write.time);
                param.setValueAtTime(param.value, write.time);
                return;
        }
    }

    function writeDeviceParameter(target: AudioGraphDeviceParameterTarget, write: AudioGraphStepWrite): void {
        // No shape guard: the contract pairs a device-parameter target with a
        // step write and nothing else, so the discard this used to perform is
        // now a compile error at the caller instead of a silent no-op here.
        const entry = deviceEntriesByTrack
            .get(target.trackId)
            ?.find((candidate) => candidate.deviceId === target.deviceId);
        entry?.strategy.setParam(target.parameterId, write.value);
    }

    function scheduleClip(playback: AudioGraphClipPlayback): void {
        const strip = trackStrips.get(playback.trackId);
        const buffer = playback.source.buffer;
        if (!strip || !buffer) {
            // A missing buffer is refused ahead of application and unreachable
            // here. A missing strip is the same skip `add-send` performs for an
            // unknown bus: nowhere to put the audio, and no graph to corrupt.
            return;
        }
        scheduleOfflineClipSource({
            context,
            destinationNode: strip.inputNode,
            buffer,
            startSec: playback.startTime,
            bufferOffsetSec: playback.sourceOffsetSeconds,
            playDuration: playback.durationSeconds,
            playbackRate: playback.playbackRate,
            clipGainValue: playback.gain,
            // A fade with no absolute time on it is the anti-click micro-fade;
            // the scheduler reads an absent time as exactly that, so the
            // contract's optional time passes straight through.
            fadeIn: playback.fade.fadeIn ? { userEndSec: playback.fade.fadeIn.reachesFullAt } : undefined,
            fadeOut: playback.fade.fadeOut ? { userStartSec: playback.fade.fadeOut.beginsAt } : undefined,
            microFadeSeconds: playback.fade.microFadeSeconds,
        });
    }

    async function applyCommand(command: AudioGraphCommand): Promise<AudioGraphStripReport | null> {
        switch (command.kind) {
            case 'create-track-strip':
            case 'create-bus-strip': {
                const id = command.kind === 'create-track-strip' ? command.trackId : command.busId;
                const strip = await createOfflineTrackStrip(
                    context,
                    {
                        id,
                        name: command.name,
                        gain: command.state.gain,
                        muted: command.state.muted,
                        pan: command.state.pan,
                        devices: [...command.devices],
                    },
                    {
                        honorMuted: command.honorMuted,
                        vcaMultiplier: command.state.vcaMultiplier,
                        onWarning,
                        contributesAudio: command.contributesAudio,
                    }
                );
                if (command.state.soloGated) {
                    // The pre-fader gate, which the strip builder has no opinion
                    // about: it sits ahead of the send taps, so a gated track
                    // feeds neither its bus nor its output — the property that
                    // separates solo-in-place from mute. Written only when the
                    // gate is closed, because the tap is already open.
                    strip.preFaderTap.gain.value = 0;
                }
                trackStrips.set(strip.trackId, strip);
                deviceEntriesByTrack.set(strip.trackId, strip.deviceEntries);
                vcaMultiplierByTrack.set(strip.trackId, command.state.vcaMultiplier);
                if (command.kind === 'create-bus-strip') {
                    // A bus is a strip other strips also route into by track id
                    // — one address space, two registries, because a send names
                    // a bus and an output names either.
                    busStrips.set(strip.trackId, createOfflineBusStrip(strip));
                }
                return {
                    kind: command.kind === 'create-track-strip' ? 'track' : 'bus',
                    // Read off the strip rather than off the command, so a
                    // report cannot name a track the builder did not build for.
                    id: strip.trackId,
                    deviceIds: strip.deviceEntries.map((entry) => entry.deviceId),
                };
            }
            case 'set-track-output': {
                const strip = trackStrips.get(command.trackId);
                strip?.outputNode.connect(resolveRouteTarget(command.target));
                return null;
            }
            case 'add-send': {
                const strip = trackStrips.get(command.trackId);
                const busStrip = busStrips.get(command.busId);
                if (!strip || !busStrip) {
                    // A send to a bus this render did not build has nowhere to
                    // go and is silent live too, so it is skipped rather than
                    // refused.
                    return null;
                }
                const sendGain = context.createGain();
                sendGain.gain.value = Math.max(0, Math.min(1, command.level));
                const tapNode = command.tap === 'pre-fader' ? strip.preFaderTap : strip.outputNode;
                tapNode.connect(sendGain);
                sendGain.connect(busStrip.gainNode);

                let gains = sendGainsByTrack.get(command.trackId);
                if (!gains) {
                    gains = new Map<string, GainNode>();
                    sendGainsByTrack.set(command.trackId, gains);
                }
                gains.set(sendParameterKey(command.busId), sendGain);

                let params = sendParamsByTrack.get(command.trackId);
                if (!params) {
                    params = new Map<string, AudioParam>();
                    sendParamsByTrack.set(command.trackId, params);
                }
                params.set(sendParameterKey(command.busId), sendGain.gain);
                return null;
            }
            case 'remove-send': {
                const key = sendParameterKey(command.busId);
                const sendGain = sendGainsByTrack.get(command.trackId)?.get(key);
                sendGain?.disconnect();
                sendGainsByTrack.get(command.trackId)?.delete(key);
                sendParamsByTrack.get(command.trackId)?.delete(key);
                return null;
            }
            case 'write-parameter': {
                const resolved = resolveParameter(command.target);
                if (!resolved) {
                    return null;
                }
                applyParameterWrite(resolved.param, command.write, resolved.toNodeValue);
                return null;
            }
            case 'write-device-parameter':
                writeDeviceParameter(command.target, command.write);
                return null;
            case 'schedule-clip':
                scheduleClip(command.playback);
                return null;
            case 'insert-device':
            case 'remove-device':
            case 'set-transport':
                // Refused ahead of application; unreachable here.
                return null;
        }
        // Unreachable while the switch covers the union. Typed `never` so a
        // command added to the contract fails the typecheck here rather than
        // being silently dropped mid-batch.
        const unhandled: never = command;
        throw new Error(`unhandled command: ${JSON.stringify(unhandled)}`);
    }

    const backendId = 'web-audio/offline';

    return {
        backendId,

        async apply(batch: AudioGraphCommandBatch): Promise<AudioGraphApplyResult> {
            if (disposed) {
                return { acceptance: 'rejected', application: 'not-applied', reason: 'backend disposed' };
            }
            if (batch.schemaVersion !== 1) {
                return {
                    acceptance: 'rejected',
                    application: 'not-applied',
                    reason: `unsupported command schema version ${String(batch.schemaVersion)}`,
                };
            }
            if (batch.correlation && acceptCorrelation && !acceptCorrelation(batch.correlation)) {
                return {
                    acceptance: 'rejected',
                    application: 'not-applied',
                    reason: `batch correlated to project revision ${batch.correlation.projectRevision} is stale`,
                };
            }
            // Refuse the whole batch before touching the graph. A topology half
            // applied because the fourth command was unsupported is worse than
            // one not applied at all, and the caller cannot tell the two apart
            // from a result that says only "rejected".
            for (const command of batch.commands) {
                const reason = describeUnsupported(command);
                if (reason) {
                    return {
                        acceptance: 'rejected',
                        application: 'not-applied',
                        reason: `${backendId} cannot apply "${command.kind}": ${reason}`,
                    };
                }
            }

            const reports: AudioGraphStripReport[] = [];
            for (const command of batch.commands) {
                // Deliberately not caught. A device the product claims and this
                // renderer cannot build fails the export, and swallowing that
                // into a result would hand the user a file missing the device
                // while reporting success.
                const report = await applyCommand(command);
                if (report) {
                    reports.push(report);
                }
            }
            runtimeRevision += 1;
            return {
                acceptance: 'accepted',
                application: 'applied',
                ...(batch.correlation ? { correlation: batch.correlation } : {}),
                runtimeRevision,
                reports,
            };
        },

        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            destroyOfflineDeviceStrategies(deviceEntriesByTrack);
        },

        getTrackStrip: (trackId) => trackStrips.get(trackId),
        getBusStrip: (busId) => busStrips.get(busId),
        getSendAutomationParams: (trackId) => sendParamsByTrack.get(trackId),
        getDeviceEntriesByTrack: () => deviceEntriesByTrack,
    };
}
