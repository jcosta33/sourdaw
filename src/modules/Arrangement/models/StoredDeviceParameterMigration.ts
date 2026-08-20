/**
 * Stored device parameter values that predate a change to a declared unit.
 *
 * A `DeviceParameter`'s `minValue`/`maxValue` are enforced on the way in —
 * `clampDeviceParameterValue` pins a write to the nearest legal value, and the
 * AudioParam behind the device does the same — so redeclaring a parameter in a
 * different unit silently rewrites every value already stored for it. The
 * Brick-Wall Limiter's `release` moved from seconds (0.01..1, default 0.1) to
 * milliseconds (1..1000, default 100): every value a project could legitimately
 * hold under the old declaration is below the new minimum, so a stored 100 ms
 * release came back as 1 ms — the most aggressive setting in the new range, and
 * audible as pumping on any low-frequency content.
 *
 * The migration runs where the value is read out of storage, before anything
 * clamps it, and it is idempotent by construction: it fires only STRICTLY below
 * the new minimum, and scaling a value up cannot leave it there. That matters
 * on the CRDT projection path, which re-runs on every document change rather
 * than once at load.
 *
 * Strictly below is a decision, not an accident. The old maximum and the new
 * minimum are the same number — 1 s and 1 ms — so a stored `1` could be either,
 * and nothing in the record distinguishes them. Migrating it would rewrite a
 * value a user set under the CURRENT declaration; leaving it reads one legacy
 * setting, the old maximum, as the new minimum. Only the first of those can
 * corrupt data written from here on, so the boundary belongs on the old side.
 *
 * Note what is NOT here. The limiter's `ceiling` was declared -12..0 before and
 * after, so no stored ceiling was ever out of range. `lookahead` is new: the
 * parameter did not exist in the catalog before, so no project can hold a value
 * for it.
 */

type StoredParameterMigration = {
    /** `Device.type`, matched against `PluginDescriptor.id`. */
    deviceType: string;
    paramId: string;
    /**
     * The new declared minimum. A stored value below it cannot be a value in
     * the current unit, so it is a value in the old one.
     */
    newMinimum: number;
    /** Old unit → new unit. */
    factor: number;
};

const STORED_PARAMETER_MIGRATIONS: readonly StoredParameterMigration[] = [
    { deviceType: 'faust-brick-wall-limiter', paramId: 'release', newMinimum: 1, factor: 1000 },
];

/**
 * The parameter values a stored device should be read as holding.
 *
 * Returns the input untouched when nothing applies, so the common case adds no
 * object churn to the projection.
 */
export function migrateStoredDeviceParameterValues(
    deviceType: string,
    parameterValues: Record<string, number>
): Record<string, number> {
    let migrated: Record<string, number> | null = null;
    for (const migration of STORED_PARAMETER_MIGRATIONS) {
        if (migration.deviceType !== deviceType) {
            continue;
        }
        const stored = parameterValues[migration.paramId];
        if (stored === undefined || stored >= migration.newMinimum) {
            continue;
        }
        migrated ??= { ...parameterValues };
        migrated[migration.paramId] = stored * migration.factor;
    }
    return migrated ?? parameterValues;
}
