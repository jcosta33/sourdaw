import { setOfflineYeastMidiProcessor } from '../repositories/offlineScheduler/setOfflineYeastMidiProcessor';

import { offlineRenderCapturePorts } from './offlineRender/offlineRenderCapturePorts';

type ConfigureOfflineYeastMidiProcessingInput = {
    createProcessor: NonNullable<typeof offlineRenderCapturePorts.createYeastProcessor>;
};

export function configureOfflineYeastMidiProcessing({
    createProcessor,
}: ConfigureOfflineYeastMidiProcessingInput): void {
    offlineRenderCapturePorts.createYeastProcessor = createProcessor;
    setOfflineYeastMidiProcessor(createProcessor);
}
