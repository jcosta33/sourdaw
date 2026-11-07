import { afterEach, describe, expect, it, vi } from 'vitest';

import { configuredLevainZoneTableBuilder, configureLevainZoneTableBuilder } from '../configureLevainZoneTableBuilder';

const REQUEST = {
    zones: [{ zoneId: 0, articulationId: 0, micId: 0, loKey: 60, hiKey: 60, loVel: 0, hiVel: 127 }],
    numArticulations: 1,
    numMics: 1,
};

describe('configureLevainZoneTableBuilder', () => {
    afterEach(() => {
        configureLevainZoneTableBuilder(null);
    });

    it('rejects a build when no builder is configured, so no table is computed on the render thread', async () => {
        await expect(configuredLevainZoneTableBuilder.build(REQUEST)).rejects.toThrow(
            'Levain zone table builder is not configured'
        );
    });

    it('hands the request and the abort signal to the configured builder and resolves its tables', async () => {
        const tables = { lut: new Uint32Array([0, 1]), arena: new Uint32Array([0]) };
        const builder = vi.fn(() => Promise.resolve(tables));
        const controller = new AbortController();

        configureLevainZoneTableBuilder(builder);

        await expect(configuredLevainZoneTableBuilder.build(REQUEST, controller.signal)).resolves.toBe(tables);
        expect(builder).toHaveBeenCalledExactlyOnceWith(REQUEST, controller.signal);
    });

    it('rejects with the builder failure instead of substituting tables', async () => {
        configureLevainZoneTableBuilder(() => Promise.reject(new Error('worker crashed')));

        await expect(configuredLevainZoneTableBuilder.build(REQUEST)).rejects.toThrow('worker crashed');
    });

    it('rejects again once the builder is unconfigured', async () => {
        configureLevainZoneTableBuilder(() => Promise.resolve({ lut: new Uint32Array(), arena: new Uint32Array() }));
        configureLevainZoneTableBuilder(null);

        await expect(configuredLevainZoneTableBuilder.build(REQUEST)).rejects.toThrow(
            'Levain zone table builder is not configured'
        );
    });
});
