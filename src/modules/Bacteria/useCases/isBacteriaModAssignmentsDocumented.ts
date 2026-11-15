import { rowsEqual } from '../models/BacteriaModAssignmentsState';
import { type BacteriaModAssignment } from '../models/BacteriaPatch';

import { hydrateBacteriaModAssignmentsFromProject } from './hydrateBacteriaModAssignmentsFromProject';

/**
 * Whether the document already holds this table for the device, row for row
 * (an absent chunk reads as an empty table). Writing it would only dirty the
 * project it was read from.
 */
export function isBacteriaModAssignmentsDocumented(deviceId: string, rows: readonly BacteriaModAssignment[]): boolean {
    return rowsEqual(rows, hydrateBacteriaModAssignmentsFromProject(deviceId) ?? []);
}
