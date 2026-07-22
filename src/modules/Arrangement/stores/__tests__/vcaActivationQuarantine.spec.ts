import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
    createSourceFile,
    forEachChild,
    isCallExpression,
    isIdentifier,
    isImportDeclaration,
    isJsxSelfClosingElement,
    isNamedImports,
    isPropertyAssignment,
    isStringLiteral,
    type Node,
    type SourceFile,
    ScriptKind,
    ScriptTarget,
} from 'typescript';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function productionSources(root = resolve(process.cwd(), 'src')): Array<{ path: string; text: string }> {
    const files: Array<{ path: string; text: string }> = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__') {
                files.push(...productionSources(path));
            }
            continue;
        }
        if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
            files.push({ path: relative(process.cwd(), path), text: readFileSync(path, 'utf8') });
        }
    }
    return files;
}

function matches(text: string, pattern: RegExp): string[] {
    return text.match(pattern) ?? [];
}

function parsedSource(path: string): SourceFile {
    const scriptKind = path.endsWith('.tsx') ? ScriptKind.TSX : ScriptKind.TS;
    return createSourceFile(path, source(path), ScriptTarget.Latest, true, scriptKind);
}

function importedBinding(file: SourceFile, modulePath: string, exportedName: string): string {
    for (const statement of file.statements) {
        if (
            !isImportDeclaration(statement) ||
            !isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== modulePath
        ) {
            continue;
        }
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !isNamedImports(bindings)) {
            continue;
        }
        const element = bindings.elements.find(
            (candidate) => (candidate.propertyName ?? candidate.name).text === exportedName
        );
        if (element) {
            return element.name.text;
        }
    }
    throw new Error(`Missing ${exportedName} import from ${modulePath} in ${file.fileName}`);
}

function visit(root: Node, predicate: (node: Node) => boolean): Node[] {
    const found: Node[] = [];
    function walk(node: Node): void {
        if (predicate(node)) {
            found.push(node);
        }
        forEachChild(node, walk);
    }
    walk(root);
    return found;
}

function callCount(file: SourceFile, binding: string): number {
    return visit(
        file,
        (node) => isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === binding
    ).length;
}

function callWithIdentifierArgumentsCount(file: SourceFile, binding: string, arguments_: readonly string[]): number {
    return visit(file, (node) => {
        if (!isCallExpression(node) || !isIdentifier(node.expression) || node.expression.text !== binding) {
            return false;
        }
        return (
            node.arguments.length === arguments_.length &&
            node.arguments.every((argument, index) => isIdentifier(argument) && argument.text === arguments_[index])
        );
    }).length;
}

function propertyBindingCount(file: SourceFile, property: string, binding: string): number {
    return visit(
        file,
        (node) =>
            isPropertyAssignment(node) &&
            isIdentifier(node.name) &&
            node.name.text === property &&
            isIdentifier(node.initializer) &&
            node.initializer.text === binding
    ).length;
}

function jsxMountCount(file: SourceFile, binding: string): number {
    return visit(
        file,
        (node) => isJsxSelfClosingElement(node) && isIdentifier(node.tagName) && node.tagName.text === binding
    ).length;
}

const LEGACY_ACTIONS = ['createVcaGroup', 'assignToVca', 'removeFromVca', 'setVcaGain'] as const;

