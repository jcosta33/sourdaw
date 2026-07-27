import {
    createGenericInstrumentCapabilities,
    normalizeRegisteredInstrumentCapabilities,
    type InstrumentCapabilitiesProjection,
} from '../models/InstrumentCapabilities';

import { instrumentCapabilitiesState } from './instrumentCapabilitiesState';

export function getInstrumentCapabilities(instrumentId: string): InstrumentCapabilitiesProjection {
    const stored = instrumentCapabilitiesState.read(instrumentId);
    if (!stored || stored.schemaVersion !== 1 || !stored.trusted) {
        return createGenericInstrumentCapabilities(instrumentId);
    }

    const registered = normalizeRegisteredInstrumentCapabilities(stored.descriptor);
    if (!registered) {
        return createGenericInstrumentCapabilities(instrumentId);
    }
    return registered;
}
