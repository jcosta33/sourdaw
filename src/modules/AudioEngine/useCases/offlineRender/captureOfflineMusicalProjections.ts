import { type TrackStoreState } from '#/modules/Arrangement/stores';

import { offlineMidiEventProjectorState } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { offlineYeastMidiProcessorState } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';

import { offlineRenderCapturePorts } from './offlineRenderCapturePorts';
import { type OfflineRenderProjectSource } from './OfflineRenderSource';

function captureLiveProjections(tracks: TrackStoreState | null) {
    const ports = offlineRenderCapturePorts;
    return {
        projectMidiEvents: offlineMidiEventProjectorState.createProjector?.() ?? null,
        projectChordPitch: offlineMidiEventProjectorState.createChordPitchProjector?.() ?? null,
        processYeastMidi: ports.createYeastProcessor
            ? ports.createYeastProcessor({ tracks: tracks?.tracks ?? [] })
            : (offlineYeastMidiProcessorState.createProcessor?.() ?? null),
        evaluateAutomationValue: ports.createAutomationEvaluator
            ? ports.createAutomationEvaluator()
            : offlineMidiEventProjectorState.evaluateAutomationValue,
    };
}

/** Bind stateful owner projections before any render preparation can yield. */
export function captureOfflineMusicalProjections(tracks: TrackStoreState | null, source?: OfflineRenderProjectSource) {
    if (source === undefined) {
        return captureLiveProjections(tracks);
    }
    const ports = offlineRenderCapturePorts;
    return {
        projectMidiEvents: ports.createMidiProjector?.(source.grooveTemplates) ?? null,
        projectChordPitch: ports.createChordProjector?.(source.chordTrack) ?? null,
        processYeastMidi:
            ports.createYeastProcessor?.({
                tracks: tracks?.tracks ?? [],
                source: {
                    transport: source.transport,
                    tempoMap: source.tempoMap,
                    timeSignatureMap: source.timeSignatureMap,
                    grooveTemplates: source.grooveTemplates,
                    yeastProcessorsByDevice: source.yeastProcessorsByDevice,
                },
            }) ?? null,
        evaluateAutomationValue: ports.createAutomationEvaluator?.(source.automationLanes) ?? null,
    };
}
