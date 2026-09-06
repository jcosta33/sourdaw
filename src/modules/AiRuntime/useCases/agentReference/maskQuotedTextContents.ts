const quotedTextPattern = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;

export function maskQuotedTextContents(value: string): string {
    return value.replaceAll(quotedTextPattern, (quoted) => {
        const closingQuote = quoted.at(-1)!;
        return `${quoted[0]!}${' '.repeat(quoted.length - 2)}${closingQuote}`;
    });
}
