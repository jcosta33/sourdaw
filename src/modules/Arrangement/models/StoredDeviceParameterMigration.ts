import { COMPRESSOR_AUTO_MAKEUP_LEGACY_VALUE } from '#/utils/dynamicsCompressorMakeupLaw';

/**
 * Stored device parameter values that predate a change to a parameter's
 * declaration. Two kinds of change are read here: a declared unit that moved
 * (a rescale), and a parameter that did not exist when the value was stored
 * but whose default for a new device is not the sound the old device made (a
 * fill).
 *
 * ## Rescale
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
 *
 * ## Fill
 *
 * The built-in compressor's Auto Makeup switch (`comp-auto-makeup`) is new, and
 * a new device starts with it off. Every compressor stored before it existed
 * sounded with the browser's makeup gain, which is the switch on, so a record
 * without the key reads as on (ADR 0064). The built-in limiter's switch
 * (`lim-auto-makeup`) is filled the same way, because its first stage is the
 * same browser node (ADR 0066). A record that carries the key, either
 * value, is the user's setting and is never touched. The fill is idempotent the
 * same way the rescale is: once filled the key is present, and a present key
 * never fires it again.
 *
 * ## Stored encoding of a fill
 *
 * The fill runs on the CRDT projection, so every store reader sees an explicit
 * value. The document must not: a store write reconciles the projected value
 * back into the document, and a filled key the document lacks would land there
 * on the first unrelated edit of the track, rewriting every legacy device.
 * `encodeStoredDeviceParameterValues` is the fill's inverse on the way out: a
 * fill key holding its `legacyValue` is stored as absence, which already reads
 * as that value, and any other value is stored as written. The two directions
 * are symmetric, so a projection followed by an encode returns the record the
 * document held.
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

/** A parameter added after devices were stored, read as `legacyValue` where a record lacks it. */
type StoredParameterFill = {
    /** `Device.type`, matched against `PluginDescriptor.id`. */
    deviceType: string;
    paramId: string;
    /** What a device stored before the parameter existed sounded like. */
    legacyValue: number;
};

const STORED_PARAMETER_FILLS: readonly StoredParameterFill[] = [
    {
        deviceType: 'builtin-compressor',
        paramId: 'comp-auto-makeup',
        legacyValue: COMPRESSOR_AUTO_MAKEUP_LEGACY_VALUE,
    },
    {
        deviceType: 'builtin-limiter',
        paramId: 'lim-auto-makeup',
        legacyValue: COMPRESSOR_AUTO_MAKEUP_LEGACY_VALUE,
    },
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
    let migrated = parameterValues;
    for (const migration of STORED_PARAMETER_MIGRATIONS) {
        if (migration.deviceType !== deviceType) {
            continue;
        }
        const stored = parameterValues[migration.paramId];
        if (stored === undefined || stored >= migration.newMinimum) {
            continue;
        }
        migrated = { ...migrated, [migration.paramId]: stored * migration.factor };
    }
    for (const fill of STORED_PARAMETER_FILLS) {
        if (fill.deviceType !== deviceType || Object.hasOwn(parameterValues, fill.paramId)) {
            continue;
        }
        migrated = { ...migrated, [fill.paramId]: fill.legacyValue };
    }
    return migrated;
}

/**
 * The parameter values a device should be stored as holding: the inverse of
 * the fill. A fill key equal to its `legacyValue` is dropped, because absence
 * already reads as that value.
 *
 * Returns the input untouched when nothing applies.
 */
export function encodeStoredDeviceParameterValues(
    deviceType: string,
    parameterValues: Record<string, number>
): Record<string, number> {
    let encoded = parameterValues;
    for (const fill of STORED_PARAMETER_FILLS) {
        if (fill.deviceType !== deviceType || parameterValues[fill.paramId] !== fill.legacyValue) {
            continue;
        }
        const { [fill.paramId]: _legacy, ...rest } = encoded;
        encoded = rest;
    }
    return encoded;
}
