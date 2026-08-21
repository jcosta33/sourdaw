import { describe, expect, it } from 'vitest';

import { assertDdspTfjsWorkerBundleClosure, DDSP_TFJS_BUNDLE_PACKAGES } from '../checkDdspTfjsWorkerBundle';

function sourceMapFor(packages: readonly { name: string; version: string }[]): string {
    return JSON.stringify({
        version: 3,
        sources: packages.map(({ name, version }) => {
            const storeName = name.replace('/', '+');
            return `../../node_modules/.pnpm/${storeName}@${version}/node_modules/${name}/dist/index.js`;
        }),
    });
}

describe('DDSP TensorFlow.js worker bundle closure', () => {
    it('should accept the exact package and version closure observed in the production worker source map', () => {
        expect(assertDdspTfjsWorkerBundleClosure(sourceMapFor(DDSP_TFJS_BUNDLE_PACKAGES))).toEqual(
            DDSP_TFJS_BUNDLE_PACKAGES
        );
    });

    it('should reject an unexpected bundled package', () => {
        const sourceMap = sourceMapFor([
            ...DDSP_TFJS_BUNDLE_PACKAGES,
            { name: 'unexpected-runtime', version: '1.0.0' },
        ]);

        expect(() => assertDdspTfjsWorkerBundleClosure(sourceMap)).toThrow(/unexpected-runtime@1\.0\.0/u);
    });

    it('should reject a missing package or a version drift', () => {
        expect(() => assertDdspTfjsWorkerBundleClosure(sourceMapFor(DDSP_TFJS_BUNDLE_PACKAGES.slice(1)))).toThrow(
            /bundle closure does not match/u
        );
        expect(() =>
            assertDdspTfjsWorkerBundleClosure(
                sourceMapFor(
                    DDSP_TFJS_BUNDLE_PACKAGES.map((entry) =>
                        entry.name === '@tensorflow/tfjs-layers' ? { ...entry, version: '4.23.0' } : entry
                    )
                )
            )
        ).toThrow(/@tensorflow\/tfjs-layers@4\.23\.0/u);
    });

    it('should fail closed on a malformed source map', () => {
        expect(() => assertDdspTfjsWorkerBundleClosure('{}')).toThrow(/source map/u);
        expect(() => assertDdspTfjsWorkerBundleClosure('not-json')).toThrow(/source map/u);
    });
});
