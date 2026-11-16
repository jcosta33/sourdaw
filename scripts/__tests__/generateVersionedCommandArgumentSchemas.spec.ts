import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GENERATOR = resolve('scripts/generateVersionedCommandArgumentSchemas.mjs');
const CONTRACT_PATH = 'src/utils/handlerContract.ts';
const OUTPUT_PATH = 'src/modules/Command/useCases/versionedCommandArgumentKeys.ts';

type Declaration = {
    readonly type: string;
    readonly payload: readonly string[];
};

// Each action reuses the same literal and object shapes, so the numbering of shared definitions
// depends on the order the generator visits actions, members and properties.
const DECLARATIONS: readonly Declaration[] = [
    { type: 'alpha', payload: ["mode: 'x' | 'y' | 'z'", 'flag: boolean | string', 'tag?: number | null'] },
    { type: 'beta', payload: ["mode: 'z' | 'x'", 'items: readonly (string | number)[]', 'tag?: number | null'] },
    { type: 'gamma', payload: ['flag: string | boolean', "mode: 'y' | 'z' | 'x'", 'nested: { b: string; a: number }'] },
];

function renderContract(declarations: readonly Declaration[]): string {
    const members = declarations.map(
        (declaration) => `    | { type: '${declaration.type}'; payload: { ${declaration.payload.join('; ')} } }`
    );
    return ['export type AppAction =', ...members, "    | { type: 'omega' };", ''].join('\n');
}

function reverseEach(declarations: readonly Declaration[]): readonly Declaration[] {
    return declarations
        .map((declaration) => ({ ...declaration, payload: declaration.payload.toReversed() }))
        .toReversed();
}

function permuteUnionMembers(declarations: readonly Declaration[]): readonly Declaration[] {
    return declarations.map((declaration) => ({
        ...declaration,
        payload: declaration.payload.map((property) => {
            const separator = property.indexOf(': ');
            const members = property.slice(separator + 2).split(' | ');
            const isFlatUnion = members.every((member) => /^[\w']+$/.test(member));
            return isFlatUnion ? `${property.slice(0, separator)}: ${members.toReversed().join(' | ')}` : property;
        }),
    }));
}

const roots: string[] = [];

function generateFor(declarations: readonly Declaration[]): string {
    const root = mkdtempSync(join(tmpdir(), 'versioned-command-schemas-'));
    roots.push(root);
    writeFileSync(
        join(root, 'tsconfig.app.json'),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: [CONTRACT_PATH] })
    );
    mkdirSync(join(root, dirname(CONTRACT_PATH)), { recursive: true });
    mkdirSync(join(root, dirname(OUTPUT_PATH)), { recursive: true });
    writeFileSync(join(root, CONTRACT_PATH), renderContract(declarations));
    const run = spawnSync(process.execPath, [GENERATOR], { cwd: root, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    return readFileSync(join(root, OUTPUT_PATH), 'utf8');
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('generateVersionedCommandArgumentSchemas', () => {
    it('generates a validator that names every action of the fixture contract', () => {
        const output = generateFor(DECLARATIONS);

        for (const name of ['alpha', 'beta', 'gamma', 'omega']) {
            expect(output).toContain(`${name}:`);
        }
    });

    it('emits identical output however the contract orders its actions, properties and union members', () => {
        const declared = generateFor(DECLARATIONS);

        expect(generateFor(reverseEach(DECLARATIONS))).toBe(declared);
        expect(generateFor(permuteUnionMembers(DECLARATIONS))).toBe(declared);
        expect(generateFor(permuteUnionMembers(reverseEach(DECLARATIONS)))).toBe(declared);
    });
});
