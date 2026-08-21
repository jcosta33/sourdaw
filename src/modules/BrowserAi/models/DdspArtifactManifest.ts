/** Exact Magenta-hosted DDSP checkpoint files admitted for direct runtime use. */
export type DdspArtifact = {
    path: 'model.json' | 'group1-shard1of1.bin' | 'settings.json';
    sizeBytes: number;
    sha256: string;
    url: string;
};

export const DDSP_CHECKPOINT_VERSION = 'magenta-js-ddsp-2020-01-05';

const base = 'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp';

function artifacts(
    instrument: string,
    hashes: readonly [string, string, string],
    settingsSizeBytes: 171 | 173
): DdspArtifact[] {
    return [
        { path: 'model.json', url: `${base}/${instrument}/model.json`, sizeBytes: 381_158, sha256: hashes[0] },
        {
            path: 'group1-shard1of1.bin',
            url: `${base}/${instrument}/group1-shard1of1.bin`,
            sizeBytes: 3_888_160,
            sha256: hashes[1],
        },
        {
            path: 'settings.json',
            url: `${base}/${instrument}/settings.json`,
            sizeBytes: settingsSizeBytes,
            sha256: hashes[2],
        },
    ];
}

export const DDSP_ARTIFACTS = Object.freeze({
    violin: artifacts(
        'violin',
        [
            '4c4cc99e186fb101442c38fd0ed869c7911feb81a03113c092f48a7f07f89888',
            'e2df331d82cf56ed58c202c7af545b305f6794c655897dfc45535620a0d2fc12',
            '9cfae64cf6e36007192a479f6f74e26356ed0e6d4521d242498bcb4e04723269',
        ],
        171
    ),
    flute: artifacts(
        'flute',
        [
            '81a2187d58ca5d02e30b755aaa9abed171b0269a7cf2207f445a177af9add434',
            '1ce83914040927c5713ad80131c9bfa7eed960b696ca8f17176392b7287ad745',
            'd4b754db5cd6fe4937de3bd205c4db1aa6d824b8a35571f62047b7a546628fc3',
        ],
        171
    ),
    trumpet: artifacts(
        'trumpet',
        [
            '20cf69198fc87decefce850fc5315562f2d72c01da89cd16581dc868f1daa5b5',
            '4785eff16aef6d5e620f70866b865e3cb6462f0670edeeb9711603a354170538',
            '60e26d8fd06c963b2828c112f70d4e5667fc9cd328fe6a65977fe839d6393e93',
        ],
        173
    ),
    tenor_saxophone: artifacts(
        'tenor_saxophone',
        [
            '1b334b0639c2dd7f19e904a977339c7e4b53fe7fde4f56cc7c9797c99789787e',
            'e4f9c5703a80cb874bca35818b22eb86d7f02ade3098974b47c6d248e6e57f0d',
            '4632398ffae90dc12dccf6bb9480102c6947f5c5eb5829415108f25d8cf0a7fe',
        ],
        171
    ),
});
