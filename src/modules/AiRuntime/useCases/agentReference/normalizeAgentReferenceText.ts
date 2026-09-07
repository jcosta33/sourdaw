function foldReferenceMarks(value: string): string {
    return value.normalize('NFKD').toLocaleLowerCase().replaceAll(/\p{M}/gu, '');
}

export function normalizeAgentReferenceText(value: string): string {
    return foldReferenceMarks(value)
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}
