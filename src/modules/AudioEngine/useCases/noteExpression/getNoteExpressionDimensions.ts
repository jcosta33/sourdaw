import {
    getNoteExpressionDimensions as resolveDimensions,
    type NoteExpressionDimension,
} from '../../engine/noteExpression';

/**
 * The MPE dimensions a device type's engine actually sounds (audit MD-2),
 * derived from the engine registry rather than restated.
 *
 * Empty for any device with no per-note expression path. The editor's MPE lane
 * availability reads this, so a device gaining or losing a dimension cannot
 * leave the UI offering a lane the engine would silently swallow — Grand Boule
 * sounds pitch bend but not pressure or timbre, and the lane list says so.
 */
export function getNoteExpressionDimensions(deviceType: string): readonly NoteExpressionDimension[] {
    return resolveDimensions(deviceType);
}
