import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

export type UiRestatementKind = 'layout' | 'daw-chrome' | 'generic-control';

export type UiRestatementDisposition =
    | 'already-migrated'
    | 'eligible'
    | 'semantic-wrapper'
    | 'complex-grid'
    | 'renderer'
    | 'responsive-or-dynamic'
    | 'third-party/generated/test'
    | 'one-off';

export type UiRestatementRow = {
    id: string;
    file: string;
    line: number;
    fingerprint: string;
    kind: UiRestatementKind;
    mapping: string;
    disposition: UiRestatementDisposition;
};

const ROW_KEYS = ['id', 'file', 'line', 'fingerprint', 'kind', 'mapping', 'disposition'] as const;
const KINDS: readonly UiRestatementKind[] = ['layout', 'daw-chrome', 'generic-control'];
const DISPOSITIONS: readonly UiRestatementDisposition[] = [
    'already-migrated',
    'eligible',
    'semantic-wrapper',
    'complex-grid',
    'renderer',
    'responsive-or-dynamic',
    'third-party/generated/test',
    'one-off',
];

const LAYOUT_TAGS = new Set([
    'div',
    'section',
    'aside',
    'nav',
    'header',
    'footer',
    'main',
    'form',
    'ul',
    'ol',
    'li',
    'article',
    'span',
    'p',
    'fieldset',
    'label',
]);

const LAYOUT_PRIMITIVES = new Set(['Stack', 'Row', 'Grid', 'Spacer', 'Divider']);

const DAW_CHROME = new Set([
    'DawAnalysisCard',
    'DawBlockedState',
    'DawChannelStripShell',
    'DawChooserCard',
    'DawContextMenuSurface',
    'DawControlStrip',
    'DawDiagramFrame',
    'DawDialogBody',
    'DawDialogFooter',
    'DawDialogSection',
    'DawDisplaySurface',
    'DawEmptyState',
    'DawEyebrowLabel',
    'DawGridHeaderCell',
    'DawHeaderBand',
    'DawHierarchyRow',
    'DawInlineHint',
    'DawKeycap',
    'DawMenuInlineEditor',
    'DawMenuParts',
    'DawMeterBar',
    'DawMeterFrame',
    'DawMetricCluster',
    'DawMicroBadge',
    'DawMiniSectionHeader',
    'DawPanelSurface',
    'DawPickerCard',
    'DawPickerRow',
    'DawPluginChip',
    'DawPluginChoiceRow',
    'DawPluginInsetCard',
    'DawPluginLed',
    'DawPluginMetricStrip',
    'DawPluginMetricTile',
    'DawPluginRail',
    'DawPluginReadoutList',
    'DawPluginSectionCard',
    'DawPluginSectionHeader',
    'DawPluginToggle',
    'DawReadoutRow',
    'DawSectionDivider',
    'DawSideRail',
    'DawStatusDot',
    'DawSwatchButton',
    'DawTransportCluster',
    'DawUtilityListRow',
    'DawUtilityMetric',
    'DawUtilityNotice',
    'DawUtilityPanel',
    'DawUtilitySection',
]);

const UI_CONTROLS = new Set(['Button', 'Input', 'Textarea', 'Select', 'Separator']);
const DAW_COMPACT = new Set(['DawCompactCheckbox', 'DawCompactInput', 'DawCompactSelect', 'DawCompactTextarea']);
const NATIVE_CONTROLS = new Set(['button', 'input', 'select', 'textarea']);
const CONTROL_MAPPING: Record<string, string> = {
    button: 'Button',
    input: 'Input',
    select: 'Select',
    textarea: 'Textarea',
};

