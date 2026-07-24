import { NOTE_EXPRESSION_DEVICE_CONTROLS } from '../../engine/noteExpression';

/**
 * Device types whose engine actually sounds MPE per-note expression
 * (audit MD-2), derived from the engine registry rather than restated.
 *
 * The editor's MPE availability surface reads this, so a device gaining or
 * losing an expression path cannot leave the UI claiming a capability the
 * engine does not have.
 */
export function getNoteExpressionDeviceTypes(): readonly string[] {
    return Object.keys(NOTE_EXPRESSION_DEVICE_CONTROLS);
}
