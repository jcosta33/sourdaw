import { describe, expect, it } from 'vitest';

import {
    bareModuleSpecifiers,
    executeTrustedSnapshot,
    forwardTrustedSnapshotSignal,
    snapshotImportSpecifiers,
    trustedSnapshotRunsDetached,
} from '../trustedGithubWriteBootstrap.ts';

describe('snapshotImportSpecifiers', () => {
    it('ignores from, import, and dynamic-import shapes inside comments', () => {
        const source = `
            // we used to read it from 'yaml'
            /* also import 'yaml' and import('yaml') once */
            export const ok = 1;
        `;

        expect(snapshotImportSpecifiers(source)).toEqual([]);
        expect(bareModuleSpecifiers(source)).toEqual([]);
    });

    it('ignores import-shaped prose inside a string literal', () => {
        const source = `
            const note = "import 'yaml' first";
            export const ok = 1;
        `;

        expect(snapshotImportSpecifiers(source)).toEqual([]);
        expect(bareModuleSpecifiers(source)).toEqual([]);
    });

    it('collects real from, side-effect, and dynamic import specifiers', () => {
        const source = `
            import { parse } from 'yaml';
            import 'yaml';
            const load = await import('yaml');
        `;

        expect(snapshotImportSpecifiers(source)).toEqual(['yaml']);
        expect(bareModuleSpecifiers(source)).toEqual(['yaml']);
    });

    it('ignores import-shaped prose inside a template literal', () => {
        const source = `
            const note = \`from 'yaml' and import 'yaml' and import('yaml')\`;
            export const ok = 1;
        `;

        expect(snapshotImportSpecifiers(source)).toEqual([]);
        expect(bareModuleSpecifiers(source)).toEqual([]);
    });

    it('ignores from, import, and dynamic-import shapes inside regex literals', () => {
        expect(snapshotImportSpecifiers(`/from 'yaml'/`)).toEqual([]);
        expect(snapshotImportSpecifiers(`/import 'yaml'/`)).toEqual([]);
        expect(snapshotImportSpecifiers(`/import('yaml')/`)).toEqual([]);
        expect(bareModuleSpecifiers(`/from 'yaml'/`)).toEqual([]);
    });

    it('does not treat /* inside a regex as a block comment that swallows a later import', () => {
        const source = "const x = /a/*/b/;\nimport { parse } from 'yaml'";

        expect(snapshotImportSpecifiers(source)).toEqual(['yaml']);
        expect(bareModuleSpecifiers(source)).toEqual(['yaml']);
    });

    it('collects dynamic imports inside template interpolations', () => {
        const source = "const x = `h ${await import('yaml')}`;";

        expect(snapshotImportSpecifiers(source)).toEqual(['yaml']);
        expect(bareModuleSpecifiers(source)).toEqual(['yaml']);
    });

    it('ends // comments at CR so a following import is still collected', () => {
        const source = "// comment\rimport fs from 'fs';\n";

        expect(snapshotImportSpecifiers(source)).toEqual(['fs']);
        expect(bareModuleSpecifiers(source)).toEqual(['fs']);
    });

    it('ends // comments at LS or PS so a following import is still collected', () => {
        expect(snapshotImportSpecifiers("// comment\u2028import fs from 'fs';\n")).toEqual(['fs']);
        expect(snapshotImportSpecifiers("// comment\u2029import fs from 'fs';\n")).toEqual(['fs']);
        expect(bareModuleSpecifiers("// comment\u2028import fs from 'fs';\n")).toEqual(['fs']);
        expect(bareModuleSpecifiers("// comment\u2029import fs from 'fs';\n")).toEqual(['fs']);
    });

    it('collects imports separated by LS or PS whitespace', () => {
        expect(snapshotImportSpecifiers("import\u2028'yaml'")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("from\u2029'yaml'")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("import\u2028('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import\u2028'yaml'")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("from\u2029'yaml'")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import\u2028('yaml')")).toEqual(['yaml']);
    });

    it('collects static template literal dynamic import specifiers', () => {
        expect(snapshotImportSpecifiers('await import(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('await import(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('await import(`yaml${x}`)')).toEqual([]);
        expect(bareModuleSpecifiers('await import(`yaml${x}`)')).toEqual([]);
    });

    it('unwraps grouping parentheses around dynamic import specifiers', () => {
        expect(snapshotImportSpecifiers("await import(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("await import( ('yaml') )")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("await import(/*c*/('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('await import((`yaml`))')).toEqual(['yaml']);
        expect(bareModuleSpecifiers("await import(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('await import((`yaml${x}`))')).toEqual([]);
        expect(bareModuleSpecifiers('await import((`yaml${x}`))')).toEqual([]);
    });

    it('treats a slash after a block comment as a regex when the preceding token allows it', () => {
        expect(snapshotImportSpecifiers("const x = /*c*/ /from 'yaml'/")).toEqual([]);
        expect(bareModuleSpecifiers("const x = /*c*/ /from 'yaml'/")).toEqual([]);
        expect(snapshotImportSpecifiers("const x = /from 'yaml'/")).toEqual([]);
        expect(bareModuleSpecifiers("const x = /from 'yaml'/")).toEqual([]);
    });

    it('does not collect method-call import() after . or ?.', () => {
        expect(snapshotImportSpecifiers("registry.import('yaml');")).toEqual([]);
        expect(snapshotImportSpecifiers("registry?.import('yaml');")).toEqual([]);
        expect(bareModuleSpecifiers("registry.import('yaml');")).toEqual([]);
        expect(snapshotImportSpecifiers("await import('yaml');")).toEqual(['yaml']);
    });

    it('does not treat relative or node: specifiers as bare', () => {
        const source = `
            import { join } from 'node:path';
            import { helper } from './foo.ts';
        `;

        expect(snapshotImportSpecifiers(source).sort()).toEqual(['./foo.ts', 'node:path']);
        expect(bareModuleSpecifiers(source)).toEqual([]);
    });
});

describe('trusted GitHub write snapshot launcher', () => {
    it.each([
        ['deliver', false],
        ['issue:reconcile', false],
        ['lane:publish', false],
        ['review:publish', true],
        ['review:publish:recover', true],
        ['review:resolve', false],
        ['review:resolve:recover', false],
    ] as const)('uses a detached POSIX process group only for %s: %s', (command, expected) => {
        expect(trustedSnapshotRunsDetached(command, 'linux')).toBe(expected);
        expect(trustedSnapshotRunsDetached(command, 'win32')).toBe(false);
    });

    it('forwards cancellation to the exact detached POSIX child group', () => {
        const forwarded: Array<{ target: number; signal: NodeJS.Signals }> = [];

        forwardTrustedSnapshotSignal(42, true, 'linux', 'SIGTERM', (target, signal) => {
            forwarded.push({ target, signal });
        });

        expect(forwarded).toEqual([{ target: -42, signal: 'SIGTERM' }]);
    });

    it('forwards non-detached and Windows cancellation to the child PID', () => {
        const forwarded: Array<{ target: number; signal: NodeJS.Signals }> = [];
        const send = (target: number, signal: NodeJS.Signals) => forwarded.push({ target, signal });

        forwardTrustedSnapshotSignal(42, false, 'linux', 'SIGINT', send);
        forwardTrustedSnapshotSignal(42, true, 'win32', 'SIGHUP', send);

        expect(forwarded).toEqual([
            { target: 42, signal: 'SIGINT' },
            { target: 42, signal: 'SIGHUP' },
        ]);
    });

    it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
        'forwards %s cancellation to the detached snapshot child group and waits for it to terminate',
        async (signal) => {
            await expect(
                executeTrustedSnapshot('review:publish', [], {
                    commit: 'test-snapshot',
                    sources: new Map([
                        [
                            'scripts/publishReview.ts',
                            [
                                'export async function runPublishReviewCli() {',
                                `  setTimeout(() => process.kill(process.ppid, '${signal}'), 100);`,
                                '  await new Promise(() => undefined);',
                                '  return 0;',
                                '}',
                            ].join('\n'),
                        ],
                    ]),
                })
            ).rejects.toThrow(`trusted snapshot terminated by ${signal}`);
        }
    );
});
