import { transportStore } from '#/modules/Transport/stores';

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { getYeastRack } from '../../stores/yeastStore';

export function processYeastMidi(
    events: MidiEvent[],
    blockStartSamples: number,
    blockEndSamples: number,
    sampleRate: number
): MidiEvent[] {
    const rack = getYeastRack();
    const processorIds = rack.getProcessorIds();

    if (processorIds.length === 0) {
        return events;
    }

    const transport = transportStore.value;
    if (!transport) {
        return events;
    }

    const transportInfo: TransportInfo = {
        sampleRate,
        bpm: transport.tempo,
        ppqPosition: 0,
        isPlaying: transport.isPlaying,
        barIndex: 0,
        beatInBar: 0,
        timeSigNum: transport.timeSignatureNumerator,
        timeSigDen: transport.timeSignatureDenominator,
        loopEnabled: transport.loopStart < transport.loopEnd,
        loopStartPpq: transport.loopStart,
        loopEndPpq: transport.loopEnd,
    };

    return rack.processBlock(events, blockStartSamples, blockEndSamples, transportInfo);
}
