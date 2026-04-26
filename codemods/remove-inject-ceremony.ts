/**
 * Codemod: remove-inject-ceremony
 *
 * Removes ceremonious `inject()` wrappers where the pattern is:
 *
 *   export const foo = inject({ fooImpl })(({ fooImpl }) =>
 *       function foo(a, b) { return fooImpl(a, b); }
 *   );
 *
 * Transforms to:
 *
 *   export function foo(a, b) { return fooImpl(a, b); }
 *
 * Criteria for removal (ALL must be true):
 *   1. The inject deps map has exactly ONE key.
 *   2. The factory arrow function has exactly one parameter (the deps destructure).
 *   3. The factory body is a function expression / function declaration (not inline arrow).
 *   4. The inner function body has exactly ONE statement (a ReturnStatement).
 *   5. The function is not async (async inject is rare and likely intentional).
 *
 * Deliberately does NOT transform:
 *   - Multi-dep inject maps (real orchestration logic)
 *   - Lazy inject ({ lazy: true }) — these are intentional TDZ workarounds
 *   - inject calls whose inner function has multiple statements (has real logic)
 *   - inject calls where the deps variable is a shared const (e.g. fooBarDependencies)
 *     because those shared objects are used by tests via injectDependencies()
 *
 * Run as dry-run first:
 *   pnpm jscodeshift -t codemods/remove-inject-ceremony.ts src/ -d -p --extensions=ts,tsx
 *
 * Apply:
 *   pnpm jscodeshift -t codemods/remove-inject-ceremony.ts src/ --extensions=ts,tsx
 */

import { FileInfo, API } from 'jscodeshift';

export const parser = 'tsx';

export default function transform(fileInfo: FileInfo, api: API): string | null {
    const j = api.jscodeshift;
    const root = j(fileInfo.source);
    let modified = false;

    // Find all variable declarations: const X = inject(...)(...)
    root.find(j.VariableDeclaration).forEach((varDeclPath) => {
        const declarations = varDeclPath.node.declarations;
        if (declarations.length !== 1) return;

        const declarator = declarations[0];
        if (declarator.type !== 'VariableDeclarator') return;
        if (!declarator.init) return;

        // Must be: inject(...)(...)  — two consecutive calls
        const outerCall = declarator.init;
        if (outerCall.type !== 'CallExpression') return;

        const innerCall = outerCall.callee;
        if (innerCall.type !== 'CallExpression') return;

        // inner callee must be `inject`
        const injectCallee = innerCall.callee;
        if (injectCallee.type !== 'Identifier' || injectCallee.name !== 'inject') return;

        // inject first arg: the deps object literal
        const injectArgs = innerCall.arguments;
        if (injectArgs.length < 1) return;

        // Guard: reject lazy inject ({ lazy: true } second arg)
        if (injectArgs.length >= 2) return;

        const depsArg = injectArgs[0];

        // Must be an ObjectExpression (not a referenced variable like fooBarDependencies)
        // Reject if deps are a shared named variable — those are wired in tests.
        if (depsArg.type !== 'ObjectExpression') return;

        // Exactly ONE property in the deps map
        if (depsArg.properties.length !== 1) return;

        const depProp = depsArg.properties[0];
        if (depProp.type !== 'ObjectProperty' && depProp.type !== 'Property') return;

        // inject second arg: the factory arrow function
        const factoryArgs = outerCall.arguments;
        if (factoryArgs.length !== 1) return;

        const factory = factoryArgs[0];
        if (factory.type !== 'ArrowFunctionExpression') return;

        // Factory params: ({ dep }) — exactly one destructuring pattern
        if (factory.params.length !== 1) return;
        const factoryParam = factory.params[0];
        if (factoryParam.type !== 'ObjectPattern') return;

        // Guard: reject renamed destructuring ({ foo: bar }) — the inner function
        // body uses the alias (bar) which would be undefined after removing inject.
        const hasRenamedDep = (factoryParam as any).properties?.some((p: any) => {
            if (p.type !== 'ObjectProperty' && p.type !== 'Property') return false;
            const keyName = p.key?.name ?? p.key?.value;
            const valName = p.value?.name;
            return keyName !== valName;
        });
        if (hasRenamedDep) return;

        // Factory body: must be a function expression or function declaration
        // (NOT an arrow function body — we only handle the named function case)
        const innerFn = factory.body;
        if (innerFn.type !== 'FunctionExpression' && innerFn.type !== 'FunctionDeclaration') return;

        // Inner function must not be async
        if ((innerFn as any).async) return;

        // Inner function body: exactly ONE statement
        const body = innerFn.body;
        if (body.type !== 'BlockStatement') return;
        if (body.body.length !== 1) return;

        const singleStmt = body.body[0];
        if (singleStmt.type !== 'ReturnStatement') return;

        // All criteria met — perform the transformation.
        // Replace the VariableDeclaration with a FunctionDeclaration.

        const innerFnNode = innerFn as any;
        const varDeclNode = varDeclPath.node as any;

        // Build the replacement FunctionDeclaration node
        const fnDecl = j.functionDeclaration(
            innerFnNode.id ?? j.identifier(String((declarator.id as any).name)),
            innerFnNode.params,
            innerFnNode.body
        );
        (fnDecl as any).returnType = innerFnNode.returnType ?? null;
        (fnDecl as any).typeParameters = innerFnNode.typeParameters ?? null;

        // Preserve `export` if the original declaration was exported
        const isExported =
            varDeclNode.kind !== undefined && varDeclPath.parent?.node?.type === 'ExportNamedDeclaration';

        if (isExported) {
            // Replace the ExportNamedDeclaration wrapping the var decl
            j(varDeclPath.parent).replaceWith(j.exportNamedDeclaration(fnDecl, []));
        } else {
            j(varDeclPath).replaceWith(fnDecl);
        }

        modified = true;
    });

    if (!modified) return null;

    // After transformation, check if `inject` import is still needed.
    // Remove the inject import if no inject calls remain in the file.
    const remainingInjectCalls = root.find(j.CallExpression, {
        callee: { type: 'Identifier', name: 'inject' },
    });

    if (remainingInjectCalls.length === 0) {
        root.find(j.ImportDeclaration).forEach((importPath) => {
            const src = importPath.node.source.value;
            if (typeof src !== 'string' || !src.includes('/di/inject')) return;

            const specifiers = importPath.node.specifiers ?? [];
            const injectSpecifier = specifiers.find(
                (s) => s.type === 'ImportSpecifier' && (s as any).imported?.name === 'inject'
            );
            if (!injectSpecifier) return;

            if (specifiers.length === 1) {
                // Remove the entire import statement
                j(importPath).remove();
            } else {
                // Remove just the inject specifier
                importPath.node.specifiers = specifiers.filter((s) => s !== injectSpecifier);
            }
        });
    }

    return root.toSource({ quote: 'single' });
}
