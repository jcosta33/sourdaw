import { getVcaGroupsState } from '#/modules/Arrangement/stores';

import { getAudioDeviceRuntimeSink, type CapturedOfflineInstrument } from '../../engine/audioDeviceRuntimeSink';
import { createExportError } from '../../errors/ExportError';
import { capturesNativeCalibration } from '../deviceCapabilities/capturesNativeCalibration';
import { getMaxTrackLatency } from '../latencyCompensation/compensation/getMaxTrackLatency';
import { type LatencyCompensationInput } from '../latencyCompensation/compensation/LatencyCompensationInput';
import { projectDeviceForNativeBody } from '../livePlayback/projectDeviceForNativeBody';

import { captureOfflineRenderRuntimeInput } from './captureOfflineRenderRuntimeInput';
import { captureOfflineSchedulingInput } from './captureOfflineSchedulingInput';
import { type OfflineRenderProjectSource, type OfflineRenderRuntimeSource } from './OfflineRenderSource';
import { resolveHistoryAwareRenderContext } from './resolveHistoryAwareRenderContext';
import { type ResolveRenderContextInput } from './resolveRenderContext';
import { type OfflineRenderOptions } from './types';

/**
 * Every strip is held back to the session's deepest latency, so the render
 * runs that much longer than the project and tail, or the last stretch of
 * content is shifted past its end and never printed.
 */
function widenForLatency(input: {
    request: ResolveRenderContextInput;
    resolved: ReturnType<typeof resolveHistoryAwareRenderContext>;
    project: OfflineRenderProjectSource | undefined;
    latency: LatencyCompensationInput;
    extend: boolean;
}) {
    const latencySeconds = getMaxTrackLatency(input.latency) / 1000;
    if (!input.extend || latencySeconds <= 0) {
        return input.resolved;
    }
    // Only the widened span is kept from this resolution; the render context keeps the
    // musician's own tail, so adding the depth to the tail here moves nothing else.
    return resolveHistoryAwareRenderContext(
        { ...input.request, tailSeconds: (input.request.tailSeconds ?? 0) + latencySeconds },
        input.project
    );
}

/** Capture every project-dependent render input synchronously, before backend discovery or device I/O. */
export function captureOfflineRenderInput(
    options: OfflineRenderOptions,
    source?: { project: OfflineRenderProjectSource; runtime?: OfflineRenderRuntimeSource }
) {
    if (!Number.isFinite(options.durationBeats) || options.durationBeats <= 0) {
        throw createExportError(
            `Invalid export duration: ${options.durationBeats} beats. Project may have no clips or corrupt clip data.`
        );
    }
    const project = source === undefined ? undefined : structuredClone(source.project);
    const sampleRate = options.sampleRate ?? 44_100;
    const request = {
        ...options,
        sampleRate,
        startBeat: options.startBeat ?? 0,
        tailSeconds: options.tailSeconds ?? 0,
    };
    const resolved = resolveHistoryAwareRenderContext(request, project);
    const context = resolved.renderContext;
    const renderContext = {
        ...context,
        ...structuredClone({
            tracks: context.tracks,
            midi: context.midi,
            transport: context.transport,
            changes: context.changes,
        }),
    };
    const tracks = renderContext.tracks?.tracks ?? [];
    const runtime =
        source?.runtime ?? captureOfflineRenderRuntimeInput(tracks, sampleRate, { projectOnly: project !== undefined });
    const sink = getAudioDeviceRuntimeSink();
    const instruments = new Map<string, CapturedOfflineInstrument>();
    const nativeDevices = new Map<string, ReturnType<typeof projectDeviceForNativeBody>>();
    for (const track of tracks) {
        for (const device of track.devices) {
            let setupSource: Parameters<typeof sink.captureOfflineInstrument>[1];
            if (project !== undefined) {
                setupSource = { projectOnly: true, calibration: runtime.calibrationByDevice.get(device.id) ?? null };
            }
            instruments.set(device.id, sink.captureOfflineInstrument(device, setupSource));
            nativeDevices.set(
                device.id,
                projectDeviceForNativeBody(device, {
                    nativeSampleBankKey: sink.nativeSampleBankKey,
                    nativeModAssignments: sink.nativeModAssignments,
                    projectNativeDeviceState: (input) => {
                        if (capturesNativeCalibration(input.deviceType)) {
                            return runtime.calibrationByDevice.get(input.deviceId) ?? null;
                        }
                        return sink.projectNativeDeviceState(input);
                    },
                })
            );
        }
    }
    const scheduling = captureOfflineSchedulingInput(tracks, sampleRate, project, runtime);
    const span = widenForLatency({
        request,
        resolved,
        project,
        latency: scheduling.latency,
        extend: options.extendForLatency !== false,
    });
    return {
        ...resolved,
        outputDurationSeconds: span.outputDurationSeconds,
        outputFrameCount: span.outputFrameCount,
        renderContext: { ...renderContext, durationSeconds: span.renderContext.durationSeconds },
        sampleRate,
        scheduling,
        vcaGroups: structuredClone(project ? project.vcaGroups : getVcaGroupsState()),
        soloMode: runtime.soloMode,
        instruments,
        nativeDevices,
        loadedExternalInstanceIds: new Set(runtime.loadedExternalInstanceIds),
        acquireNativeSampleBank: sink.acquireNativeSampleBank,
    };
}
