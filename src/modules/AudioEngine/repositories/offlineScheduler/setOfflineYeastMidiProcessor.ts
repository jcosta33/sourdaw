import {
    offlineYeastMidiProcessorState,
    type OfflineYeastMidiProcessorFactory,
} from './offlineYeastMidiProcessorState';

export function setOfflineYeastMidiProcessor(createProcessor: OfflineYeastMidiProcessorFactory): void {
    offlineYeastMidiProcessorState.createProcessor = createProcessor;
}
