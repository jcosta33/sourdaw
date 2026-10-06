import { setOfflineYeastMidiProcessor } from '../repositories/offlineScheduler/setOfflineYeastMidiProcessor';

import { offlineRenderCapturePorts } from './offlineRender/offlineRenderCapturePorts';

type ConfigureOfflineYeastMidiProcessingInput = {
    createProcessor: NonNullable<typeof offlineRenderCapturePorts.createYeastProcessor>;
    /** The owner's rack reads a captured render source takes; without them every rack captures empty. */
    racks?: NonNullable<typeof offlineRenderCapturePorts.yeastRacks>;
};

export function configureOfflineYeastMidiProcessing({
    createProcessor,
    racks,
}: ConfigureOfflineYeastMidiProcessingInput): void {
    offlineRenderCapturePorts.createYeastProcessor = createProcessor;
    offlineRenderCapturePorts.yeastRacks = racks ?? null;
    setOfflineYeastMidiProcessor(createProcessor);
}
