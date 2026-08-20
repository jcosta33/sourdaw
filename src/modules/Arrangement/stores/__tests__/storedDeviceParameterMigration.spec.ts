import { describe, expect, it } from 'vitest';

import { clampDeviceParameterValue } from '../../models/DeviceParameterLaw';
import { getPluginById } from '../../useCases/getPluginById';
import { sanitizeTrackSnapshot } from '../trackStore';

/**
 * The Brick-Wall Limiter's `release` was redeclared from seconds (0.01..1,
 * default 0.1) to milliseconds (1..1000, default 100). Every value a project
 * could legitimately hold under the old declaration is below the new minimum,
 * and `clampDeviceParameterValue` pins a below-minimum write to the minimum —
 * so without a migration a stored 100 ms release loads as 1 ms, the fastest
 * setting in the new range, and pumps on any low-frequency content.
 *
 * `sanitizeTrackSnapshot` is the CRDT hydrate / project-load projection, so a
 * fixture pushed through it is a stored project being opened.
 */

function storedProjectWithLimiter(release: number): unknown {
    return {
        tracks: [
            {
                id: 'master',
                name: 'Master',
                kind: 'audio',
                devices: [
                    {
                        id: 'dev-limiter',
                        name: 'Brick-Wall Limiter',
                        type: 'faust-brick-wall-limiter',
                        bypassed: false,
                        parameterValues: { ceiling: -0.3, release },
                    },
                ],
            },
        ],
        selectedTrackId: 'master',
    };
}

function loadedRelease(snapshot: unknown): number | undefined {
    const restored = sanitizeTrackSnapshot(snapshot);
    const device = restored.tracks[0]?.devices[0];
    if (!device) {
        return undefined;
    }
    const stored = device.parameterValues.release;
    if (stored === undefined) {
        return undefined;
    }
    // What the device actually receives, not just what the store holds.
    return clampDeviceParameterValue({ deviceType: device.type, paramId: 'release', value: stored });
}

describe('stored Brick-Wall Limiter release survives the seconds → milliseconds redeclaration', () => {
    it('delivers a project that stored 0.1 s as 100 ms', () => {
        expect(loadedRelease(storedProjectWithLimiter(0.1))).toBe(100);
    });

    it('maps the old declared range onto the new one', () => {
        // Old range was 0.01..1 s; the new one is 1..1000 ms.
        expect(loadedRelease(storedProjectWithLimiter(0.01))).toBe(10);
        expect(loadedRelease(storedProjectWithLimiter(0.5))).toBe(500);
        expect(loadedRelease(storedProjectWithLimiter(0.999))).toBe(999);
    });

    it('leaves a value already stored in milliseconds alone', () => {
        expect(loadedRelease(storedProjectWithLimiter(250))).toBe(250);
        expect(loadedRelease(storedProjectWithLimiter(1000))).toBe(1000);
        // The one ambiguous value: 1 is both the old maximum in seconds and the
        // new minimum in milliseconds, and nothing in the record tells them
        // apart. The boundary sits on the old side deliberately, so a value
        // written under the current declaration is never rewritten.
        expect(loadedRelease(storedProjectWithLimiter(1))).toBe(1);
    });

    it('is idempotent, because the projection re-runs on every document change', () => {
        // `sanitizeTrackSnapshot` runs on each CRDT change, not once at load, so
        // a migration that fired twice would multiply a release by a million.
        const once = sanitizeTrackSnapshot(storedProjectWithLimiter(0.1));
        const twice = sanitizeTrackSnapshot(once);
        expect(twice.tracks[0]?.devices[0]?.parameterValues.release).toBe(100);
    });

    it('needs no migration for ceiling, whose declared range never narrowed', () => {
        // -12..0 before and after, so every stored ceiling was already legal.
        const ceiling = getPluginById('faust-brick-wall-limiter')?.parameters.find(
            (parameter) => parameter.id === 'ceiling'
        );
        expect(ceiling?.minValue).toBe(-12);
        expect(ceiling?.maxValue).toBe(0);
        const restored = sanitizeTrackSnapshot(storedProjectWithLimiter(0.1));
        expect(restored.tracks[0]?.devices[0]?.parameterValues.ceiling).toBe(-0.3);
    });

    it('has no stored lookahead to migrate, because the parameter is new', () => {
        // A project written before this catalog entry existed cannot hold a
        // value for it, and the descriptor default is what `addDevice` seeds.
        const restored = sanitizeTrackSnapshot(storedProjectWithLimiter(0.1));
        expect(restored.tracks[0]?.devices[0]?.parameterValues.lookahead).toBeUndefined();
        expect(
            getPluginById('faust-brick-wall-limiter')?.parameters.find((parameter) => parameter.id === 'lookahead')
                ?.defaultValue
        ).toBe(5);
    });
});
