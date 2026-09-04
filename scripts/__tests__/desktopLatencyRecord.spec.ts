import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { digestPayloadComponents, writeRecord, type PayloadComponent } from '../desktopLatencyRecord.ts';

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

describe('writeRecord', () => {
    let root: string | undefined;

    afterEach(() => {
        vi.restoreAllMocks();
        if (root !== undefined) {
            rmSync(root, { recursive: true, force: true });
            root = undefined;
        }
    });

    // Every baseline driver (desktop latency, transport clock, and any later
    // addition) shares this one writer, so a regression here is silent in
    // every driver's own spec until a real run trips over it. This pins the
    // four things a caller actually depends on in one written file:
    // - the `jsonSafe` replacer turning `NaN`/`Infinity` into strings (fails
    //   if the replacer is swapped for `null` or dropped),
    // - `mkdirSync` creating the parent directories the path needs (fails if
    //   that call is deleted and the write throws ENOENT instead),
    // - the exact four-space indentation (fails if it drifts to two spaces
    //   or tabs), and
    // - the single trailing newline (fails if it is dropped or doubled).
    it('creates missing parent directories and writes four-space JSON with the non-finite replacer and a trailing newline', () => {
        root = mkdtempSync(join(tmpdir(), 'sourdaw-record-'));
        const path = join(root, 'one', 'two', 'record.json');
        const printed = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

        writeRecord(path, { schemaVersion: 1, mean: Number.NaN, nested: { max: Number.POSITIVE_INFINITY } });

        expect(existsSync(dirname(path))).toBe(true);
        expect(readFileSync(path, 'utf8')).toBe(
            '{\n    "schemaVersion": 1,\n    "mean": "NaN",\n    "nested": {\n        "max": "Infinity"\n    }\n}\n'
        );
        expect(printed).toHaveBeenCalledTimes(1);
        expect(printed).toHaveBeenCalledWith(expect.stringContaining('record written to'));
    });
});
