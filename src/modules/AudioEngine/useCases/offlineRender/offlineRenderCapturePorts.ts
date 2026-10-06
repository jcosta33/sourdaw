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

/** How the Yeast owner stores and resolves racks, as an offline capture of a document reads them. */
export type OfflineYeastRackReader = {
    /** One device's live decoded rack. */
    readRack: (deviceId: string) => OfflineYeastSource['yeastProcessorsByDevice'][string];
    /** One device's rack exactly as a root document stores it, undecoded; `undefined` when it stores none. */
    readStoredRack: (rootDocument: Readonly<Record<string, unknown>>, deviceId: string) => unknown;
    /** Whether a root document stores a rack keyed by this device, which it reads before any legacy rack. */
    holdsKeyedRack: (rootDocument: Readonly<Record<string, unknown>>, deviceId: string) => boolean;
    /** Whether a root document holds a legacy rack keyed by no device, which the first Yeast device adopts. */
    holdsLegacyRack: (rootDocument: Readonly<Record<string, unknown>>) => boolean;
    /** The first Yeast device in the current tracks' project order: the device a legacy rack belongs to. */
    firstDeviceInProjectOrder: () => string | null;
};

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
    /** The Yeast owner's rack reads, so capture and its callers import no Yeast store or its load-time effects. */
    yeastRacks: OfflineYeastRackReader | null;
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
    yeastRacks: null,
    captureExternalPluginLaw: null,
};
