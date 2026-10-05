import { type Track } from '#/modules/Arrangement/stores';

import { getAudioDeviceRuntimeSink, type CapturedOfflineInstrument } from '../../engine/audioDeviceRuntimeSink';

import { captureOfflineRenderRuntimeInput } from './captureOfflineRenderRuntimeInput';
import { captureOfflineSchedulingInput } from './captureOfflineSchedulingInput';
import { type OfflineRenderProjectSource, type OfflineRenderRuntimeSource } from './OfflineRenderSource';

type CaptureOfflineSubgraphInput = {
    source: { project: OfflineRenderProjectSource; runtime?: OfflineRenderRuntimeSource };
    renderTracks: readonly Track[];
    sampleRate: number;
};

/**
 * Everything an isolated subgraph render reads besides its tracks, taken from
 * a supplied document before the render can yield.
 *
 * Device setup is captured project-only, from each device record as the
 * document holds it, so a device the document holds and the live session does
 * not renders from its record alone, the way `captureOfflineRenderInput` sets
 * up a supplied document's mixdown.
 */
export function captureOfflineSubgraphInput({ source, renderTracks, sampleRate }: CaptureOfflineSubgraphInput) {
    const projectTracks = source.project.tracks?.tracks ?? [];
    const runtime =
        source.runtime ?? captureOfflineRenderRuntimeInput(projectTracks, sampleRate, { projectOnly: true });
    const scheduling = captureOfflineSchedulingInput(renderTracks, sampleRate, source.project, runtime);
    const sink = getAudioDeviceRuntimeSink();
    const instruments = new Map<string, CapturedOfflineInstrument>();
    for (const track of renderTracks) {
        for (const device of track.devices) {
            const calibration = runtime.calibrationByDevice.get(device.id) ?? null;
            instruments.set(device.id, sink.captureOfflineInstrument(device, { projectOnly: true, calibration }));
        }
    }
    return {
        scheduling: {
            ...scheduling,
            // PCM is copied for the rendered tracks alone, but compensation
            // aligns each strip to the deepest one in the whole document, the
            // way the live subgraph render reads it.
            latency: { ...scheduling.latency, tracks: projectTracks },
        },
        instruments,
        loadedExternalInstanceIds: new Set(runtime.loadedExternalInstanceIds),
        vcaGroups: structuredClone(source.project.vcaGroups),
    };
}
