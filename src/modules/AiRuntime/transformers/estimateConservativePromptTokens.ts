// The pre-tokenizer split of Qwen2 and Qwen3's tokenizer.json, with the case-insensitive
// contraction group spelled out: every chunk it yields is encoded separately, so it costs at least
// one token.
const QWEN_PRETOKENIZER_SPLIT =
    /'(?:[sStTmMdD]|[rR][eE]|[vV][eE]|[lL][lL])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

function countPretokenizerChunks(text: string): number {
    return text.match(QWEN_PRETOKENIZER_SPLIT)?.length ?? 0;
}

function estimateByCharacters(text: string): number {
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

/**
 * The tokens a text is budgeted at for Qwen3: the larger of two counts. One is the number of
 * chunks Qwen's pre-tokenizer splits the text into, which the model's own count can never fall
 * below, since each chunk is encoded on its own; it governs identifier-dense text, where every
 * digit and every letter or punctuation run is its own chunk. The other is one token per digit plus
 * one per three other characters, a margin for JSON and English, which the tokenizer usually packs
 * at more than three characters a token. What is bounded is the chunk count, which the model's count is
 * never below; the result is not a proven upper bound, since a chunk the vocabulary does not know
 * whole costs more than one token, so the engine's reported count is logged against it.
 */
export function estimateConservativePromptTokens(text: string): number {
    return Math.max(countPretokenizerChunks(text), estimateByCharacters(text));
}