const COMPLEX_GRID = /grid-cols-\[/;
const RESPONSIVE_CLASS = /(?:sm|md|lg|xl|2xl):/;

/** Hardware drawing shells. Token / knob / fader restyle is out of scope. */
const HARDWARE_DRAWING_FILES = new Set([
    'src/components/daw/Fader.tsx',
    'src/components/daw/RotaryKnob.tsx',
    'src/components/daw/MechanicalSwitch.tsx',
]);

function posixRelative(root: string, absolute: string): string {
    return relative(root, absolute).split(sep).join('/');
}

function isExcludedPath(relativePath: string): boolean {
    return (
        relativePath.includes('/__tests__/') ||
        relativePath.includes('/__snapshots__/') ||
        relativePath.includes('/generated/') ||
        relativePath.includes('.agents/worktrees/') ||
        relativePath.includes('/node_modules/') ||
        /\.(spec|test)\.[tj]sx?$/.test(relativePath)
    );
}

function collectTsxFiles(absoluteDirectory: string, root: string, found: string[]): void {
    let entries;
    try {
        entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const absoluteEntry = join(absoluteDirectory, entry.name);
        const relativePath = posixRelative(root, absoluteEntry);
        if (entry.isDirectory()) {
            if (
                entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === '.git' ||
                isExcludedPath(`${relativePath}/`)
            ) {
                continue;
            }
            collectTsxFiles(absoluteEntry, root, found);
            continue;
        }
        if (!entry.isFile() || !relativePath.endsWith('.tsx') || isExcludedPath(relativePath)) {
            continue;
        }
        found.push(absoluteEntry);
    }
}

function tagName(node: ts.JsxTagNameExpression): string | undefined {
    if (ts.isIdentifier(node)) {
        return node.text;
    }
    return undefined;
}

function isCnCall(expression: ts.Expression): expression is ts.CallExpression {
    if (!ts.isCallExpression(expression)) {
        return false;
    }
    const callee = expression.expression;
    return ts.isIdentifier(callee) && callee.text === 'cn';
}

function classTokens(classNames: string): string[] {
    return classNames.split(/\s+/).filter((token) => token.length > 0);
}

function isLayoutToken(token: string): boolean {
    return (
        token === 'flex' ||
        token === 'inline-flex' ||
        token === 'flex-col' ||
        token === 'flex-row' ||
        token === 'grid' ||
        token === 'inline-grid' ||
        token.startsWith('grid-cols-') ||
        token.startsWith('space-y-') ||
        token.startsWith('space-x-')
    );
}

function hasLayoutClass(classNames: string): boolean {
    return classTokens(classNames).some(isLayoutToken);
}

function readStaticText(expression: ts.Expression): { text: string; dynamic: boolean } {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return { text: expression.text, dynamic: false };
    }
    if (ts.isArrayLiteralExpression(expression)) {
        const chunks: string[] = [];
        let dynamic = false;
        for (const element of expression.elements) {
            const part = readStaticText(element);
            if (part.text !== '') {
                chunks.push(part.text);
            }
            dynamic = dynamic || part.dynamic;
        }
        return { text: chunks.join(' '), dynamic };
    }
    if (ts.isTemplateExpression(expression)) {
        const parts = [expression.head.text];
        for (const span of expression.templateSpans) {
            parts.push(span.literal.text);
        }
        return { text: parts.join('').replaceAll(/\s+/g, ' ').trim(), dynamic: true };
    }
    if (isCnCall(expression)) {
        const chunks: string[] = [];
        let dynamic = false;
        for (const argument of expression.arguments) {
            const part = readStaticText(argument);
            if (part.text !== '') {
                chunks.push(part.text);
            }
            dynamic = dynamic || part.dynamic;
        }
        return { text: chunks.join(' '), dynamic };
    }
    if (ts.isConditionalExpression(expression)) {
        const whenTrue = readStaticText(expression.whenTrue);
        const whenFalse = readStaticText(expression.whenFalse);
        return {
            text: `${whenTrue.text} ${whenFalse.text}`.replaceAll(/\s+/g, ' ').trim(),
            dynamic: true,
        };
    }
    return { text: '', dynamic: true };
}

