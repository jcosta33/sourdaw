import { type InstrumentId } from '../models/LevainPatch';

import { commitLevainIdentity } from './commitLevainIdentity';

/** Replace the selected instrument and its preset parameters as one project edit. */
export function loadInstrument(
    deviceId: string,
    instrumentId: InstrumentId,
    name: string = instrumentId
): Promise<void> {
    return commitLevainIdentity(deviceId, { kind: 'instrument', instrumentId, name });
}
