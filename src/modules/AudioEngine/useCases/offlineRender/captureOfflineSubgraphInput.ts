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
};

/**
 * Everything an isolated subgraph render reads besides its tracks, taken from
 * a supplied document before the render can yield.
 *
 * Device setup is captured project-only, from each device record as the
 * document holds it, so a device the document holds and the live session does
 * not renders from its record alone, the way `captureOfflineRenderInput` sets
 * up a supplied document's mixdown, and a device it does hold renders from the
 * record a signature of the document covers. The layer stack and modulator
 * rack are the session source's when one is supplied, else the live ones as
 * this render starts.
 */
export function captureOfflineSubgraphInput({ source, renderTracks }: CaptureOfflineSubgraphInput) {
    const projectTracks = source.project.tracks?.tracks ?? [];
    const runtime = source.runtime ?? captureOfflineRenderRuntimeInput(projectTracks, { projectOnly: true });
    const scheduling = captureOfflineSchedulingInput(renderTracks, source.project, runtime);
    const session = source.session ?? captureOfflineRenderSessionSource();
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
            modulators: session.modulators,
        },
        instruments,
        loadedExternalInstanceIds: new Set(runtime.loadedExternalInstanceIds),
        vcaGroups: structuredClone(source.project.vcaGroups),
        adjustmentLayers: session.adjustmentLayers,
    };
}
