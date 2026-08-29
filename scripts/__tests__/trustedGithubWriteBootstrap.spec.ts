import { describe, expect, it } from 'vitest';

import { bareModuleSpecifiers, snapshotImportSpecifiers } from '../trustedGithubWriteBootstrap.ts';

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
