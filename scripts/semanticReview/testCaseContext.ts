/** Proof that the existing source regions contain complete collected test cases. */

import ts from 'typescript';

import { isCollectedSpec } from './rules.ts';
import { sliceLines, type LineRange } from './slicing.ts';

import type { PathChangedLines } from './changeFacts.ts';
import type { EvidenceReference } from './contracts.ts';
import type { PathHunks } from './evidence.ts';
import type { ChangedFileContents } from './evidenceOrdering.ts';
import type { SemanticChangedFile } from './exclusion.ts';

export type TestCaseContextProof = {
    readonly complete: boolean;
    readonly beforeEvidenceIds: readonly string[];
    readonly afterEvidenceIds: readonly string[];
};

type SideProof = { readonly complete: boolean; readonly evidenceIds: readonly string[] };
type OffsetRange = { readonly start: number; readonly end: number };
type CaseRange = LineRange & { readonly startOffset: number; readonly endOffset: number };
type ParsedCases = {
    readonly recognized: readonly CaseRange[];
    readonly unrecognized: readonly LineRange[];
    readonly tokens: readonly OffsetRange[];
};

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

function testCaseRanges(path: string, source: string): ParsedCases | undefined {
    const kind = path.endsWith('.tsx') || path.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
    if ('parseDiagnostics' in file && Array.isArray(file.parseDiagnostics) && file.parseDiagnostics.length > 0) {
        return undefined;
    }
    const starts = lfLineStarts(source);
    const recognized: CaseRange[] = [];
    const unrecognized: LineRange[] = [];
    let invalidBounds = false;
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && testRoot(node.expression)) {
            const callback = node.arguments.at(-1);
            const direct = ts.isIdentifier(node.expression);
            const complete =
                direct &&
                callback !== undefined &&
                (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
                ts.isBlock(callback.body);
            const startOffset = node.getStart(file);
            let endOffset = node.end;
            if (ts.isExpressionStatement(node.parent) && node.parent.expression === node) {
                endOffset = node.parent.end;
            }
            if (startOffset < 0 || endOffset <= startOffset || endOffset > source.length) {
                invalidBounds = true;
                return;
            }
            const range = {
                startLine: lfLineAt(starts, startOffset),
                endLine: lfLineAt(starts, endOffset - 1),
            };
            if (complete) {
                recognized.push({ ...range, startOffset, endOffset });
            } else {
                unrecognized.push(range);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    if (invalidBounds) {
        return undefined;
    }
    const tokens = codeTokens(file);
    if (tokens === undefined) {
        return undefined;
    }
    return { recognized, unrecognized, tokens };
}

function overlaps(left: LineRange, right: LineRange): boolean {
    return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

/** Parsed leaves retain the parser's regex, template, and JSX lexical context. */
function codeTokens(file: ts.SourceFile): readonly OffsetRange[] | undefined {
    const tokens: OffsetRange[] = [];
    let invalidBounds = false;
    const visit = (node: ts.Node): void => {
        const children = node.getChildren(file);
        if (children.length > 0) {
            for (const child of children) {
                visit(child);
            }
            return;
        }
        if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.SyntaxList) {
            return;
        }
        const start = node.getStart(file);
        const end = node.end;
        if (start < 0 || end <= start || end > file.text.length) {
            invalidBounds = true;
            return;
        }
        tokens.push({ start, end });
    };
    visit(file);
    if (invalidBounds) {
        return undefined;
    }
    return tokens;
}

function hasUncoveredHunk(input: {
    readonly range: LineRange;
    readonly changed: readonly number[] | undefined;
    readonly matched: readonly CaseRange[];
    readonly unrecognized: readonly LineRange[];
    readonly tokens: readonly OffsetRange[];
    readonly lineStarts: readonly number[];
    readonly sourceLength: number;
}): boolean {
    if (input.unrecognized.some((range) => overlaps(range, input.range))) {
        return true;
    }
    if (
        input.changed?.some((line) => !input.matched.some((range) => line >= range.startLine && line <= range.endLine))
    ) {
        return true;
    }
    if (input.changed?.length === 0) {
        // The opposite revision carries this deletion's changed lines; this side is context only.
        return false;
    }
    let lines: readonly number[];
    if (input.changed !== undefined) {
        lines = input.changed;
    } else {
        lines = Array.from(
            { length: input.range.endLine - input.range.startLine + 1 },
            (_, index) => input.range.startLine + index
        );
    }
    const lineSpans: OffsetRange[] = [];
    for (const line of lines) {
        const start = input.lineStarts[line - 1];
        const end = input.lineStarts[line] ?? input.sourceLength;
        if (start === undefined || end < start || end > input.sourceLength) {
            return true;
        }
        lineSpans.push({ start, end });
    }
    return input.tokens.some(
        (token) =>
            lineSpans.some((line) => token.start < line.end && token.end > line.start) &&
            !input.matched.some((range) => range.startOffset <= token.start && token.end <= range.endOffset)
    );
}

function certifySide(input: {
    readonly path: string;
    readonly source: string;
    readonly hunks?: readonly LineRange[];
    readonly changedLines?: readonly number[];
    readonly references: readonly EvidenceReference[];
}): SideProof {
    const cases = testCaseRanges(input.path, input.source);
    if (cases === undefined || cases.recognized.length === 0) {
        return { complete: false, evidenceIds: [] };
    }
    const lineStarts = lfLineStarts(input.source);
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
                tokens: cases.tokens,
                lineStarts,
                sourceLength: input.source.length,
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

/** Certifies only the hunk regions already admitted for collected test files. */
export function collectTestCaseContext(input: {
    readonly files: readonly SemanticChangedFile[];
    readonly contents: ReadonlyMap<string, ChangedFileContents>;
    readonly hunks: ReadonlyMap<string, PathHunks>;
    readonly changedLines: ReadonlyMap<string, PathChangedLines>;
    readonly references: readonly EvidenceReference[];
    readonly attribution: ReadonlyMap<string, readonly string[]>;
}): ReadonlyMap<string, TestCaseContextProof> {
    const proofs = new Map<string, TestCaseContextProof>();
    for (const file of input.files) {
        if (!isCollectedSpec(file.path)) {
            continue;
        }
        const sides = input.contents.get(file.path);
        const hunks = input.hunks.get(file.path);
        const lines = input.changedLines.get(file.path);
        const ownReferences = input.references.filter((reference) =>
            input.attribution.get(reference.evidenceId)?.includes(file.path)
        );
        let beforeSide: Parameters<typeof certifyTestCaseContext>[0]['before'];
        if (sides?.before !== undefined) {
            beforeSide = {
                path: file.previousPath ?? file.path,
                source: sides.before,
                hunks: hunks?.before,
                changedLines: lines?.removed.map((line) => line.line),
                references: ownReferences.filter((reference) => reference.side === 'before'),
            };
        }
        let afterSide: Parameters<typeof certifyTestCaseContext>[0]['after'];
        if (sides?.after !== undefined) {
            afterSide = {
                path: file.path,
                source: sides.after,
                hunks: hunks?.after,
                changedLines: lines?.added.map((line) => line.line),
                references: ownReferences.filter((reference) => reference.side === 'after'),
            };
        }
        proofs.set(file.path, certifyTestCaseContext({ before: beforeSide, after: afterSide }));
    }
    return proofs;
}
