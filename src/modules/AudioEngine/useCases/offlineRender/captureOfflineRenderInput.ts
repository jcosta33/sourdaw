import { getVcaGroupsState } from '#/modules/Arrangement/stores';

import { getAudioDeviceRuntimeSink, type CapturedOfflineInstrument } from '../../engine/audioDeviceRuntimeSink';
import { createExportError } from '../../errors/ExportError';
import { projectDeviceForNativeBody } from '../livePlayback/projectDeviceForNativeBody';

import { captureOfflineRenderRuntimeInput } from './captureOfflineRenderRuntimeInput';
import { captureOfflineSchedulingInput } from './captureOfflineSchedulingInput';
import { type OfflineRenderProjectSource, type OfflineRenderRuntimeSource } from './OfflineRenderSource';
import { resolveHistoryAwareRenderContext } from './resolveHistoryAwareRenderContext';
import { type OfflineRenderOptions } from './types';

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
    const resolved = resolveHistoryAwareRenderContext(
        { ...options, sampleRate, startBeat: options.startBeat ?? 0, tailSeconds: options.tailSeconds ?? 0 },
        project
    );
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
    const runtime = source?.runtime ?? captureOfflineRenderRuntimeInput(tracks, sampleRate);
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
                        if (input.deviceType === 'grand-boule') {
                            return runtime.calibrationByDevice.get(input.deviceId) ?? null;
                        }
                        return sink.projectNativeDeviceState(input);
                    },
                })
            );
        }
    }
    return {
        ...resolved,
        renderContext,
        sampleRate,
        scheduling: captureOfflineSchedulingInput(tracks, sampleRate, project, runtime),
        vcaGroups: structuredClone(project ? project.vcaGroups : getVcaGroupsState()),
        soloMode: runtime.soloMode,
        instruments,
        nativeDevices,
        loadedExternalInstanceIds: new Set(runtime.loadedExternalInstanceIds),
        acquireNativeSampleBank: sink.acquireNativeSampleBank,
    };
}
