const moveBeatAssertionPattern =
    /\bbeat\b[\s:=]*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?%?)(?![\p{L}\p{N}_.])/giu;

export function getMoveBeatAssertions(text: string): RegExpExecArray[] {
    return [...text.matchAll(moveBeatAssertionPattern)];
}
