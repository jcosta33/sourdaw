import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { SAVED_PROJECT_STATE_SURFACES } from '../savedProjectStatePaths.ts';

function trackedPathsLowercased(): readonly string[] {
    return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\0')
        .filter((path) => path !== '')
        .map((path) => path.toLowerCase());
}

describe('SAVED_PROJECT_STATE_SURFACES', () => {
    it('names a tracked path with every exact and prefix matcher, so a moved owner cannot silently drop out', () => {
        const tracked = trackedPathsLowercased();
        const dead = SAVED_PROJECT_STATE_SURFACES.flatMap(({ matcher }) => {
            if (matcher.kind === 'exact') {
                return tracked.includes(matcher.value) ? [] : [`exact:${matcher.value}`];
            }
            if (matcher.kind === 'prefix') {
                return tracked.some((path) => path.startsWith(matcher.value)) ? [] : [`prefix:${matcher.value}`];
            }
            return [];
        });
        const checked = SAVED_PROJECT_STATE_SURFACES.filter(
            ({ matcher }) => matcher.kind === 'exact' || matcher.kind === 'prefix'
        );

        expect(checked.length).toBeGreaterThan(0);
        expect(dead).toEqual([]);
    });
});