function staticTypeAttribute(element: ts.JsxOpeningLikeElement): string | undefined {
    for (const attribute of element.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name) || attribute.name.text !== 'type') {
            continue;
        }
        const initializer = attribute.initializer;
        if (initializer === undefined) {
            return undefined;
        }
        if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
            return initializer.text;
        }
        if (
            ts.isJsxExpression(initializer) &&
            initializer.expression !== undefined &&
            (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))
        ) {
            return initializer.expression.text;
        }
        return undefined;
    }
    return undefined;
}

function classNameAttribute(element: ts.JsxOpeningLikeElement): ts.Expression | undefined {
    for (const attribute of element.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name) || attribute.name.text !== 'className') {
            continue;
        }
        const initializer = attribute.initializer;
        if (initializer === undefined) {
            return undefined;
        }
        if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
            return initializer;
        }
        if (ts.isJsxExpression(initializer) && initializer.expression !== undefined) {
            return initializer.expression;
        }
    }
    return undefined;
}

function layoutMapping(classNames: string): 'Stack' | 'Row' | 'Grid' {
    const tokens = classTokens(classNames);
    if (tokens.some((token) => token === 'grid' || token === 'inline-grid' || token.startsWith('grid-cols-'))) {
        return 'Grid';
    }
    if (tokens.some((token) => token === 'flex-col' || token.startsWith('space-y-'))) {
        return 'Stack';
    }
    return 'Row';
}

const NON_TEXT_INPUT_TYPES = new Set([
    'button',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
]);

const NUMERIC_GRID_COLS = /(?:^|\s)grid-cols-[1-6](?:\s|$)/;

function isDawChromeDefinition(relativePath: string): boolean {
    return relativePath.startsWith('src/components/daw/');
}

function nativeControlDisposition(
    relativePath: string,
    tag: string,
    inputType: string | undefined,
    classNames: string
): UiRestatementDisposition {
    if (relativePath.startsWith('src/components/ui/') || isDawChromeDefinition(relativePath)) {
        return 'semantic-wrapper';
    }
    if (relativePath.includes('/visualizers/')) {
        return 'renderer';
    }
    if (tag === 'input' && inputType !== undefined && NON_TEXT_INPUT_TYPES.has(inputType)) {
        return 'one-off';
    }
    if (
        (tag === 'input' || tag === 'select' || tag === 'textarea') &&
        classNames.includes('bg-transparent') &&
        !/(?:^|\s)h-(?:5|6|7|8|10)(?:\s|$)/.test(classNames)
    ) {
        return 'one-off';
    }
    return 'eligible';
}

function layoutDisposition(relativePath: string, classNames: string, dynamic: boolean): UiRestatementDisposition {
    if (relativePath.includes('/visualizers/')) {
        return 'renderer';
    }
    if (HARDWARE_DRAWING_FILES.has(relativePath)) {
        return 'one-off';
    }
    if (relativePath.startsWith('src/components/layout/')) {
        return 'semantic-wrapper';
    }
    if (COMPLEX_GRID.test(classNames)) {
        return 'complex-grid';
    }
    if (layoutMapping(classNames) === 'Grid' && !NUMERIC_GRID_COLS.test(classNames)) {
        return 'one-off';
    }
    if (dynamic || RESPONSIVE_CLASS.test(classNames)) {
        return 'responsive-or-dynamic';
    }
    return 'eligible';
}

type ClassifiedRow = Omit<UiRestatementRow, 'id'>;

function classifiedRow(
    relativePath: string,
    line: number,
    fingerprint: string,
    kind: UiRestatementKind,
    mapping: string,
    disposition: UiRestatementDisposition
): ClassifiedRow {
    return { file: relativePath, line, fingerprint, kind, mapping, disposition };
}

