import { tauriInvoke } from '#/utils/tauriBridge';

const STANDARD_A4_ROOT_NOTE = 69;
const STANDARD_A4_ROOT_FREQ = 440;

type ParseSclOutput = {
    name: string;
    description: string;
    frequencies: number[];
};

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((frequency) => Number.isFinite(frequency));
}

function isParseSclOutput(value: unknown): value is ParseSclOutput {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    if (!('name' in value) || typeof value.name !== 'string') {
        return false;
    }

    if (!('description' in value) || typeof value.description !== 'string') {
        return false;
    }

    if (!('frequencies' in value) || !isNumberArray(value.frequencies)) {
        return false;
    }

    return true;
}

export async function parseScl(content: string): Promise<ParseSclOutput> {
    const result = await tauriInvoke('parse_scl', {
        content,
        rootNote: STANDARD_A4_ROOT_NOTE,
        rootFreq: STANDARD_A4_ROOT_FREQ,
    });

    if (!isParseSclOutput(result)) {
        throw new TypeError('parse_scl returned an invalid payload');
    }

    return result;
}
