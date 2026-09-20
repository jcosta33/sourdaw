import {
    type OfflineExternalPluginParameterClamp,
    type OfflineExternalPluginParameterPredicate,
} from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import {
    type OfflineAutomationValueEvaluator,
    type OfflineChordPitchProjector,
    type OfflineMidiEventProjector,
} from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';

import { type OfflineRenderProjectSource, type OfflineRenderRuntimeSource } from './OfflineRenderSource';

type OfflineYeastSource = Pick<
    OfflineRenderProjectSource,
    'transport' | 'tempoMap' | 'timeSignatureMap' | 'grooveTemplates' | 'yeastProcessorsByDevice'
>;

type OfflineRenderCapturePorts = {
    createMidiProjector: ((source?: OfflineRenderProjectSource['grooveTemplates']) => OfflineMidiEventProjector) | null;
    createChordProjector: ((source?: OfflineRenderProjectSource['chordTrack']) => OfflineChordPitchProjector) | null;
    createAutomationEvaluator:
        ((lanes?: OfflineRenderProjectSource['automationLanes']) => OfflineAutomationValueEvaluator) | null;
    createYeastProcessor:
        | ((input?: {
              source?: OfflineYeastSource;
              tracks: readonly { id: string; devices: readonly { id: string; type: string }[] }[];
          }) => OfflineYeastMidiProcessor)
        | null;
    captureExternalPluginLaw:
        | ((source?: OfflineRenderRuntimeSource['externalPluginParameters']) => {
              acceptsExternalPluginParameter: OfflineExternalPluginParameterPredicate;
              clampExternalPluginValue: OfflineExternalPluginParameterClamp;
          })
        | null;
};

/** Source-aware owner factories belong to capture orchestration, not the runtime scheduler. */
export const offlineRenderCapturePorts: OfflineRenderCapturePorts = {
    createMidiProjector: null,
    createChordProjector: null,
    createAutomationEvaluator: null,
    createYeastProcessor: null,
    captureExternalPluginLaw: null,
};