function withStableId(row: ClassifiedRow, occurrence: number): UiRestatementRow {
    const id = `ui-${createHash('sha256')
        .update(`${row.file}:${row.fingerprint}:${String(occurrence)}`)
        .digest('hex')
        .slice(0, 16)}`;
    return { id, ...row };
}

function classifyElement(
    relativePath: string,
    tag: string,
    classNames: string,
    dynamic: boolean,
    line: number,
    inputType: string | undefined
): ClassifiedRow | undefined {
    if (LAYOUT_PRIMITIVES.has(tag)) {
        return classifiedRow(relativePath, line, `${tag}\t`, 'layout', tag, 'already-migrated');
    }
    if (DAW_CHROME.has(tag)) {
        return classifiedRow(relativePath, line, `${tag}\t`, 'daw-chrome', tag, 'semantic-wrapper');
    }
    if (UI_CONTROLS.has(tag) || DAW_COMPACT.has(tag)) {
        return classifiedRow(relativePath, line, `${tag}\t`, 'generic-control', tag, 'already-migrated');
    }
    if (NATIVE_CONTROLS.has(tag)) {
        const mapping = CONTROL_MAPPING[tag];
        if (mapping === undefined) {
            return undefined;
        }
        return classifiedRow(
            relativePath,
            line,
            `${tag}\t`,
            'generic-control',
            mapping,
            nativeControlDisposition(relativePath, tag, inputType, classNames)
        );
    }
    if (!LAYOUT_TAGS.has(tag) || !hasLayoutClass(classNames)) {
        return undefined;
    }
    return classifiedRow(
        relativePath,
        line,
        `${tag}\t${classNames}`,
        'layout',
        layoutMapping(classNames),
        layoutDisposition(relativePath, classNames, dynamic)
    );
}

function scanSourceFile(relativePath: string, contents: string): UiRestatementRow[] {
    const sourceFile = ts.createSourceFile(relativePath, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const classified: ClassifiedRow[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const tag = tagName(node.tagName);
            if (tag !== undefined) {
                const attribute = classNameAttribute(node);
                const parsed = attribute === undefined ? { text: '', dynamic: false } : readStaticText(attribute);
                const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
                const row = classifyElement(
                    relativePath,
                    tag,
                    parsed.text.trim(),
                    parsed.dynamic,
                    line,
                    tag === 'input' ? staticTypeAttribute(node) : undefined
                );
                if (row !== undefined) {
                    classified.push(row);
                }
            }
        }
        node.forEachChild(visit);
    };
    visit(sourceFile);
    const occurrences = new Map<string, number>();
    return classified.map((row) => {
        const occurrence = occurrences.get(row.fingerprint) ?? 0;
        occurrences.set(row.fingerprint, occurrence + 1);
        return withStableId(row, occurrence);
    });
}

export function scanUiRestatements(root: string): UiRestatementRow[] {
    const files: string[] = [];
    const src = join(root, 'src');
    collectTsxFiles(existsSync(src) ? src : root, root, files);
    const rows: UiRestatementRow[] = [];
    for (const absolute of files.sort()) {
        const relativePath = posixRelative(root, absolute);
        rows.push(...scanSourceFile(relativePath, readFileSync(absolute, 'utf8')));
    }
    return rows;
}

export function canonicalizeCensus(rows: UiRestatementRow[]): string {
    const ordered = [...rows].sort((left, right) => left.id.localeCompare(right.id));
    return `${JSON.stringify(ordered, [...ROW_KEYS], 2)}\n`;
}

