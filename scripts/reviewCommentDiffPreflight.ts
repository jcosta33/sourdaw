import { fail } from './prContract.ts';

/**
 * The shape of one review-comment target the bundle-diff preflight can place: anything carrying a
 * path, a line, and a side qualifies, so callers pass their own comment records without this module
 * importing them back.
 */
export type ReviewCommentDiffTarget = {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
};

type ChangedDiffLines = Map<string, { left: Set<number>; right: Set<number> }>;

type DiffLineCursor = {
    oldPath: string | undefined;
    newPath: string | undefined;
    leftLine: number | undefined;
    rightLine: number | undefined;
};

export function assertReviewCommentLinesInBundleDiff(comments: ReviewCommentDiffTarget[], diff: string): void {
    const changed = changedDiffLines(diff);
    for (const [index, comment] of comments.entries()) {
        const lines = changed.get(comment.path);
        const side = comment.side === 'RIGHT' ? lines?.right : lines?.left;
        if (side?.has(comment.line) !== true) {
            fail(
                `review.json comments[${index}] ${comment.side} ${comment.path}:${comment.line} is not a changed line in bundle diff.patch`
            );
        }
    }
}

function changedDiffLines(diff: string): ChangedDiffLines {
    const changed: ChangedDiffLines = new Map();
    const cursor: DiffLineCursor = {
        oldPath: undefined,
        newPath: undefined,
        leftLine: undefined,
        rightLine: undefined,
    };
    for (const line of diff.split('\n')) {
        applyDiffLine(changed, cursor, line);
    }
    return changed;
}

function applyDiffLine(changed: ChangedDiffLines, cursor: DiffLineCursor, line: string): void {
    if (line.startsWith('diff --git ')) {
        cursor.oldPath = undefined;
        cursor.newPath = undefined;
        cursor.leftLine = undefined;
        cursor.rightLine = undefined;
        return;
    }
    if (applyFileHeaderLine(cursor, line)) {
        return;
    }
    if (applyHunkHeaderLine(cursor, line)) {
        return;
    }
    applyHunkBodyLine(changed, cursor, line);
}

function applyFileHeaderLine(cursor: DiffLineCursor, line: string): boolean {
    if (cursor.leftLine !== undefined || cursor.rightLine !== undefined) {
        return false;
    }
    if (line.startsWith('--- ')) {
        cursor.oldPath = diffPath(line.slice(4), 'a/');
        return true;
    }
    if (line.startsWith('+++ ')) {
        cursor.newPath = diffPath(line.slice(4), 'b/');
        cursor.leftLine = undefined;
        cursor.rightLine = undefined;
        return true;
    }
    return false;
}

function applyHunkHeaderLine(cursor: DiffLineCursor, line: string): boolean {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk === null) {
        return false;
    }
    cursor.leftLine = Number(hunk[1]);
    cursor.rightLine = Number(hunk[2]);
    return true;
}

function applyHunkBodyLine(changed: ChangedDiffLines, cursor: DiffLineCursor, line: string): void {
    const { leftLine, rightLine } = cursor;
    if (leftLine === undefined || rightLine === undefined || line === '') {
        return;
    }
    if (line.startsWith('-')) {
        recordChangedLine(changed, cursor.oldPath, 'left', leftLine);
        cursor.leftLine = leftLine + 1;
        return;
    }
    if (line.startsWith('+')) {
        recordChangedLine(changed, cursor.newPath, 'right', rightLine);
        cursor.rightLine = rightLine + 1;
        return;
    }
    if (line.startsWith(' ')) {
        // GitHub renders unchanged context lines inside a hunk and accepts review comments on
        // them from either side, so both counters are recorded here, not only advanced.
        recordChangedLine(changed, cursor.oldPath, 'left', leftLine);
        recordChangedLine(changed, cursor.newPath, 'right', rightLine);
        cursor.leftLine = leftLine + 1;
        cursor.rightLine = rightLine + 1;
    }
}

function recordChangedLine(
    changed: ChangedDiffLines,
    path: string | undefined,
    side: 'left' | 'right',
    line: number
): void {
    if (path === undefined) {
        return;
    }
    const entry = changed.get(path) ?? { left: new Set<number>(), right: new Set<number>() };
    entry[side].add(line);
    changed.set(path, entry);
}

function diffPath(value: string, prefix: 'a/' | 'b/'): string | undefined {
    if (value === '/dev/null') {
        return undefined;
    }
    const path = decodeGitDiffPath(value);
    if (path === undefined || !path.startsWith(prefix)) {
        return undefined;
    }
    const repositoryPath = path.slice(prefix.length);
    return isSafeRepositoryPath(repositoryPath) ? repositoryPath : undefined;
}

function decodeGitDiffPath(value: string): string | undefined {
    if (!value.startsWith('"')) {
        const metadata = value.indexOf('\t');
        return metadata === -1 ? value : value.slice(0, metadata);
    }
    const bytes: number[] = [];
    let cursor = 1;
    while (cursor < value.length) {
        const character = value[cursor];
        if (character === '"') {
            const metadata = value.slice(cursor + 1);
            if (metadata !== '' && !metadata.startsWith('\t')) {
                return undefined;
            }
            try {
                return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
            } catch {
                return undefined;
            }
        }
        if (character !== '\\') {
            const codePoint = value.codePointAt(cursor);
            if (codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f) {
                return undefined;
            }
            bytes.push(...new TextEncoder().encode(String.fromCodePoint(codePoint)));
            cursor += codePoint > 0xffff ? 2 : 1;
            continue;
        }
        const escaped = value[cursor + 1];
        if (escaped === undefined) {
            return undefined;
        }
        const escapedByte = gitQuotedEscapeByte(escaped);
        if (escapedByte !== undefined) {
            bytes.push(escapedByte);
            cursor += 2;
            continue;
        }
        const octal = /^([0-7]{3})/.exec(value.slice(cursor + 1))?.[1];
        if (octal === undefined) {
            return undefined;
        }
        bytes.push(Number.parseInt(octal, 8));
        cursor += 4;
    }
    return undefined;
}

function gitQuotedEscapeByte(value: string): number | undefined {
    const escaped: Record<string, number> = {
        '"': 0x22,
        '\\': 0x5c,
        a: 0x07,
        b: 0x08,
        f: 0x0c,
        n: 0x0a,
        r: 0x0d,
        t: 0x09,
        v: 0x0b,
    };
    return escaped[value];
}

function isSafeRepositoryPath(path: string): boolean {
    return (
        path !== '' &&
        !path.startsWith('/') &&
        !path.includes('\0') &&
        path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    );
}
