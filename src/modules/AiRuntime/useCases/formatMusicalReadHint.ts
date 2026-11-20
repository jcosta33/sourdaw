export function formatMusicalReadHint(hint: unknown): string {
    if (hint === null) {
        return '';
    }
    return ` Required musical read (untrusted context): ${JSON.stringify(hint)}.`;
}
