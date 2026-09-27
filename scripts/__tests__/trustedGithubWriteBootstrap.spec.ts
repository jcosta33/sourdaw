import { describe, expect, it } from 'vitest';

import {
    bareModuleSpecifiers,
    executeTrustedSnapshot,
    forwardTrustedSnapshotSignal,
    snapshotComputedDynamicSpecifiers,
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

    it('collects import.meta.resolve specifiers across quotes, grouping parens, and await', () => {
        expect(snapshotImportSpecifiers("import.meta.resolve('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import.meta.resolve('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('import.meta.resolve("yaml")')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('import.meta.resolve("yaml")')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('import.meta.resolve(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('import.meta.resolve(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("await import.meta.resolve('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("await import.meta.resolve('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("import.meta.resolve(('yaml'))")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import.meta.resolve(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("import.meta.resolve( ('yaml') )")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import.meta.resolve( ('yaml') )")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("import?.meta?.resolve?.('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("import?.meta?.resolve?.('yaml')")).toEqual(['yaml']);
    });

    it('ignores dynamic expressions in import.meta.resolve', () => {
        expect(snapshotImportSpecifiers('import.meta.resolve(`yaml${x}`)')).toEqual([]);
        expect(bareModuleSpecifiers('import.meta.resolve(`yaml${x}`)')).toEqual([]);
    });

    it('ignores method-call import.meta.resolve after property access', () => {
        expect(snapshotImportSpecifiers("obj.import.meta.resolve('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj.import.meta.resolve('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj?.import.meta.resolve('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj?.import.meta.resolve('yaml')")).toEqual([]);
    });

    it('collects require and require.resolve specifiers across quotes, grouping parens, and optional chaining', () => {
        expect(snapshotImportSpecifiers("require('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('require("yaml")')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('require("yaml")')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('require(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('require(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require(('yaml'))")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require( ('yaml') )")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require( ('yaml') )")).toEqual(['yaml']);

        expect(snapshotImportSpecifiers("require.resolve('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require.resolve('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('require.resolve("yaml")')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('require.resolve("yaml")')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('require.resolve(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('require.resolve(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require.resolve(('yaml'))")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require.resolve(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require?.resolve('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require?.resolve('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("require?.resolve?.('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("require?.resolve?.('yaml')")).toEqual(['yaml']);
    });

    it('ignores method-call require after property access', () => {
        expect(snapshotImportSpecifiers("obj.require('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj.require('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj?.require('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj?.require('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj.require.resolve('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj.require.resolve('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj?.require?.resolve('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj?.require?.resolve('yaml')")).toEqual([]);
    });

    it('collects a require load hidden by a dot-ending line comment', () => {
        expect(snapshotImportSpecifiers("// Fall back to the plugin entry.\nrequire('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("// Fall back to the plugin entry.\nrequire('yaml')")).toEqual(['yaml']);
    });

    it('collects a require load spread into an array', () => {
        expect(snapshotImportSpecifiers("[...require('yaml')]")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("[...require('yaml')]")).toEqual(['yaml']);
    });

    it('collects createRequire chained calls across quotes, grouping parens, and optional chaining', () => {
        expect(snapshotImportSpecifiers("createRequire(import.meta.url)('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("createRequire(import.meta.url)('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('createRequire(import.meta.url)("yaml")')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('createRequire(import.meta.url)("yaml")')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers('createRequire(import.meta.url)(`yaml`)')).toEqual(['yaml']);
        expect(bareModuleSpecifiers('createRequire(import.meta.url)(`yaml`)')).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("createRequire(import.meta.url)(('yaml'))")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("createRequire(import.meta.url)(('yaml'))")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("createRequire(import.meta.url)?.('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("createRequire(import.meta.url)?.('yaml')")).toEqual(['yaml']);
    });

    it('ignores dynamic expressions in createRequire chained calls', () => {
        expect(snapshotImportSpecifiers('createRequire(import.meta.url)(`yaml${x}`)')).toEqual([]);
        expect(bareModuleSpecifiers('createRequire(import.meta.url)(`yaml${x}`)')).toEqual([]);
    });

    it('ignores method-call createRequire after property access', () => {
        expect(snapshotImportSpecifiers("obj.createRequire(import.meta.url)('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj.createRequire(import.meta.url)('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("obj?.createRequire(import.meta.url)('yaml')")).toEqual([]);
        expect(bareModuleSpecifiers("obj?.createRequire(import.meta.url)('yaml')")).toEqual([]);
    });

    /**
     * A statement-position regex after a control header's `)` or after `else` is a regex literal, so
     * the apostrophe in `/don't/` cannot open a string that swallows the rest of the file — the shape
     * that hid every later load (#4818). The division cases pin the other half: a `/` after a call's
     * `)` or after a `)` that closes no header still divides, including a private member named after
     * a control keyword, whose `#` makes it a member exactly as `.` does (#4828).
     */
    it('collects an import a statement-position regex used to hide', () => {
        expect(snapshotImportSpecifiers("if (ok) /don't/.test(line);\nimport { parse } from 'yaml';")).toEqual([
            'yaml',
        ]);
        expect(bareModuleSpecifiers("if (ok) /don't/.test(line);\nimport { parse } from 'yaml';")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (url) /^https?:\\/\\//.test(url);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (x) run(); else /don't/.test(line);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("for (;;) /x/.test(line);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("while (ok) /x/.test(line);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("with (o) /x/.test(line);\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (ok) report(x) / 2;\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (ok) { run(); } const v = g(a) / 2;\nrequire('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("if (ok) obj / 2;\nrequire('yaml')")).toEqual(['yaml']);
        expect(
            snapshotImportSpecifiers(
                "class C { #while(n){return n} r(){ return this.#while(1) / require('yaml') / 2 } }"
            )
        ).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("obj.while(1) / require('yaml') / 2;")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("obj?.while(1) / require('yaml') / 2;")).toEqual(['yaml']);
    });

    /**
     * A load reached through a wrapped or bound callee is the same load: `(require)(spec)`,
     * `(0, require)(spec)`, a name bound to `require` or to `createRequire(…)`, and an aliased
     * `createRequire` import (#4818). The boundary cases pin the limits: a parenthesis that continues
     * the enclosing call is an argument list rather than a wrapped callee — `pass(require)('./hidden')`
     * is an ordinary call, and reading it as a wrapped `require` refused it (#4828) — a longer name is
     * not the binding, and a name redeclared in a nested function, class, or parameter list keeps the
     * merge base's reading.
     */
    it('collects a load reached through a wrapped or bound callee', () => {
        expect(snapshotImportSpecifiers("(require)('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("(0, require)('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const load = require;\nload('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const load = createRequire(import.meta.url);\nload('yaml')")).toEqual([
            'yaml',
        ]);
        expect(
            snapshotImportSpecifiers(
                "import { createRequire as makeRequire } from 'node:module';\nmakeRequire(import.meta.url)('yaml')"
            )
        ).toEqual(['node:module', 'yaml']);
        expect(bareModuleSpecifiers("(0, require)('yaml')")).toEqual(['yaml']);
        expect(bareModuleSpecifiers("const load = require;\nload('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const load = require;\ndownload('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("const load = require;\nregistry.load('yaml')")).toEqual([]);
        expect(snapshotImportSpecifiers("const load = require;\nfunction f(load) { load('yaml') }")).toEqual([]);
        expect(snapshotImportSpecifiers("const load = require('yaml');\nload('yaml')")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("pass(require)('./hidden');")).toEqual([]);
        expect(snapshotImportSpecifiers('pass(require)(specifier);')).toEqual([]);
        expect(snapshotImportSpecifiers("this.#m(require)('./hidden');")).toEqual([]);
        expect(
            snapshotImportSpecifiers(
                'function outer() { function load(s) { return s; } return load(1); }\nconst load = require;'
            )
        ).toEqual([]);
        expect(snapshotImportSpecifiers("const load = require;\nclass load {}\nload('yaml');")).toEqual([]);
        expect(
            snapshotImportSpecifiers(
                'const load = require;\nfunction outer(load) { return load(1); }\nload(specifier);'
            )
        ).toEqual([]);
        expect(
            snapshotImportSpecifiers(
                'const load = require;\nfunction outer() { function load(s) { return s; } return load(1); }'
            )
        ).toEqual([]);
        expect(
            snapshotImportSpecifiers("const load = require;\nfunction outer(s) { return s; }\nload('yaml');")
        ).toEqual(['yaml']);
    });

    /**
     * A name declared again in a nested function, class, or parameter list is that declaration, not the
     * loader bound outside it, so the binding is dropped and the nested call keeps the merge base's
     * reading (#4828). The bare bound name still resolves, which is what separates the two.
     */
    it('drops a loader binding redeclared in a nested scope', () => {
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nload(specifier);')).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'function outer() { function load(s) { return s; } return load(1); }\nconst load = require;'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers(
                'const load = require;\nfunction outer() { class load {}\nreturn new load(); }'
            )
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('const load = require;\nfunction outer(load) { return load(1); }')
        ).toEqual([]);
    });

    /**
     * A file that declares `require` itself — as a parameter, a `const`/`let`/`var` name, a
     * destructuring target, or a catch parameter — forms no binding of any name to the loader, so the
     * file keeps the merge base's reading. The four shapes load nothing, and reading them as loads
     * refused sources that reach no module (#4828). The declaration is the file's, not the scope's: the
     * file's own shadowing wins. It stops at the binding pass, which is what keeps the callee cases
     * below loads.
     */
    it('drops the loader binding when the file declares require itself', () => {
        expect(snapshotComputedDynamicSpecifiers('function f(require) { const load = require; load(spec); }')).toEqual(
            []
        );
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\nconst load = require;\nload(spec);')).toEqual(
            []
        );
        expect(
            snapshotComputedDynamicSpecifiers('const { require } = box;\nconst load = require;\nload(spec);')
        ).toEqual([]);
        expect(
            snapshotComputedDynamicSpecifiers('try {} catch (require) { const load = require; load(spec); }')
        ).toEqual([]);
        expect(snapshotImportSpecifiers("const require = fake;\nconst load = require;\nload('yaml');")).toEqual([]);
        // The binding a file that does not declare `require` still makes, which is the rule's other half.
        expect(snapshotComputedDynamicSpecifiers('const load = require;\nload(spec);')).toEqual(['require(...)']);
    });

    /**
     * The declaration above stops the binding pass alone. A `require(…)` call is the loader whatever
     * else the file declares, as the merge base read it, so an unrelated declaration never hides a real
     * load: a literal specifier is collected, and a computed one is refused by `require(...)`. Only the
     * binding through the name is dropped, which is what the four stand-down shapes above observe.
     */
    it('keeps a require callee a load when the file declares the name elsewhere', () => {
        expect(snapshotImportSpecifiers("function f(require) {}\nconst y = require('yaml');")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("function f({ require }) {}\nconst y = require('yaml');")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("try {} catch (require) {}\nconst y = require('yaml');")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const require = fake;\nconst y = require('yaml');")).toEqual(['yaml']);
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\nrequire(spec);')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\nrequire.resolve(spec);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('function f(require) { require(spec); }')).toEqual(['require(...)']);
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\n(0, require)(spec);')).toEqual([
            'require(...)',
        ]);
        expect(snapshotComputedDynamicSpecifiers('const require = fake;\n(require)(spec);')).toEqual(['require(...)']);
    });

    /**
     * A parameter list inside a type declares nothing at runtime, so it is no declaration of the name
     * `require` and must not stand the binding pass down: `const load = require` still binds the loader
     * and `load(spec)` is a computed load. Only the `=` of a `type` alias and the `:` of a declared
     * name's annotation prove the type position; every other list keeps the stand-down above (#4828).
     */
    it('reads a parameter list inside a type as no declaration of require', () => {
        expect(
            snapshotComputedDynamicSpecifiers('type L = (require: string) => void;\nconst load = require;\nload(spec);')
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'type L<T> = (require: string) => void;\nconst load = require;\nload(spec);'
            )
        ).toEqual(['require(...)']);
        expect(
            snapshotComputedDynamicSpecifiers(
                'let loader: (require: string) => void;\nconst load = require;\nload(spec);'
            )
        ).toEqual(['require(...)']);
        expect(snapshotImportSpecifiers("type L = (require: string) => void;\nconst y = require('yaml');")).toEqual([
            'yaml',
        ]);
    });

    /**
     * Only a value `import { createRequire as <name> } from '…'` binds a local name, so only it makes a
     * call through that name a load. `export { … } from` re-exports without binding anything,
     * `import type { … }` imports a type, and an inline `type` specifier names a type, so
     * `cr(import.meta.url)('./hidden')` behind any of them reaches no local loader and the file reaches
     * `node:module` alone. Reading the alias out of any `{ … } from` clause collected `./hidden`, which
     * the merge base never did (#4828).
     */
    it.each([
        {
            label: 'an export clause re-exporting createRequire',
            source: "export { createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');",
        },
        {
            label: 'an export type clause re-exporting createRequire',
            source: "export type { createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');",
        },
        {
            label: 'a type-only import of createRequire',
            source: "import type { createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');",
        },
        {
            label: 'an inline type specifier of createRequire',
            source: "import { type createRequire as cr } from 'node:module';\ncr(import.meta.url)('./hidden');",
        },
    ])('binds no local loader through $label', ({ source }) => {
        expect(snapshotImportSpecifiers(source)).toEqual(['node:module']);
        expect(snapshotComputedDynamicSpecifiers(source)).toEqual([]);
    });

    /**
     * A type literal's `}` is not an operand-position object literal's `}`: treating it as one
     * mislexed the statement-position regex after it and let its apostrophe swallow the file (#4828).
     * Only the argument, array, sequence, `return`, arrow, and declaration-assignment positions keep
     * the division reading, so a `const` initializer's braces still divide while every type shape —
     * a type alias, an intersection or union branch, an annotation — keeps the merge base's reading.
     */
    it('keeps the merge base reading at a type literal close', () => {
        expect(snapshotImportSpecifiers("type T = { a: number }\n/don't/.test(line);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
        expect(snapshotImportSpecifiers("type T = A & { b: number }\n/don't/.test(line);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
        expect(snapshotImportSpecifiers("type T = A | { b: number }\n/don't/.test(line);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
        expect(snapshotImportSpecifiers("let x: { a: number }\n/don't/.test(line);\nrequire('yaml');")).toEqual([
            'yaml',
        ]);
        // The division reading is what the `const` initializer proves: the literal specifier after the
        // divided `/` is a real load and is collected, while the computed form is refused above.
        expect(snapshotImportSpecifiers("const r = {} / import('yaml') / 2;")).toEqual(['yaml']);
        expect(snapshotImportSpecifiers("const r = {} / require('yaml') / 2;")).toEqual(['yaml']);
    });

    /**
     * The close-brace walk must answer each `/` once. `canStartRegexLiteral` re-enters itself through
     * `lineCommentOpenBefore`, because skipping a comment, string, or regex needs the same question
     * answered at an earlier index, so the cost of a line of repeated `} /` delimiters grew by about
     * nine times every four repetitions before the answers were memoised (#4828). The bound is loose:
     * the repaired scan takes under two milliseconds at this length, while the walk without the memo
     * took 9.7 s at 32 repetitions and 271 s here.
     */
    it('scans a line of repeated close-brace divisions in bounded time', () => {
        const source = `${'} / '.repeat(40)};`;
        const startedAt = performance.now();
        const shapes = snapshotComputedDynamicSpecifiers(source);
        const elapsedMs = performance.now() - startedAt;
        expect(shapes).toEqual([]);
        expect(elapsedMs).toBeLessThan(2_000);
    });
});

describe('trusted GitHub write snapshot launcher', () => {
    it.each([
        ['deliver', true],
        ['issue:reconcile', false],
        ['lane:publish', false],
        ['review:publish', true],
        ['review:publish:recover', true],
        ['review:resolve', false],
        ['review:shadow-status', false],
        ['ruleset:harden', false],
    ] as const)('uses a detached POSIX process group only for %s: %s', (command, expected) => {
        expect(trustedSnapshotRunsDetached(command, 'linux')).toBe(expected);
        expect(trustedSnapshotRunsDetached(command, 'darwin')).toBe(expected);
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
                                '  const keepAlive = setInterval(() => undefined, 10000);',
                                `  setTimeout(() => process.kill(process.ppid, '${signal}'), 100);`,
                                '  await new Promise(() => undefined);',
                                '  clearInterval(keepAlive);',
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
