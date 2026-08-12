import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { commandDeviceVersionsPort } from './commandDeviceVersionsPort';
import { getCommandDeviceTypes } from './getCommandDeviceTypes';

export function hasCurrentCommandDeviceVersions(envelope: VersionedCommandEnvelope): boolean {
    try {
        const current = commandDeviceVersionsPort.capture(getCommandDeviceTypes(envelope.arguments));
        return JSON.stringify(current) === JSON.stringify(envelope.availableDeviceVersions);
    } catch {
        return false;
    }
}
