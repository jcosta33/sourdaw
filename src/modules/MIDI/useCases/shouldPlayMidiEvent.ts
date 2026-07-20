type ShouldPlayMidiEventInput = {
    projectProbabilitySeed: number;
    clipId: string;
    eventId: string;
    absoluteOccurrenceIndex: number;
    probabilityPercent: number;
};

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const U32_RANGE = 4_294_967_296;

function mixByte(hash: number, value: number): number {
    return Math.imul((hash ^ value) >>> 0, FNV_PRIME) >>> 0;
}

function mixU32(hash: number, value: number): number {
    const unsignedValue = value >>> 0;
    let mixed = hash;
    mixed = mixByte(mixed, unsignedValue & 0xff);
    mixed = mixByte(mixed, (unsignedValue >>> 8) & 0xff);
    mixed = mixByte(mixed, (unsignedValue >>> 16) & 0xff);
    mixed = mixByte(mixed, (unsignedValue >>> 24) & 0xff);
    return mixed;
}

function hashStableId(value: string): number {
    let hash = mixU32(FNV_OFFSET_BASIS, value.length);
    for (let index = 0; index < value.length; index++) {
        const codeUnit = value.charCodeAt(index);
        hash = mixByte(hash, codeUnit & 0xff);
        hash = mixByte(hash, codeUnit >>> 8);
    }
    return hash;
}

function avalanche(hash: number): number {
    let mixed = (hash ^ (hash >>> 16)) >>> 0;
    mixed = Math.imul(mixed, 0x85ebca6b) >>> 0;
    mixed = (mixed ^ (mixed >>> 13)) >>> 0;
    mixed = Math.imul(mixed, 0xc2b2ae35) >>> 0;
    return (mixed ^ (mixed >>> 16)) >>> 0;
}

function probabilityRoll({
    projectProbabilitySeed,
    clipId,
    eventId,
    absoluteOccurrenceIndex,
}: Omit<ShouldPlayMidiEventInput, 'probabilityPercent'>): number {
    const occurrence = Math.max(0, Math.trunc(absoluteOccurrenceIndex));
    const occurrenceLow = occurrence >>> 0;
    const occurrenceHigh = Math.floor(occurrence / U32_RANGE) >>> 0;

    let hash = FNV_OFFSET_BASIS;
    hash = mixU32(hash, projectProbabilitySeed);
    hash = mixU32(hash, hashStableId(clipId));
    hash = mixU32(hash, hashStableId(eventId));
    hash = mixU32(hash, occurrenceLow);
    hash = mixU32(hash, occurrenceHigh);
    return avalanche(hash) / U32_RANGE;
}

export function shouldPlayMidiEvent({
    projectProbabilitySeed,
    clipId,
    eventId,
    absoluteOccurrenceIndex,
    probabilityPercent,
}: ShouldPlayMidiEventInput): boolean {
    if (probabilityPercent <= 0) {
        return false;
    }
    if (probabilityPercent >= 100) {
        return true;
    }
    if (!Number.isFinite(probabilityPercent)) {
        return false;
    }

    const roll = probabilityRoll({
        projectProbabilitySeed,
        clipId,
        eventId,
        absoluteOccurrenceIndex,
    });
    return roll < probabilityPercent / 100;
}
