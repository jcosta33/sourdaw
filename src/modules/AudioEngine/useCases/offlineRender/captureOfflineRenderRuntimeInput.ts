import { type Track } from '#/modules/Arrangement/stores';
import { externalPluginParameterStore } from '#/modules/PluginHost/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { getAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { getDeviceLatencyMs } from '../latencyCompensation/compensation/getDeviceLatencyMs';
import { readLoadedExternalInstanceIds } from '../livePlayback/readLoadedExternalInstanceIds';

import { type OfflineRenderRuntimeSource } from './OfflineRenderSource';

/** Capture runtime facts for the supplied document; PCM is copied when constructing the render input. */
export function captureOfflineRenderRuntimeInput(
    tracks: readonly Track[],
    sampleRate: number
): OfflineRenderRuntimeSource {
    const sink = getAudioDeviceRuntimeSink();
    const deviceLatencyMs = new Map<string, number>();
    const calibrationByDevice = new Map<string, Readonly<Record<string, number>> | null>();
    for (const track of tracks) {
        for (const device of track.devices) {
            deviceLatencyMs.set(device.id, getDeviceLatencyMs(device.id, device.type, sampleRate));
            if (device.type === 'grand-boule') {
                calibrationByDevice.set(
                    device.id,
                    structuredClone(
                        sink.projectNativeDeviceState({
                            deviceId: device.id,
                            deviceType: device.type,
                            deviceState: device.deviceState,
                        })
                    )
                );
            }
        }
    }
    return {
        buffers: audioBufferCache,
        deviceLatencyMs,
        calibrationByDevice,
        loadedExternalInstanceIds: readLoadedExternalInstanceIds(),
        externalPluginParameters: structuredClone(externalPluginParameterStore.value),
        soloMode: workspaceStore.value?.soloMode ?? 'sip',
    };
}