export function diffCensus(
    actual: UiRestatementRow[],
    ledger: UiRestatementRow[]
): { missing: UiRestatementRow[]; stale: UiRestatementRow[] } {
    const actualById = new Map(actual.map((row) => [row.id, row]));
    const ledgerById = new Map(ledger.map((row) => [row.id, row]));
    const missing = actual.filter((row) => !ledgerById.has(row.id));
    const stale = ledger.filter((row) => !actualById.has(row.id));
    return { missing, stale };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKind(value: unknown): value is UiRestatementKind {
    return typeof value === 'string' && KINDS.some((kind) => kind === value);
}

function isDisposition(value: unknown): value is UiRestatementDisposition {
    return typeof value === 'string' && DISPOSITIONS.some((disposition) => disposition === value);
}

function parseCensusRow(row: unknown): UiRestatementRow {
    if (!isObjectRecord(row)) {
        throw new TypeError('census ledger row is not an object');
    }
    const id = row.id;
    const file = row.file;
    const line = row.line;
    const fingerprint = row.fingerprint;
    const kind = row.kind;
    const mapping = row.mapping;
    const disposition = row.disposition;
    if (typeof id !== 'string' || typeof file !== 'string' || typeof fingerprint !== 'string') {
        throw new TypeError('census ledger row has invalid string fields');
    }
    if (typeof line !== 'number' || !Number.isInteger(line)) {
        throw new TypeError('census ledger row has invalid line');
    }
    if (typeof mapping !== 'string') {
        throw new TypeError('census ledger row has invalid mapping');
    }
    if (!isKind(kind)) {
        throw new TypeError('census ledger row has invalid kind');
    }
    if (!isDisposition(disposition)) {
        throw new TypeError('census ledger row has invalid disposition');
    }
    return { id, file, line, fingerprint, kind, mapping, disposition };
}

export function parseCensusLedger(text: string): UiRestatementRow[] {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
        throw new TypeError('census ledger is not an array');
    }
    return parsed.map(parseCensusRow);
}

function fail(message: string): never {
    throw new Error(message);
}

function defaultLedgerPath(root: string): string {
    return join(root, 'scripts', 'ui-restatement-census.json');
}

export function checkUiRestatementCensus(root: string, ledgerPath: string = defaultLedgerPath(root)): string[] {
    const actual = scanUiRestatements(root);
    const ledgerText = readFileSync(ledgerPath, 'utf8');
    const ledger = parseCensusLedger(ledgerText);
    const { missing, stale } = diffCensus(actual, ledger);
    const errors: string[] = [];
    for (const row of missing) {
        errors.push(`missing ledger row ${row.id} ${row.file}:${row.line}`);
    }
    for (const row of stale) {
        errors.push(`stale ledger row ${row.id} ${row.file}:${row.line}`);
    }
    if (errors.length === 0 && canonicalizeCensus(actual) !== ledgerText) {
        errors.push('census ledger is not canonical JSON');
    }
    const eligible = actual.filter((row) => row.disposition === 'eligible');
    if (eligible.length > 0) {
        const preview = eligible
            .slice(0, 8)
            .map((row) => `${row.id} ${row.file}:${String(row.line)}`)
            .join('; ');
        errors.push(`${String(eligible.length)} eligible restatement(s) remain; replace or exclude (e.g. ${preview})`);
    }
    return errors;
}

function main(cwd: string, args: string[]): number {
    const write = args.includes('--write');
    const ledgerPath = defaultLedgerPath(cwd);
    if (write) {
        const actual = scanUiRestatements(cwd);
        writeFileSync(ledgerPath, canonicalizeCensus(actual));
        process.stdout.write(`wrote ${String(actual.length)} rows to ${posixRelative(cwd, ledgerPath)}\n`);
        return 0;
    }
    if (!existsSync(ledgerPath)) {
        fail(`census ledger missing: ${ledgerPath}`);
    }
    const errors = checkUiRestatementCensus(cwd, ledgerPath);
    if (errors.length > 0) {
        process.stderr.write(`${errors.join('\n')}\n`);
        return 1;
    }
    process.stdout.write('ok\n');
    return 0;
}

const invokedPath = process.argv[1] === undefined ? '' : realpathSync(resolve(process.argv[1]));
if (invokedPath === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.cwd(), process.argv.slice(2));
    } catch (error: unknown) {
        process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
        process.exitCode = 1;
    }
}
