/**
 * Which external plugin instances a project has loaded (#4355).
 *
 * The failure mode is under-reporting. `activateExternalPlugin` writes a
 * snapshot as soon as `loadPlugin` resolves, before the engine reports the
 * instance attached, so a plugin loaded while the transport is parked is
 * recorded with `engineAttached: false` and still sounds on the next Play.
 * The offline device chain keys its plugin refusal on this reader, so keeping
 * only attached snapshots — the `readAttachedExternalInstanceIds` semantics
 * this reader exists to stay distinct from — would let that instance bake dry
 * and disagree with what the session plays.
 *
 * The store is the real one: what this reads is PluginHost's public read
 * contract, and doubling it would prove only that a double was consulted.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
    type ExternalPluginParameterSnapshot,
} from '#/modules/PluginHost/stores';

import { readLoadedExternalInstanceIds } from '../readLoadedExternalInstanceIds';

function snapshot(engineAttached: boolean): ExternalPluginParameterSnapshot {
    return { engineAttached, parameters: [] };
}

afterEach(() => {
    externalPluginParameterStore.set(defaultExternalPluginParameterState);
});

describe('readLoadedExternalInstanceIds', () => {
    it('reports a parked-loaded instance whose snapshot has not attached yet, beside an attached one', () => {
        externalPluginParameterStore.set({
            byInstanceId: { parked: snapshot(false), attached: snapshot(true) },
        });

        const instanceIds = readLoadedExternalInstanceIds();

        expect(instanceIds).toEqual(new Set(['parked', 'attached']));
        expect(instanceIds.has('parked')).toBe(true);
        expect(instanceIds.has('attached')).toBe(true);
    });

    it('leaves out an instance nothing has activated', () => {
        externalPluginParameterStore.set({ byInstanceId: { loaded: snapshot(false) } });

        const instanceIds = readLoadedExternalInstanceIds();

        expect(instanceIds).toEqual(new Set(['loaded']));
        expect(instanceIds.has('never-activated')).toBe(false);
    });

    it('reports nothing when no instance has written a snapshot', () => {
        externalPluginParameterStore.set({ byInstanceId: {} });

        expect(readLoadedExternalInstanceIds()).toEqual(new Set());
    });
});
