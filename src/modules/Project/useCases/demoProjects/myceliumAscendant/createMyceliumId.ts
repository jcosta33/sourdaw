export type MyceliumIdNamespace =
    | 'track'
    | 'device'
    | 'rhythm-clip'
    | 'rhythm-note'
    | 'voice-clip'
    | 'voice-note'
    | 'automation'
    | 'marker'
    | 'section'
    | 'chord'
    | 'sidechain'
    | 'yeast-processor'
    | 'arrangement'
    | 'alternative'
    | 'tempo'
    | 'meter';

const HASH_SEEDS = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35] as const;

function hashWord(value: string, seed: number): string {
    let hash = seed;
    for (let index = 0; index < value.length; index++) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createMyceliumId(namespace: MyceliumIdNamespace, key: string): string {
    const source = `sourdaw:mycelium-ascendant:${namespace}:${key}`;
    const hex = HASH_SEEDS.map((seed) => hashWord(source, seed)).join('');
    const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
}
