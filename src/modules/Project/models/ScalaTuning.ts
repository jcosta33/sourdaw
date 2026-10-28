export const STANDARD_A4_ROOT_NOTE = 69;
export const STANDARD_A4_ROOT_FREQ = 440;

export const PARSE_ERROR_KINDS = [
    'missing-description',
    'missing-count',
    'invalid-count',
    'count-mismatch',
    'allocation-failed',
    'invalid-cents',
    'invalid-ratio',
    'invalid-numerator',
    'invalid-denominator',
    'zero-numerator',
    'zero-denominator',
    'invalid-integer-ratio',
] as const;

export type ParseSclOutput = {
    name: string;
    description: string;
    frequencies: number[];
};

export type ParseSclError = {
    kind: (typeof PARSE_ERROR_KINDS)[number];
    line: number;
    reason: string;
};

export type ParseSclResult = { status: 'parsed'; scale: ParseSclOutput } | { status: 'invalid'; error: ParseSclError };
