/**
 * The one attach set every live reader takes (#4204).
 *
 * Both stores are the real ones. What this reads is each module's public read
 * contract, and doubling them would prove only that a double was consulted.
 *
 * The failure mode is under-reporting one population: a caller reading hosted
 * instances alone leaves an attached Crumbs device looking unattached to the
 * carrier law, the note sink and the MIDI writer at once — which is exactly how
 * a sampler the engine is rendering stays reported as degraded for a session.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
    crumbsEngineAttachmentStore,
    markCrumbsInstanceAttached,
    markCrumbsInstanceDetached,
} from '#/modules/Crumbs/stores';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
    type ExternalPluginParameterSnapshot,
} from '#/modules/PluginHost/stores';

import { readAttachedEngineInstanceIds } from '../readAttachedEngineInstanceIds';

function snapshot(engineAttached: boolean): ExternalPluginParameterSnapshot {
    return { engineAttached, parameters: [] };
}

afterEach(() => {
    externalPluginParameterStore.set(defaultExternalPluginParameterState);
    crumbsEngineAttachmentStore.set(new Set<string>());
});

describe('readAttachedEngineInstanceIds', () => {
    it('unions the attached hosted instances with the attached Crumbs devices', () => {
        externalPluginParameterStore.set({ byInstanceId: { i1: snapshot(true), i2: snapshot(false) } });
        markCrumbsInstanceAttached('d-crumbs');

        expect(readAttachedEngineInstanceIds()).toEqual(new Set(['i1', 'd-crumbs']));
    });

    it('reports the hosted instances alone when the engine holds no sampler', () => {
        externalPluginParameterStore.set({ byInstanceId: { i1: snapshot(true) } });

        expect(readAttachedEngineInstanceIds()).toEqual(new Set(['i1']));
    });

    it('reports the samplers alone when no plugin has reached the engine', () => {
        externalPluginParameterStore.set({ byInstanceId: { i2: snapshot(false) } });
        markCrumbsInstanceAttached('d-crumbs');

        expect(readAttachedEngineInstanceIds()).toEqual(new Set(['d-crumbs']));
    });

    it('drops a sampler the mirror has retracted', () => {
        markCrumbsInstanceAttached('d-crumbs');
        markCrumbsInstanceDetached('d-crumbs');

        expect(readAttachedEngineInstanceIds()).toEqual(new Set());
    });
});
