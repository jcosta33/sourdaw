import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `tests/e2e/e2eUtils.ts` declares that every spec waiting on the launch overlay
 * itself owes `LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS`. Playwright owns
 * `tests/e2e/`, so Vitest collects this census from `scripts/__tests__/` and
 * reads the specs as text.
 */
const repositoryRoot = resolve(import.meta.dirname, '../..');
const e2eDirectory = join(repositoryRoot, 'tests/e2e');
const BOUND_NAME = 'LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS';

const overlayLabelPattern = /(?:'|")Sourdaw — start a project(?:'|")|\bLAUNCH_SCREEN_NAME\b/g;
const aliasDeclarationPattern = /\b(?:const|let)\s+(\w+)\s*=\s*([^;]*);/g;
const waitCallPattern = /\.(?:toBeVisible|waitFor)\(/;
const timeoutPattern = /\btimeout\s*:\s*([^,}\s)]+)/;
const firstPaintArgumentPattern = /\bfirstPaintTimeoutMs\s*:\s*(\d[\d_]*)/g;

type OverlayWait = { line: number; timeout: string | undefined };
type FirstPaintArgument = { line: number; milliseconds: number };

function lineAt(text: string, index: number): number {
    return text.slice(0, index).split('\n').length;
}

function matchesOf(text: string, pattern: RegExp): RegExpExecArray[] {
    return Array.from(text.matchAll(pattern));
}

function aliasesOfOverlay(text: string): string[] {
    return matchesOf(text, aliasDeclarationPattern)
        .filter((declaration) => new RegExp(overlayLabelPattern.source).test(declaration[2] ?? ''))
        .map((declaration) => declaration[1] ?? '');
}

/**
 * Each overlay mention (the label, `LAUNCH_SCREEN_NAME`, or a variable holding
 * that locator) opens a window that runs to the statement's `;`. A visibility
 * or `waitFor` call in the window is a wait on the overlay; its `timeout`
 * option, if any, is the bound the wait chose.
 */
function findOverlayWaits(text: string): OverlayWait[] {
    const mentions = [
        ...matchesOf(text, overlayLabelPattern).map((match) => match.index),
        ...aliasesOfOverlay(text).flatMap((alias) =>
            matchesOf(text, new RegExp(`\\b${alias}\\b`, 'g')).map((match) => match.index)
        ),
    ];
    const waitsByStatementEnd = new Map<number, OverlayWait>();
    for (const start of mentions) {
        const statementEnd = text.indexOf(';', start);
        const window = text.slice(start, statementEnd === -1 ? text.length : statementEnd);
        const wait = waitCallPattern.exec(window);
        if (wait === null) {
            continue;
        }
        const timeout = timeoutPattern.exec(window.slice(wait.index))?.[1];
        waitsByStatementEnd.set(statementEnd, { line: lineAt(text, start), timeout });
    }
    return [...waitsByStatementEnd.values()].sort((first, second) => first.line - second.line);
}

function findFirstPaintArguments(text: string): FirstPaintArgument[] {
    return matchesOf(text, firstPaintArgumentPattern).map((match) => ({
        line: lineAt(text, match.index),
        milliseconds: Number((match[1] ?? '').replaceAll('_', '')),
    }));
}

function readBoundMilliseconds(): number {
    const declaration = new RegExp(`export const ${BOUND_NAME} = ([\\d_]+);`).exec(
        readFileSync(join(e2eDirectory, 'e2eUtils.ts'), 'utf8')
    );
    expect(declaration, `${BOUND_NAME} declaration in e2eUtils.ts`).not.toBeNull();
    return Number((declaration?.[1] ?? '').replaceAll('_', ''));
}

function listSpecs(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === '__tests__' ? [] : listSpecs(path);
        }
        return entry.name.endsWith('.spec.ts') ? [path] : [];
    });
}

function scanSpecs() {
    return listSpecs(e2eDirectory).map((path) => {
        const text = readFileSync(path, 'utf8');
        return {
            file: relative(repositoryRoot, path),
            waits: findOverlayWaits(text),
            firstPaintArguments: findFirstPaintArguments(text),
        };
    });
}

describe('launch overlay first-paint bound', () => {
    const scanned = scanSpecs();

    it('finds the overlay waits and launch arguments the census exists to hold', () => {
        const filesWithWaits = scanned.filter((entry) => entry.waits.length > 0).map((entry) => entry.file);
        const filesWithBoundedWaits = scanned
            .filter((entry) => entry.waits.some((wait) => wait.timeout === BOUND_NAME))
            .map((entry) => entry.file);
        const filesWithLaunchArguments = scanned
            .filter((entry) => entry.firstPaintArguments.length > 0)
            .map((entry) => entry.file);

        expect(filesWithWaits).toEqual(
            expect.arrayContaining([
                'tests/e2e/launchFlows.spec.ts',
                'tests/e2e/promptBarCancelRecentTestId.spec.ts',
                'tests/e2e/smoke.spec.ts',
                'tests/e2e/statusBarResponsive.spec.ts',
            ])
        );
        expect(filesWithBoundedWaits).toEqual(
            expect.arrayContaining([
                'tests/e2e/exportAudioEvidence.spec.ts',
                'tests/e2e/promptBarCancelRecentTestId.spec.ts',
                'tests/e2e/smoke.spec.ts',
                'tests/e2e/statusBarResponsive.spec.ts',
            ])
        );
        expect(filesWithLaunchArguments).toEqual(
            expect.arrayContaining(['tests/e2e/browserAiAdmittedPresentation.spec.ts', 'tests/e2e/smoke.spec.ts'])
        );
    });

    it('gives every explicit overlay wait the shared first-paint bound', () => {
        const offenders = scanned.flatMap((entry) =>
            entry.waits
                .filter((wait) => wait.timeout !== undefined && wait.timeout !== BOUND_NAME)
                .map((wait) => `${entry.file}:${wait.line} timeout: ${wait.timeout}`)
        );

        expect(offenders).toEqual([]);
    });

    it('never passes launch_new_project a first-paint bound below the shared one', () => {
        const bound = readBoundMilliseconds();
        const offenders = scanned.flatMap((entry) =>
            entry.firstPaintArguments
                .filter((argument) => argument.milliseconds < bound)
                .map((argument) => `${entry.file}:${argument.line} firstPaintTimeoutMs: ${argument.milliseconds}`)
        );

        expect(offenders).toEqual([]);
    });

    it('reads waits through a variable and across lines, and ignores unrelated timeouts', () => {
        const source = [
            "const screen = page.getByLabel('Sourdaw — start a project');",
            'await expect(screen).toBeVisible({',
            '    timeout: 15_000,',
            '});',
            'await page.getByLabel(LAUNCH_SCREEN_NAME).waitFor({ state: "visible" });',
            "await page.getByRole('button').click({ timeout: 5000 });",
        ].join('\n');

        expect(findOverlayWaits(source)).toEqual([
            { line: 2, timeout: '15_000' },
            { line: 5, timeout: undefined },
        ]);
    });
});
