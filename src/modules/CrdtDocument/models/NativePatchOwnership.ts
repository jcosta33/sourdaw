import { type Patch } from '@automerge/automerge';

import { isRecord } from '#/utils/structuralEquality';

function createsMissingMap(patch: Patch, before: unknown): boolean {
    if (
        patch.action !== 'put' ||
        patch.conflict === true ||
        !isRecord(patch.value) ||
        Object.getPrototypeOf(patch.value) !== Object.prototype ||
        Object.keys(patch.value).length > 0
    ) {
        return false;
    }
    let value = before;
    for (const key of patch.path) {
        if (typeof key !== 'string' || !isRecord(value)) {
            return false;
        }
        if (!Object.hasOwn(value, key)) {
            return true;
        }
        value = value[key];
    }
    return false;
}

export function isNativePatchWithinOwnedPath(patch: Patch, ownedPath: readonly string[], before: unknown): boolean {
    const sharedLength = Math.min(ownedPath.length, patch.path.length);
    for (let index = 0; index < sharedLength; index++) {
        if (patch.path[index] !== ownedPath[index]) {
            return false;
        }
    }
    // An existing ancestor may contain other owners' data. Only an empty
    // map at a previously absent ancestor may scaffold the owned path.
    return patch.path.length >= ownedPath.length || createsMissingMap(patch, before);
}
