export type PromptQuotedTextScan = {
    complete: boolean;
    maskedText: string;
};

type QuoteState = {
    closing: '"' | "'" | '”' | '’';
    single: boolean;
};

function isWordCharacterBefore(value: string, index: number): boolean {
    return /[\p{L}\p{N}]$/u.test(value.slice(0, index));
}

function isWordCharacterAfter(value: string, index: number): boolean {
    return /^[\p{L}\p{N}]/u.test(value.slice(index + 1));
}

function getOpeningQuote(value: string, index: number): QuoteState | null {
    const character = value[index];
    if (character === '"') {
        return { closing: '"', single: false };
    }
    if (character === '“') {
        return { closing: '”', single: false };
    }
    if (character === '‘') {
        return { closing: '’', single: true };
    }
    if (character === "'" && !isWordCharacterBefore(value, index)) {
        return { closing: "'", single: true };
    }
    return null;
}

function isClosingQuote(value: string, index: number, quote: QuoteState): boolean {
    if (value[index] !== quote.closing) {
        return false;
    }
    return !(quote.single && isWordCharacterBefore(value, index) && isWordCharacterAfter(value, index));
}

export function scanPromptQuotedText(value: string): PromptQuotedTextScan {
    let quote: QuoteState | null = null;
    let maskedText = '';

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index]!;
        if (quote === null) {
            quote = getOpeningQuote(value, index);
            maskedText += character;
            continue;
        }
        if (isClosingQuote(value, index, quote)) {
            quote = null;
            maskedText += character;
            continue;
        }
        maskedText += character === '\n' ? '\n' : ' ';
    }

    return { complete: quote === null, maskedText };
}

export function maskQuotedTextContents(value: string): string {
    return scanPromptQuotedText(value).maskedText;
}
