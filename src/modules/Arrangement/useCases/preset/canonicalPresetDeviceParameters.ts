import { clampDeviceParameterValue } from '../../models/DeviceParameterLaw';
import { migrateStoredDeviceParameterValues } from '../../models/StoredDeviceParameterMigration';

function hasBoundedId(value: string): boolean {
    return value.length > 0 && value.length <= 128;
}

/**
 * The parameter values a stored preset device should be read as holding.
 *
 * Migrates out of any retired declared unit before clamping to the current
 * range, in that order — see `StoredDeviceParameterMigration`. A preset saved
 * before a unit change (for example the Brick-Wall Limiter's `release`, ms
 * moved to seconds) would otherwise have its legacy value pinned to the new
 * minimum by the clamp below, silently rewriting it to the most extreme
 * setting in the range.
 *
 * Shared by preset materialization and the CRDT admission recheck so both
 * apply the identical migrate-then-clamp order to the same stored shape.
 */
export function canonicalPresetDeviceParameters(
    deviceType: string,
    values: Readonly<Record<string, number>>
): Record<string, number> | null {
    const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
    if (entries.some(([parameterId, value]) => !hasBoundedId(parameterId) || !Number.isFinite(value))) {
        return null;
    }
    const migrated = migrateStoredDeviceParameterValues(deviceType, Object.fromEntries(entries));
    return Object.fromEntries(
        Object.entries(migrated).map(([parameterId, value]) => [
            parameterId,
            clampDeviceParameterValue({ deviceType, paramId: parameterId, value }),
        ])
    );
}
