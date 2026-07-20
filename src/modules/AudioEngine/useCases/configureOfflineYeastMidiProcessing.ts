import { setOfflineYeastMidiProcessor } from '../repositories/offlineScheduler/setOfflineYeastMidiProcessor';

type ConfigureOfflineYeastMidiProcessingInput = {
    createProcessor: Parameters<typeof setOfflineYeastMidiProcessor>[0];
};

export function configureOfflineYeastMidiProcessing({
    createProcessor,
}: ConfigureOfflineYeastMidiProcessingInput): void {
    setOfflineYeastMidiProcessor(createProcessor);
}
