/**
 * A token count meant never to fall below the local model's own: Qwen3 spells every digit as its
 * own token, and no run of three other characters costs it more than one token in the JSON and
 * English a planning request carries.
 */
export function estimateConservativePromptTokens(text: string): number {
    let digits = 0;
    let others = 0;
    for (const character of text) {
        if (character >= '0' && character <= '9') {
            digits += 1;
        } else {
            others += 1;
        }
    }
    return digits + Math.ceil(others / 3);
}
