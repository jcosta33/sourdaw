import { describe, expect, it } from 'vitest';

import { digestPayloadComponents, type PayloadComponent } from '../desktopLatencyRecord.ts';

const asar: PayloadComponent = { path: 'Contents/Resources/app.asar', bytes: Buffer.from('renderer bundle') };
const addon: PayloadComponent = { path: 'Contents/Resources/sourdaw-native.node', bytes: Buffer.from('native addon') };
const scanHelper: PayloadComponent = {
    path: 'Contents/Resources/sourdaw-plugin-scan-helper',
    bytes: Buffer.from('scan helper'),
};

/** The real three-component array `readPayloadIdentity` hashes, in the order it was declared here — not necessarily the sorted order `digestPayloadComponents` hashes internally. */
const threeComponents: readonly PayloadComponent[] = [asar, addon, scanHelper];

describe('digestPayloadComponents', () => {
    // A digest that only iterated a prefix of the sorted list (for example
    // `sorted.slice(0, 2)`) would stay green against a test that only ever
    // changed one particular component's bytes, if that component happened to
    // sort into the covered prefix. Asserting all three individually, inside
    // the real three-component array, is what makes a dropped component show
    // up regardless of where it sorts.
    it.each([
        ['app.asar', asar.path],
        ['the native addon', addon.path],
        ['the scan helper', scanHelper.path],
    ])('changes when %s changes its bytes inside the real three-component array', (_label, changedPath) => {
        const before = digestPayloadComponents(threeComponents);
        const changed = threeComponents.map((component) =>
            component.path === changedPath
                ? { ...component, bytes: Buffer.concat([component.bytes, Buffer.from('!')]) }
                : component
        );

        expect(digestPayloadComponents(changed)).not.toBe(before);
    });

    it('does not change when the same components are given in a different order', () => {
        const ascending = digestPayloadComponents([asar, addon, scanHelper]);
        const descending = digestPayloadComponents([scanHelper, addon, asar]);

        expect(descending).toBe(ascending);
    });

    it('changes when a component with the same bytes moves to a different path', () => {
        const atItsOwnPath = digestPayloadComponents([{ path: 'Contents/Resources/app.asar', bytes: addon.bytes }]);
        const atAnotherPath = digestPayloadComponents([
            { path: 'Contents/Resources/sourdaw-native.node', bytes: addon.bytes },
        ]);

        expect(atAnotherPath).not.toBe(atItsOwnPath);
    });
});
