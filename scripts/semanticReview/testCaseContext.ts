/** Proof that the existing source regions contain complete collected test cases. */

import ts from 'typescript';

import type { EvidenceReference } from './contracts.ts';
import { sliceLines, splitLines, type LineRange } from './slicing.ts';

export type TestCaseContextProof = {
    readonly complete: boolean;
    readonly beforeEvidenceIds: readonly string[];
    readonly afterEvidenceIds: readonly string[];
};

type SideProof = { readonly complete: boolean; readonly evidenceIds: readonly string[] };

/** Match the collector's `split('\n')` bounds, including bare CR and Unicode separators. */
function lfLineStarts(source: string): number[] {
    const starts = [0];
    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === '\n') {
            starts.push(index + 1);
        }
    }
    return starts;
}

function lfLineAt(starts: readonly number[], offset: number): number {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if ((starts[middle] ?? 0) <= offset) {
            low = middle;
        } else {
            high = middle;
        }
    }
    return low + 1;
}

function testRoot(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression)) {
        return expression.text === 'it' || expression.text === 'test';
    }
    if (ts.isPropertyAccessExpression(expression)) {
        return testRoot(expression.expression);
    }
    if (ts.isCallExpression(expression)) {
        return testRoot(expression.expression);
    }
    return false;
}

function testCaseRanges(
    path: string,
    source: string
): { readonly recognized: readonly LineRange[]; readonly unrecognized: readonly LineRange[] } | undefined {
    const kind = path.endsWith('.tsx') || path.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
    if ('parseDiagnostics' in file && Array.isArray(file.parseDiagnostics) && file.parseDiagnostics.length > 0) {
        return undefined;
    }
    const starts = lfLineStarts(source);
    const recognized: LineRange[] = [];
    const unrecognized: LineRange[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && testRoot(node.expression)) {
            const callback = node.arguments.at(-1);
            const direct = ts.isIdentifier(node.expression);
            const complete =
                direct &&
                callback !== undefined &&
                (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
                ts.isBlock(callback.body);
            const range = {
                startLine: lfLineAt(starts, node.getStart(file)),
                endLine: lfLineAt(starts, node.end - 1),
            };
            if (complete) {
                recognized.push(range);
            } else {
                unrecognized.push(range);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return { recognized, unrecognized };
}

function overlaps(left: LineRange, right: LineRange): boolean {
    return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function hasUncoveredHunk(input: {
    readonly range: LineRange;
    readonly changed: readonly number[] | undefined;
    readonly matched: readonly LineRange[];
    readonly unrecognized: readonly LineRange[];
    readonly sourceLines: readonly string[];
}): boolean {
    if (input.unrecognized.some((range) => overlaps(range, input.range))) {
        return true;
    }
    if (input.changed !== undefined) {
        return input.changed.some(
            (line) => !input.matched.some((range) => line >= range.startLine && line <= range.endLine)
        );
    }
    return input.sourceLines.some(
        (line, index) =>
            index + 1 >= input.range.startLine &&
            index + 1 <= input.range.endLine &&
            line.trim() !== '' &&
            !input.matched.some((range) => index + 1 >= range.startLine && index + 1 <= range.endLine)
    );
}

function certifySide(input: {
    readonly path: string;
    readonly source: string;
    readonly hunks: readonly LineRange[] | undefined;
    readonly changedLines?: readonly number[];
    readonly references: readonly EvidenceReference[];
}): SideProof {
    const cases = testCaseRanges(input.path, input.source);
    if (cases === undefined || cases.recognized.length === 0) {
        return { complete: false, evidenceIds: [] };
    }
    const sourceLines = splitLines(input.source);
    const relevant = new Set<LineRange>();
    for (const hunk of input.hunks ?? [{ startLine: 1, endLine: Number.MAX_SAFE_INTEGER }]) {
        const sliced = sliceLines(input.source, hunk);
        if (sliced === undefined) {
            return { complete: false, evidenceIds: [] };
        }
        const changed = input.changedLines?.filter(
            (line) => line >= sliced.range.startLine && line <= sliced.range.endLine
        );
        const matched = cases.recognized.filter(
            (range) =>
                overlaps(range, sliced.range) &&
                (changed === undefined ||
                    changed.length === 0 ||
                    changed.some((line) => line >= range.startLine && line <= range.endLine))
        );
        if (
            matched.length === 0 ||
            hasUncoveredHunk({
                range: sliced.range,
                changed,
                matched,
                unrecognized: cases.unrecognized,
                sourceLines,
            })
        ) {
            return { complete: false, evidenceIds: [] };
        }
        for (const range of matched) {
            relevant.add(range);
        }
    }
    if (
        input.changedLines?.some(
            (line) => ![...relevant].some((range) => line >= range.startLine && line <= range.endLine)
        )
    ) {
        return { complete: false, evidenceIds: [] };
    }
    const evidenceIds = new Set<string>();
    for (const range of relevant) {
        const carrying = input.references.find(
            (reference) => reference.startLine <= range.startLine && reference.endLine >= range.endLine
        );
        if (carrying === undefined) {
            return { complete: false, evidenceIds: [] };
        }
        evidenceIds.add(carrying.evidenceId);
    }
    return { complete: evidenceIds.size > 0, evidenceIds: [...evidenceIds] };
}

/** Fail closed unless the original admitted regions cover every hunk's full enclosing case. */
export function certifyTestCaseContext(input: {
    readonly before?: {
        path: string;
        source: string;
        hunks?: readonly LineRange[];
        changedLines?: readonly number[];
        references: readonly EvidenceReference[];
    };
    readonly after?: {
        path: string;
        source: string;
        hunks?: readonly LineRange[];
        changedLines?: readonly number[];
        references: readonly EvidenceReference[];
    };
}): TestCaseContextProof {
    let before: SideProof = { complete: true, evidenceIds: [] };
    if (input.before !== undefined) {
        before = certifySide(input.before);
    }
    let after: SideProof = { complete: false, evidenceIds: [] };
    if (input.after !== undefined) {
        after = certifySide(input.after);
    }
    return {
        complete: before.complete && after.complete,
        beforeEvidenceIds: before.evidenceIds,
        afterEvidenceIds: after.evidenceIds,
    };
}
