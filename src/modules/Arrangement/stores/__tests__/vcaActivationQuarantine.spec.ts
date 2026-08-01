import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
    type BindingName,
    createSourceFile,
    forEachChild,
    isClassDeclaration,
    isClassExpression,
    isArrayLiteralExpression,
    isAsExpression,
    isCallExpression,
    isEnumDeclaration,
    isIdentifier,
    isImportDeclaration,
    isJsxSelfClosingElement,
    isNamedImports,
    isOmittedExpression,
    isParameter,
    isPropertyAssignment,
    isSatisfiesExpression,
    isVariableStatement,
    isStringLiteral,
    isFunctionDeclaration,
    isFunctionExpression,
    isVariableDeclaration,
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

/**
 * String elements of a top-level `const <name> = [...]` array literal, read from
 * the AST rather than scraped.
 *
 * The runtime action union used to be a hand-written discriminated union and was
 * read here with a `/type: '(…)'/` regex. `43905d409` rewrote it as a string
 * array with the payloads derived from it, so the file stopped containing a
 * single `type: '…'` literal and the regex started returning nothing. The
 * assertion then compared `[]` against the four legacy actions and **failed** —
 * it was red from that commit onward, and nothing was running it. It did not
 * pass vacuously; it could not, because the expected side is never empty.
 *
 * Reading the array removes the coupling to a syntactic form. The two throws
 * below are the part that matters: an extraction that silently returns less than
 * the whole array is how a census like this goes green while the thing it guards
 * is broken, and both of the cheap ways to do that are refused here rather than
 * left to be discovered.
 *
 * Unwraps `as const` and `satisfies`, which the declaration carries and which
 * would otherwise hide the array behind an expression node.
 */
function stringArrayLiteralElements(file: SourceFile, name: string): string[] {
    let found: string[] | undefined;
    for (const statement of file.statements) {
        if (!isVariableStatement(statement)) {
            continue;
        }
        for (const declaration of statement.declarationList.declarations) {
            if (!isIdentifier(declaration.name) || declaration.name.text !== name) {
                continue;
            }
            let initializer = declaration.initializer;
            while (initializer && (isAsExpression(initializer) || isSatisfiesExpression(initializer))) {
                initializer = initializer.expression;
            }
            if (!initializer || !isArrayLiteralExpression(initializer)) {
                throw new Error(`${name} is not an array literal in ${file.fileName}`);
            }
            const strings = initializer.elements.filter(isStringLiteral).map((element) => element.text);
            if (strings.length !== initializer.elements.length) {
                // Spreads, nested arrays and identifiers would otherwise be
                // dropped without a word, and the survivors could still satisfy
                // every assertion below — splitting a 238-entry list into named
                // groups joined by `...` is an ordinary refactor, and it would
                // hide whatever lives in the groups that were not read.
                throw new Error(
                    `${name} in ${file.fileName} holds ${initializer.elements.length} elements but only ` +
                        `${strings.length} are string literals; this reader would silently skip the rest`
                );
            }
            if (found) {
                throw new Error(`${name} is declared more than once in ${file.fileName}`);
            }
            found = strings;
        }
    }
    if (!found) {
        throw new Error(`${name} is not a top-level array literal in ${file.fileName}`);
    }
    return found;
}

function parsedSource(path: string): SourceFile {
    const scriptKind = path.endsWith('.tsx') ? ScriptKind.TSX : ScriptKind.TS;
    return createSourceFile(path, source(path), ScriptTarget.Latest, true, scriptKind);
}

function bindingNameContains(name: BindingName, binding: string): boolean {
    if (isIdentifier(name)) {
        return name.text === binding;
    }
    return name.elements.some((element) => !isOmittedExpression(element) && bindingNameContains(element.name, binding));
}

function declarationBindingName(node: Node): BindingName | undefined {
    if (isParameter(node) || isVariableDeclaration(node)) {
        return node.name;
    }
    if (
        isFunctionDeclaration(node) ||
        isFunctionExpression(node) ||
        isClassDeclaration(node) ||
        isClassExpression(node) ||
        isEnumDeclaration(node)
    ) {
        return node.name;
    }
    return undefined;
}

function assertImportIsUnshadowed(file: SourceFile, binding: string): void {
    const declarations = visit(file, (node) => {
        const name = declarationBindingName(node);
        return name !== undefined && bindingNameContains(name, binding);
    });
    if (declarations.length > 0) {
        throw new Error(`Imported binding ${binding} is shadowed in ${file.fileName}`);
    }
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
            assertImportIsUnshadowed(file, element.name.text);
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
    it('rejects imported liveness bindings shadowed by executable declarations', () => {
        const shadowed = createSourceFile(
            'shadowed.ts',
            "import { writer } from './writer'; function invoke(writer: () => void) { writer(); }",
            ScriptTarget.Latest,
            true,
            ScriptKind.TS
        );

        expect(() => importedBinding(shadowed, './writer', 'writer')).toThrow(
            'Imported binding writer is shadowed in shadowed.ts'
        );
    });

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
        const runtimeActions = parsedSource('src/modules/AiRuntime/models/RuntimeAction.ts');
        const registeredVcaActions = matches(handlers, /^\s{8}(\w*Vca\w*):/gm).map((row) => row.trim().split(':')[0]);
        const persistedVcaActions = matches(appActions, /type: '([^']*Vca[^']*)'/g).map(
            (row) => row.match(/'([^']+)'/)?.[1]
        );
        const runtimeActionTypes = stringArrayLiteralElements(runtimeActions, 'RUNTIME_ACTION_TYPES');
        const runtimeVcaActions = runtimeActionTypes.filter((action) => action.includes('Vca'));

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
        // Check the census found something before trusting what it did not find.
        // The real union holds ~240 entries; a reader returning four or fewer has
        // failed, not discovered a small union. The sharper guard is in
        // `stringArrayLiteralElements` itself, which refuses to return a partial
        // read at all — this catches the remaining case of a genuinely empty
        // literal, which parses fine.
        expect(runtimeActionTypes.length).toBeGreaterThan(LEGACY_ACTIONS.length);
        // Sorted because the two lists are ordered differently — `LEGACY_ACTIONS`
        // is in build order, and `RUNTIME_ACTION_TYPES` is only alphabetical from
        // `addChordEvent` onward. Membership is the invariant, not order; `toEqual`
        // still compares length and every element, so extras and omissions fail.
        expect([...runtimeVcaActions].sort()).toEqual([...LEGACY_ACTIONS].sort());
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

        // Both names have to exist somewhere before their absence here means
        // anything. `migrateLegacyVcaGroups` is cross-pinned as present by the
        // static-census assertion above, but `VcaTrackMigration` was pinned
        // nowhere: rename the type without renaming its file and half of this
        // alternation would go quietly blind while the loop below kept passing.
        // An absence assertion is only as good as the proof that the thing it
        // looks for is still called what it is called.
        const migrationSource = source(
            'src/modules/Project/useCases/projectPersistence/helpers/migrateLegacyVcaGroups.ts'
        );
        expect(matches(migrationSource, /VcaTrackMigration/g).length).toBeGreaterThan(0);

        for (const path of activationEntryPoints) {
            const text = source(path);
            expect(matches(text, /migrateLegacyVcaGroups|VcaTrackMigration/g), path).toHaveLength(0);
        }
    });
});
