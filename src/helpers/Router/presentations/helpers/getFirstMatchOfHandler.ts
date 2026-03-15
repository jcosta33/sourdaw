/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type UIMatch } from 'react-router';

import { type RouteHandle } from 'Client/Routes';

export const getFirstMatchOfHandler = (
    matches: UIMatch[],
    keys: (keyof RouteHandle)[] | readonly (keyof RouteHandle)[]
): (UIMatch<unknown, RouteHandle> | null)[] => {
    const result: (UIMatch<unknown, RouteHandle> | null)[] = Array.from({ length: keys.length }, () => null);
    let remaining = keys.length;

    for (const match of matches.toReversed()) {
        if (remaining === 0) {
            break;
        }

        const handle = match.handle;

        if (typeof handle !== 'object' || handle === null) {
            continue;
        }

        for (let index = 0; index < keys.length; index++) {
            if (result[index] === null && keys[index] in handle) {
                result[index] = match as UIMatch<unknown, RouteHandle>;
                remaining--;
            }
        }
    }

    return result;
};
