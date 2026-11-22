import { type Track } from '#/modules/Arrangement/stores';

import { getAudioDeviceRuntimeSink, type CapturedOfflineInstrument } from '../../engine/audioDeviceRuntimeSink';

import { captureOfflineRenderRuntimeInput } from './captureOfflineRenderRuntimeInput';
import { captureOfflineRenderSessionSource } from './captureOfflineRenderSessionSource';
import { captureOfflineSchedulingInput } from './captureOfflineSchedulingInput';
import {
    type OfflineRenderProjectSource,
    type OfflineRenderRuntimeSource,
    type OfflineRenderSessionSource,
} from './OfflineRenderSource';

export type OfflineSubgraphSource = {
    project: OfflineRenderProjectSource;
    runtime?: OfflineRenderRuntimeSource;
    session?: OfflineRenderSessionSource;
};

type CaptureOfflineSubgraphInput = {
    source: OfflineSubgraphSource;
    renderTracks: readonly Track[];
    sampleRate: number;
};

/**
 * Everything an isolated subgraph render reads besides its tracks, taken from
 * a supplied document before the render can yield.
 *
 * Without a session source, device setup is captured project-only, from each
 * device record as the document holds it, so a device the document holds and
 * the live session does not renders from its record alone, the way
 * `captureOfflineRenderInput` sets up a supplied document's mixdown, and the
 * layer stack and modulator rack are the live ones as this render starts. With
 * one, the document is the live session's own: device setup is captured from
 * the live instances and the layers and rack are the session's captured ones.
 */
export function captureOfflineSubgraphInput({ source, renderTracks, sampleRate }: CaptureOfflineSubgraphInput) {
    const projectTracks = source.project.tracks?.tracks ?? [];
    const projectOnly = source.session === undefined;
    const runtime = source.runtime ?? captureOfflineRenderRuntimeInput(projectTracks, sampleRate, { projectOnly });
    const scheduling = captureOfflineSchedulingInput(renderTracks, sampleRate, source.project, runtime);
    const session = source.session ?? captureOfflineRenderSessionSource();
    const sink = getAudioDeviceRuntimeSink();
    const instruments = new Map<string, CapturedOfflineInstrument>();
    for (const track of renderTracks) {
        for (const device of track.devices) {
            instruments.set(device.id, captureInstrument(sink, device, projectOnly, runtime));
        }
    }
    return {
        scheduling: {
            ...scheduling,
            // PCM is copied for the rendered tracks alone, but compensation
            // aligns each strip to the deepest one in the whole document, the
            // way the live subgraph render reads it.
            latency: { ...scheduling.latency, tracks: projectTracks },
            modulators: session.modulators,
        },
        instruments,
        loadedExternalInstanceIds: new Set(runtime.loadedExternalInstanceIds),
        vcaGroups: structuredClone(source.project.vcaGroups),
        adjustmentLayers: session.adjustmentLayers,
    };
}

function captureInstrument(
    sink: ReturnType<typeof getAudioDeviceRuntimeSink>,
    device: Track['devices'][number],
    projectOnly: boolean,
    runtime: OfflineRenderRuntimeSource
): CapturedOfflineInstrument {
    if (!projectOnly) {
        return sink.captureOfflineInstrument(device);
    }
    const calibration = runtime.calibrationByDevice.get(device.id) ?? null;
    return sink.captureOfflineInstrument(device, { projectOnly: true, calibration });
}
