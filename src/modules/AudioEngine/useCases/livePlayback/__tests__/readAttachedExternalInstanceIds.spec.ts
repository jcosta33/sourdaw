/**
 * Which external plugin instances the live producer may build a native body for
 * (#3563).
 *
 * The failure mode is over-reporting: an id returned here is an id the producer
 * marks `contributesAudio`, and the mapper refuses the *whole batch* over a
 * device it then cannot splice an engine-owned instance into. So the cases
 * below pin the two ways an instance can fail to be attached — recorded as
 * unattached, and not recorded at all — beside the one way it can be.
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

import { readAttachedExternalInstanceIds } from '../readAttachedExternalInstanceIds';

function snapshot(engineAttached: boolean): ExternalPluginParameterSnapshot {
    return { engineAttached, parameters: [] };
}

afterEach(() => {
    externalPluginParameterStore.set(defaultExternalPluginParameterState);
});

describe('readAttachedExternalInstanceIds', () => {
    it('reports the attached instances and nothing else', () => {
        externalPluginParameterStore.set({
            byInstanceId: { i1: snapshot(true), i2: snapshot(false) },
        });

        expect(readAttachedExternalInstanceIds()).toEqual(new Set(['i1']));
    });

    it('reports nothing when no instance has reached the engine', () => {
        externalPluginParameterStore.set({ byInstanceId: { i2: snapshot(false) } });

        expect(readAttachedExternalInstanceIds()).toEqual(new Set());
    });
});
