import { simplifyAutomationPoints } from '../../services/automationPointAlgorithms';

/**
 * Douglas–Peucker tolerance applied to a freehand/recorded automation gesture
 * before it persists. Interior points whose deviation from the retained polyline
 * stays under this collapse away, so a full-rate fader / MIDI / inline-draw
 * stroke does not dump raw point streams into project truth, the undo entry, and
 * CRDT history. Inherited from the manual `thinAutomationPoints` default. NOTE:
 * this is a raw-unit value — wide-range lanes (e.g. raw-Hz params) deviate in
 * the same units, so the default under-thins them; tracked as an AU-5 residual.
 */
const GESTURE_THINNING_TOLERANCE = 0.01;

/**
 * Thin one recorded or drawn gesture stroke through the single shared RDP.
 * Endpoints are preserved exactly (RDP never moves the first or last point) and
 * the point shape is untouched — only the COUNT changes. Generic over the point
 * carrier so both the Automation record-flush path and the Arrangement
 * inline-paint path thin their own `AutomationPoint` type through one
 * implementation, without either module re-exporting the other's model.
 */
export function simplifyGesturePoints<Point extends { beat: number; value: number }>(
    points: Point[],
    tolerance: number = GESTURE_THINNING_TOLERANCE
): Point[] {
    return simplifyAutomationPoints({ points, tolerance });
}
