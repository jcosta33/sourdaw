import { describe, expect, it } from 'vitest';

import { DDSP_ARTIFACTS, DDSP_CHECKPOINT_VERSION } from '../DdspArtifactManifest';
import { DDSP_INSTRUMENT_CATALOG, type DdspInstrumentId, resolveDdspInstrument } from '../DdspInstrumentCatalog';

const MAGENTA_CHECKPOINT_BASE = 'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp';

describe('DDSP checkpoint catalog', () => {
    it('should pin exactly the four admitted Magenta checkpoints and every verified artifact', () => {
        expect(DDSP_INSTRUMENT_CATALOG.map(({ id, instrument }) => [id, instrument])).toEqual([
            ['ddsp-violin', 'violin'],
            ['ddsp-flute', 'flute'],
            ['ddsp-trumpet', 'trumpet'],
            ['ddsp-tenor-saxophone', 'tenor_saxophone'],
        ]);

        expect(DDSP_ARTIFACTS).toEqual({
            violin: [
                {
                    path: 'model.json',
                    url: `${MAGENTA_CHECKPOINT_BASE}/violin/model.json`,
                    sizeBytes: 381_158,
                    sha256: '4c4cc99e186fb101442c38fd0ed869c7911feb81a03113c092f48a7f07f89888',
                },
                {
                    path: 'group1-shard1of1.bin',
                    url: `${MAGENTA_CHECKPOINT_BASE}/violin/group1-shard1of1.bin`,
                    sizeBytes: 3_888_160,
                    sha256: 'e2df331d82cf56ed58c202c7af545b305f6794c655897dfc45535620a0d2fc12',
                },
                {
                    path: 'settings.json',
                    url: `${MAGENTA_CHECKPOINT_BASE}/violin/settings.json`,
                    sizeBytes: 171,
                    sha256: '9cfae64cf6e36007192a479f6f74e26356ed0e6d4521d242498bcb4e04723269',
                },
            ],
            flute: [
                {
                    path: 'model.json',
                    url: `${MAGENTA_CHECKPOINT_BASE}/flute/model.json`,
                    sizeBytes: 381_158,
                    sha256: '81a2187d58ca5d02e30b755aaa9abed171b0269a7cf2207f445a177af9add434',
                },
                {
                    path: 'group1-shard1of1.bin',
                    url: `${MAGENTA_CHECKPOINT_BASE}/flute/group1-shard1of1.bin`,
                    sizeBytes: 3_888_160,
                    sha256: '1ce83914040927c5713ad80131c9bfa7eed960b696ca8f17176392b7287ad745',
                },
                {
                    path: 'settings.json',
                    url: `${MAGENTA_CHECKPOINT_BASE}/flute/settings.json`,
                    sizeBytes: 171,
                    sha256: 'd4b754db5cd6fe4937de3bd205c4db1aa6d824b8a35571f62047b7a546628fc3',
                },
            ],
            trumpet: [
                {
                    path: 'model.json',
                    url: `${MAGENTA_CHECKPOINT_BASE}/trumpet/model.json`,
                    sizeBytes: 381_158,
                    sha256: '20cf69198fc87decefce850fc5315562f2d72c01da89cd16581dc868f1daa5b5',
                },
                {
                    path: 'group1-shard1of1.bin',
                    url: `${MAGENTA_CHECKPOINT_BASE}/trumpet/group1-shard1of1.bin`,
                    sizeBytes: 3_888_160,
                    sha256: '4785eff16aef6d5e620f70866b865e3cb6462f0670edeeb9711603a354170538',
                },
                {
                    path: 'settings.json',
                    url: `${MAGENTA_CHECKPOINT_BASE}/trumpet/settings.json`,
                    sizeBytes: 173,
                    sha256: '60e26d8fd06c963b2828c112f70d4e5667fc9cd328fe6a65977fe839d6393e93',
                },
            ],
            tenor_saxophone: [
                {
                    path: 'model.json',
                    url: `${MAGENTA_CHECKPOINT_BASE}/tenor_saxophone/model.json`,
                    sizeBytes: 381_158,
                    sha256: '1b334b0639c2dd7f19e904a977339c7e4b53fe7fde4f56cc7c9797c99789787e',
                },
                {
                    path: 'group1-shard1of1.bin',
                    url: `${MAGENTA_CHECKPOINT_BASE}/tenor_saxophone/group1-shard1of1.bin`,
                    sizeBytes: 3_888_160,
                    sha256: 'e4f9c5703a80cb874bca35818b22eb86d7f02ade3098974b47c6d248e6e57f0d',
                },
                {
                    path: 'settings.json',
                    url: `${MAGENTA_CHECKPOINT_BASE}/tenor_saxophone/settings.json`,
                    sizeBytes: 171,
                    sha256: '4632398ffae90dc12dccf6bb9480102c6947f5c5eb5829415108f25d8cf0a7fe',
                },
            ],
        });
    });

    it('should assign the exact checkpoint version to every catalog entry', () => {
        expect(DDSP_CHECKPOINT_VERSION).toBe('magenta-js-ddsp-2020-01-05');
        expect(DDSP_INSTRUMENT_CATALOG.every((entry) => entry.artifactVersion === DDSP_CHECKPOINT_VERSION)).toBe(true);
    });

    it('should resolve only admitted identifiers, never a caller-provided manifest', () => {
        const forgedId: string = 'ddsp-synth';
        expect(resolveDdspInstrument('ddsp-violin').artifacts).toBe(DDSP_INSTRUMENT_CATALOG[0]?.artifacts);
        expect(() => resolveDdspInstrument(forgedId as DdspInstrumentId)).toThrow('DDSP instrument is not admitted');
    });
});
