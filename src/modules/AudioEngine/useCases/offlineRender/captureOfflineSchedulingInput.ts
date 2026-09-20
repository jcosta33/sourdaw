import { gainEnvelopeStore, takeLaneStore, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { offlineDeviceParameterLawState } from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { type LatencyCompensationInput } from '../latencyCompensation/compensation/LatencyCompensationInput';

import { captureOfflineAudioBuffers } from './captureOfflineAudioBuffers';
import { captureOfflineRenderRuntimeInput } from './captureOfflineRenderRuntimeInput';
import { offlineRenderCapturePorts } from './offlineRenderCapturePorts';
import { type OfflineRenderProjectSource, type OfflineRenderRuntimeSource } from './OfflineRenderSource';

/** PCM belongs to the request: cache eviction and in-place edits cannot alter a pending render. */
export function captureOfflineSchedulingInput(
    tracks: readonly Track[],
    sampleRate: number,
    project?: OfflineRenderProjectSource,
    runtime: OfflineRenderRuntimeSource = captureOfflineRenderRuntimeInput(tracks, sampleRate)
) {
    const buffers = captureOfflineAudioBuffers(tracks, runtime.buffers);
    const routes = structuredClone(project ? project.sidechainRoutes : (sidechainStore.value?.routes ?? []));
    const latency: LatencyCompensationInput = {
        tracks,
        routes,
        deviceLatencyMs: new Map(runtime.deviceLatencyMs),
    };
    const deviceParameterLaw = {
        isAutomatable: offlineDeviceParameterLawState.isAutomatable,
        clampValue: offlineDeviceParameterLawState.clampValue,
        quantiseValue: offlineDeviceParameterLawState.quantiseValue,
        acceptsExternalPluginParameter: offlineDeviceParameterLawState.acceptsExternalPluginParameter,
        clampExternalPluginValue: offlineDeviceParameterLawState.clampExternalPluginValue,
    };
    if (offlineRenderCapturePorts.captureExternalPluginLaw) {
        Object.assign(
            deviceParameterLaw,
            offlineRenderCapturePorts.captureExternalPluginLaw(runtime.externalPluginParameters)
        );
    } else if (project !== undefined) {
        deviceParameterLaw.acceptsExternalPluginParameter = null;
        deviceParameterLaw.clampExternalPluginValue = null;
    }
    return {
        buffers,
        latency,
        takeLanes: structuredClone(project ? project.takeLanes : takeLaneStore.value),
        gainEnvelopes: structuredClone(project ? project.gainEnvelopes : (gainEnvelopeStore.value?.envelopes ?? {})),
        automationLanes: structuredClone(project ? project.automationLanes : (automationStore.value?.lanes ?? [])),
        scheduleGrainMs:
            (project ? project.transport : transportStore.value)?.scheduleGrainMs ??
            defaultTransportState.scheduleGrainMs,
        deviceParameterLaw,
    };
}
