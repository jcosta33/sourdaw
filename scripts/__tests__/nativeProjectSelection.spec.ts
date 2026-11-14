// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import * as parser from '@typescript-eslint/parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPreparedNativeTypeScriptPath } from '../nativeTypeScript/compiler.mjs';

let root: string;
const source = 'export const result: string | undefined = undefined;';

function put(name: string, contents: string): string {
    const filename = join(root, name);
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, contents);
    return filename;
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sourdaw-native-project-selection-'));
    put('src/main.ts', source);
    put('src/excluded/no.ts', source);
    for (const [name, strict] of [
        ['a', false],
        ['b', true],
    ] as const) {
        put(
            `configs/${name}/tsconfig.json`,
            JSON.stringify({
                compilerOptions: { strict, noEmit: true, target: 'ESNext', types: [] },
                include: ['../../src/**/*.ts'],
                exclude: ['../../src/excluded/**'],
            })
        );
    }
    put(
        'node_modules/shadow/tsconfig.json',
        JSON.stringify({
            compilerOptions: {
                strict: false,
                noEmit: true,
                target: 'ESNext',
                types: [],
            },
            include: ['../../src/**/*.ts'],
        })
    );
});

afterEach(() => {
    parser.clearCaches();
    rmSync(root, { recursive: true, force: true });
});

const configurations = [
    {
        name: 'explicit path',
        project: 'configs/b/tsconfig.json',
        selected: 'configs/b/tsconfig.json',
        type: 'string | undefined',
    },
    {
        name: 'globstar',
        project: 'configs/**/tsconfig.json',
        selected: 'configs/a/tsconfig.json',
        type: 'string',
    },
    {
        name: 'braces',
        project: 'configs/{a,b}/tsconfig.json',
        selected: 'configs/a/tsconfig.json',
        type: 'string',
    },
    {
        name: 'negated extglob',
        project: 'configs/!(a)/tsconfig.json',
        selected: 'configs/b/tsconfig.json',
        type: 'string | undefined',
    },
    {
        name: 'independent negated pattern',
        project: ['configs/{a,b}/tsconfig.json', '!configs/a/tsconfig.json'],
        selected: 'configs/a/tsconfig.json',
        type: 'string',
    },
    {
        name: 'explicit paths precede glob matches',
        project: ['configs/a/*.json', 'configs/b/tsconfig.json'],
        selected: 'configs/b/tsconfig.json',
        type: 'string | undefined',
    },
    {
        name: 'ignored config cannot change strictness',
        project: 'configs/**/tsconfig.json',
        projectFolderIgnoreList: ['**/a/**'],
        selected: 'configs/b/tsconfig.json',
        type: 'string | undefined',
    },
    {
        name: 'node_modules ignored by default',
        project: ['node_modules/**/tsconfig.json', 'configs/b/*.json'],
        selected: 'configs/b/tsconfig.json',
        type: 'string | undefined',
    },
    {
        name: 'explicit empty ignore list',
        project: ['node_modules/**/tsconfig.json', 'configs/b/*.json'],
        projectFolderIgnoreList: [],
        selected: 'node_modules/shadow/tsconfig.json',
        type: 'string',
    },
];

function parse(project: string | string[] | false, filePath = 'src/main.ts', projectFolderIgnoreList?: string[]) {
    return parser.parseForESLint(source, {
        project,
        projectFolderIgnoreList,
        filePath: join(root, filePath),
        tsconfigRootDir: root,
        nativeCompilerPath: getPreparedNativeTypeScriptPath(),
    });
}

describe('native lint project selection', () => {
    it.each(configurations)(
        '$name preserves the selected checker type',
        async ({ project, projectFolderIgnoreList, selected, type }) => {
            const parsed = parse(project, 'src/main.ts', projectFolderIgnoreList);
            const services = parsed.services;
            if (!services.hasTypeInformation) throw new Error('Expected a typed native snapshot');
            try {
                const statement = parsed.ast.body[0];
                if (
                    !statement ||
                    statement.type !== 'ExportNamedDeclaration' ||
                    statement.declaration?.type !== 'VariableDeclaration'
                ) {
                    throw new Error('Expected the exported fixture variable');
                }
                const declaration = statement.declaration.declarations[0];
                if (!declaration) throw new Error('Expected the exported fixture binding');
                expect(relative(root, services.project.configFileName).split(sep).join('/')).toBe(selected);
                expect(services.checker.typeToString(services.getTypeAtLocation(declaration.id))).toBe(type);
            } finally {
                services.dispose();
                await services.whenDisposed;
            }
        }
    );

    it('keeps an unmatched glob syntax-only', () => {
        const parsed = parse('absent/**/*.json');
        expect(parsed.services.hasTypeInformation).toBe(false);
        expect(parsed.services.project).toBeUndefined();
    });

    it('rejects missing explicit configs and excluded files', () => {
        expect(() => parse('absent.json')).toThrow('Project configuration does not exist:');
        expect(() => parse('configs/b/tsconfig.json', 'src/excluded/no.ts')).toThrow(
            'File is outside the configured lint projects:'
        );
    });

    it('keeps projectService outside the native snapshot contract', () => {
        expect(() =>
            parser.parseForESLint(source, {
                projectService: true,
                filePath: join(root, 'src/main.ts'),
                tsconfigRootDir: root,
                nativeCompilerPath: getPreparedNativeTypeScriptPath(),
            })
        ).toThrow('programs/projectService objects are unsupported');
    });
});
