import { describe, expect, it } from 'vitest';

import { digestPayloadComponents, type PayloadComponent } from '../desktopLatencyRecord.ts';

const asar: PayloadComponent = { path: 'Contents/Resources/app.asar', bytes: Buffer.from('renderer bundle') };
const addon: PayloadComponent = { path: 'Contents/Resources/sourdaw-native.node', bytes: Buffer.from('native addon') };
const scanHelper: PayloadComponent = {
    path: 'Contents/Resources/sourdaw-plugin-scan-helper',
    bytes: Buffer.from('scan helper'),
};

describe('digestPayloadComponents', () => {
    it('changes when one component keeps its path but changes its bytes', () => {
        const before = digestPayloadComponents([asar, addon, scanHelper]);
        const rebuiltAddon: PayloadComponent = { ...addon, bytes: Buffer.from('native addon, rebuilt') };
        const after = digestPayloadComponents([asar, rebuiltAddon, scanHelper]);

        expect(after).not.toBe(before);
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
