/** Edit distance between two strings, kept to a single matrix row so short reference names stay cheap. */
export function levenshteinDistance(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    if (left.length === 0) {
        return right.length;
    }
    if (right.length === 0) {
        return left.length;
    }

    let previousRow = Array.from({ length: right.length + 1 }, (_, column) => column);
    for (let row = 1; row <= left.length; row += 1) {
        const currentRow = [row];
        for (let column = 1; column <= right.length; column += 1) {
            const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
            currentRow[column] = Math.min(
                previousRow[column]! + 1,
                currentRow[column - 1]! + 1,
                previousRow[column - 1]! + substitutionCost
            );
        }
        previousRow = currentRow;
    }
    return previousRow[right.length]!;
}
