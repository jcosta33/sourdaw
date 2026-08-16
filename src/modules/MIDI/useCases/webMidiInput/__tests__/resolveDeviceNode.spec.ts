import { describe, expect, it } from 'vitest';

import { resolveDeviceNode } from '../resolveDeviceNode';

type TestNode = { deviceId: string; type: string };

function strip(...deviceNodes: TestNode[]): { deviceNodes: TestNode[] } {
    return { deviceNodes };
}

describe('resolveDeviceNode', () => {
    it('matches on device kind alone when only a type is asked for', () => {
        const node = { deviceId: 'gb-1', type: 'grand-boule' };
        expect(resolveDeviceNode(strip({ deviceId: 'f-1', type: 'fermenter' }, node), { type: 'grand-boule' })).toBe(
            node
        );
    });

    it('never matches a device id when only a type is asked for', () => {
        // The rack-routed branches address the strip by kind. Widening them to
        // also match the id would make a lookup for one kind return a node of
        // another whenever the caller happens to pass an id-shaped type.
        const nodes = strip({ deviceId: 'levain', type: 'fermenter' });
        expect(resolveDeviceNode(nodes, { type: 'levain' })).toBeUndefined();
    });

    it('accepts either the exact instance or the kind when both are asked for', () => {
        const byKind = { deviceId: 'gb-old', type: 'grand-boule' };
        expect(resolveDeviceNode(strip(byKind), { deviceId: 'gb-new', type: 'grand-boule' })).toBe(byKind);

        const byId = { deviceId: 'gb-new', type: 'stale-type' };
        expect(resolveDeviceNode(strip(byId), { deviceId: 'gb-new', type: 'grand-boule' })).toBe(byId);
    });

    it('never falls back to the device kind when only an instance id is asked for', () => {
        // Note-off releases the node its note-on latched onto. A fallback to the
        // kind would release a different instance whenever a track hosts two
        // devices of one kind, leaving the real voice sounding forever.
        const other = { deviceId: 'levain-b', type: 'levain' };
        expect(resolveDeviceNode(strip(other), { deviceId: 'levain-a' })).toBeUndefined();
    });

    it('returns the first match so branch priority is unchanged', () => {
        const first = { deviceId: 'lv-1', type: 'levain' };
        const second = { deviceId: 'lv-2', type: 'levain' };
        expect(resolveDeviceNode(strip(first, second), { type: 'levain' })).toBe(first);
    });

    it('resolves to nothing when the track has no strip yet', () => {
        expect(resolveDeviceNode(undefined, { type: 'fermenter' })).toBeUndefined();
    });
});