describe('VCA activation quarantine', () => {
    it('keeps vca outside the production TrackKind contract', () => {
        const trackModel = source('src/modules/Arrangement/models/Track.ts');
        const declaration = trackModel.match(/export type TrackKind = ([^;]+);/);

        expect(declaration).not.toBeNull();
        expect(declaration?.[1]).toBe("'audio' | 'midi' | 'bus' | 'master' | 'folder'");
    });

    it('keeps the dormant migration definition-only in production source', () => {
        const occurrences = productionSources().flatMap(({ path, text }) =>
            matches(text, /\bmigrateLegacyVcaGroups\b/g).map(() => path)
        );

        expect(occurrences).toEqual([
            'src/modules/Project/useCases/projectPersistence/helpers/migrateLegacyVcaGroups.ts',
        ]);
    });

    it('keeps every legacy writer registered and called by its allowed handler', () => {
        const handlers = parsedSource('src/modules/Arrangement/useCases/getArrangementHandlers.ts');
        const expectedHandlerByAction = {
            assignToVca: 'handleAssignToVca',
            createVcaGroup: 'handleCreateVcaGroup',
            removeFromVca: 'handleRemoveFromVca',
            setVcaGain: 'handleSetVcaGain',
        } as const;

        for (const action of LEGACY_ACTIONS) {
            const handler = expectedHandlerByAction[action];
            const handlerFile = parsedSource(`src/modules/Arrangement/handlers/vca/${handler}.ts`);
            const registeredBinding = importedBinding(handlers, `../handlers/vca/${handler}`, handler);
            const writerBinding = importedBinding(handlerFile, `../../useCases/vca/${action}`, action);

            expect(propertyBindingCount(handlers, action, registeredBinding)).toBe(1);
            expect(callCount(handlerFile, writerBinding)).toBe(1);
        }
    });

    it('keeps the legacy assignment reader mounted with exact live writer calls', () => {
        const inspector = parsedSource('src/modules/TimelineEditor/presentations/views/Inspector/TrackInspector.tsx');
        const reader = parsedSource('src/modules/TimelineEditor/presentations/views/Inspector/TrackVcaSection.tsx');
        const mountedReader = importedBinding(inspector, './TrackVcaSection', 'TrackVcaSection');
        const useStoreBinding = importedBinding(reader, '#/infra/store/useStore', 'useStore');
        const storeBinding = importedBinding(reader, '#/modules/Arrangement/stores', 'vcaGroupStore');
        const defaultStateBinding = importedBinding(reader, '#/modules/Arrangement/stores', 'defaultVcaGroupState');

        expect(jsxMountCount(inspector, mountedReader)).toBe(1);
        expect(callWithIdentifierArgumentsCount(reader, useStoreBinding, [storeBinding, defaultStateBinding])).toBe(1);
        for (const writer of ['createVcaGroup', 'assignToVca', 'removeFromVca'] as const) {
            const writerBinding = importedBinding(reader, '#/modules/Arrangement/useCases', writer);
            expect(callCount(reader, writerBinding)).toBe(1);
        }
    });

    it('keeps only legacy VCA actions in the registered and persisted action unions', () => {
        const handlers = source('src/modules/Arrangement/useCases/getArrangementHandlers.ts');
        const appActions = source('src/utils/handlerContract.ts');
        const runtimeActions = source('src/modules/AiRuntime/models/RuntimeAction.ts');
        const registeredVcaActions = matches(handlers, /^\s{8}(\w*Vca\w*):/gm).map((row) => row.trim().split(':')[0]);
        const persistedVcaActions = matches(appActions, /type: '([^']*Vca[^']*)'/g).map(
            (row) => row.match(/'([^']+)'/)?.[1]
        );
        const runtimeVcaActions = matches(runtimeActions, /type: '([^']*Vca[^']*)'/g).map(
            (row) => row.match(/'([^']+)'/)?.[1]
        );

        expect(registeredVcaActions).toEqual([
            'createVcaGroup',
            'assignToVca',
            'removeFromVca',
            'setVcaGain',
            'restoreLegacyVcaState',
        ]);
        expect(persistedVcaActions).toEqual([
            'createVcaGroup',
            'assignToVca',
            'removeFromVca',
            'setVcaGain',
            'restoreLegacyVcaState',
        ]);
        expect(runtimeVcaActions).toEqual(LEGACY_ACTIONS);
    });

    it('keeps project and hydration schemas closed to canonical VCA tracks', () => {
        const projectModel = source('src/modules/Project/models/ProjectData.ts');
        const projectStore = source('src/modules/Project/stores/arrangementStore.ts');
        const hydration = source('src/modules/Project/useCases/projectPersistence/helpers/isHydratableProjectData.ts');
        const expectedKindUnion = "'audio' | 'midi' | 'bus' | 'master' | 'folder'";

        expect(projectModel.match(/export type ProjectTrackKind = ([^;]+);/)?.[1]).toBe(expectedKindUnion);
        expect(projectStore.match(/export type ProjectTrackKind = ([^;]+);/)?.[1]).toBe(expectedKindUnion);
        expect(
            matches(hydration, /\['audio', 'midi', 'bus', 'master', 'folder'\]\.includes\(String\(value\.kind\)\)/g)
        ).toHaveLength(1);
    });

    it('keeps dormant migration foundations unreachable from activation entry points', () => {
        const activationEntryPoints = [
            'src/app/bootstrap.ts',
            'src/modules/Arrangement/useCases/getArrangementHandlers.ts',
            'src/modules/Project/useCases/projectPersistence/fileIO/hydrateArrangementTracks.ts',
            'src/modules/Project/useCases/projectPersistence/fileIO/serializeArrangementTracks.ts',
            'src/modules/Project/useCases/projectPersistence/helpers/isHydratableProjectData.ts',
            'src/modules/TimelineEditor/presentations/views/Inspector/TrackInspector.tsx',
        ] as const;

        expect(activationEntryPoints).toHaveLength(6);
        for (const path of activationEntryPoints) {
            const text = source(path);
            expect(matches(text, /migrateLegacyVcaGroups|VcaTrackMigration/g), path).toHaveLength(0);
        }
    });
});
