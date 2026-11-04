import { toLevainDeviceState } from '../models/LevainDeviceState';
import { createDefaultPatch } from '../models/LevainPatch';

type StringSectionInstrument = 'violin-1' | 'violin-2' | 'viola' | 'cello' | 'double-bass';

export function createLevainTemplateDeviceState(instrumentId: StringSectionInstrument) {
    return toLevainDeviceState(createDefaultPatch(instrumentId));
}
