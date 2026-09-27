import { setActiveYeastDevice } from '#/modules/Yeast/stores';
import { addYeastProcessor, setYeastProcessorParam } from '#/modules/Yeast/useCases';

import type { Track } from '#/modules/Arrangement/stores';

type ConfigureYeastArpeggiatorInput = {
    /** The track whose Yeast device owns the rack the arpeggiator lands in. */
    track: Track;
    /** The arpeggiator processor id, minted by the template like every rack
     *  id is minted by its dispatching surface. */
    processorId: string;
    mode: number;
    rateDenominator: number;
    gate: number;
    swing: number;
};

/**
 * Configure a template's Yeast device as an arpeggiator.
 *
 * Rack state is per device instance and holds user-added processors addressed
 * by their own ids, so the device-parameter route cannot carry it: the values
 * must be written through the rack's own write path
 * (`addYeastProcessor` + `setYeastProcessorParam`, the same use cases the
 * Yeast panel dispatches). The rack writes resolve through the active-device
 * pin — the same per-device pattern `hydrateYeastState` uses — so the device
 * is pinned for the whole configuration and unpinned once every value has
 * landed under its rack key.
 */
export async function configureYeastArpeggiator(input: ConfigureYeastArpeggiatorInput): Promise<void> {
    const device = input.track.devices.find((candidate) => candidate.type === 'yeast');
    if (!device) {
        throw new Error(`Track "${input.track.name}" carries no Yeast device to configure as an arpeggiator.`);
    }

    setActiveYeastDevice(device.id);
    try {
        addYeastProcessor('arpeggiator', input.processorId, 'Arpeggiator');
        // Processor param names are the Arpeggiator processor's own
        // `setParam` arms, not device-parameter ids.
        await setYeastProcessorParam(input.processorId, 'mode', input.mode);
        await setYeastProcessorParam(input.processorId, 'rate_denom', input.rateDenominator);
        await setYeastProcessorParam(input.processorId, 'gate', input.gate);
        await setYeastProcessorParam(input.processorId, 'swing', input.swing);
    } finally {
        setActiveYeastDevice(null);
    }
}
