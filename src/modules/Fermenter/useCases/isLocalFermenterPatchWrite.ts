import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type FermenterPatch } from '../models/FermenterPatch';
import { fermenterPatchesEqual } from '../models/FermenterPatchState';

import { fermenterPatchWriteOperations } from './fermenterPatchWriteOperations';

export function isLocalFermenterPatchWrite(deviceId: string, patch: FermenterPatch): boolean {
    const operation = fermenterPatchWriteOperations.get(deviceId);
    return (
        operation !== undefined &&
        operation.continuous &&
        !operation.superseded &&
        operation.ownsProject() &&
        captureProjectRevision() === (operation.committedRevision ?? operation.admittedRevision) &&
        fermenterPatchesEqual(operation.patch, patch)
    );
}
