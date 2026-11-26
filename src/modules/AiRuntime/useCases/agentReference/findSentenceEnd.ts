/** Where the text's first sentence ends: at a semicolon, "!", "?", a newline or a period outside a figure. */
export function findSentenceEnd(text: string): number | undefined {
    return /[;!?\n]|\.(?!\d)/u.exec(text)?.index;
}
