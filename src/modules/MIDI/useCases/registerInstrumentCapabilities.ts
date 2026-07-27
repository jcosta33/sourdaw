import {
    normalizeInstrumentCapabilitiesDescriptor,
    type InstrumentCapabilitiesDescriptorInput,
    type RegisteredInstrumentCapabilities,
} from '../models/InstrumentCapabilities';

import { instrumentCapabilitiesState } from './instrumentCapabilitiesState';

export function registerInstrumentCapabilities(descriptor: InstrumentCapabilitiesDescriptorInput): void {
    const normalized = normalizeInstrumentCapabilitiesDescriptor(descriptor);
    if (!normalized) {
        throw new Error('Invalid instrument capabilities descriptor');
    }

    const registered: RegisteredInstrumentCapabilities = Object.freeze({
        ...normalized,
        availability: 'registered',
    });
    if (!instrumentCapabilitiesState.register(registered.instrumentId, registered)) {
        throw new Error(`Instrument capabilities already registered: ${registered.instrumentId}`);
    }
}
