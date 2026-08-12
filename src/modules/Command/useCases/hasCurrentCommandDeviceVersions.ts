import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { commandDeviceVersionsPort } from './commandDeviceVersionsPort';

export function hasCurrentCommandDeviceVersions(envelope: VersionedCommandEnvelope): boolean {
    try {
        const current = commandDeviceVersionsPort.capture({
            argumentsValue: envelope.arguments,
            operation: envelope.operation,
        });
        return JSON.stringify(current) === JSON.stringify(envelope.availableDeviceVersions);
    } catch {
        return false;
    }
}
