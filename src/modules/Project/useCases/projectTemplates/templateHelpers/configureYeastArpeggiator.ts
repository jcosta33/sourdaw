import { templateArpeggiatorAuthoring } from './templateArpeggiatorAuthoring';

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

    const rack = templateArpeggiatorAuthoring.read('configureYeastArpeggiator');
    rack.focusRack(device.id);
    try {
        rack.addProcessor('arpeggiator', input.processorId, 'Arpeggiator');
        // Processor param names are the Arpeggiator processor's own
        // `setParam` arms, not device-parameter ids.
        await rack.setProcessorParam(input.processorId, 'mode', input.mode);
        await rack.setProcessorParam(input.processorId, 'rate_denom', input.rateDenominator);
        await rack.setProcessorParam(input.processorId, 'gate', input.gate);
        await rack.setProcessorParam(input.processorId, 'swing', input.swing);
    } finally {
        rack.focusRack(null);
    }
}
