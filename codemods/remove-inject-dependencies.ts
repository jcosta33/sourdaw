import { Project, SyntaxKind, ObjectLiteralExpression, PropertyAssignment, CallExpression } from 'ts-morph';

console.log('Starting script...');

const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
});

project.addSourceFilesAtPaths('src/modules/Arrangement/**/__tests__/*.spec.ts');
project.addSourceFilesAtPaths('src/modules/Arrangement/**/__tests__/*.spec.tsx');
project.addSourceFilesAtPaths('src/modules/Transport/**/__tests__/*.spec.ts');
project.addSourceFilesAtPaths('src/modules/Transport/**/__tests__/*.spec.tsx');

const sourceFiles = project.getSourceFiles();
console.log(`Found ${sourceFiles.length} files to process.`);

let processedCount = 0;

for (const sourceFile of sourceFiles) {
    if (!sourceFile.getFilePath().includes('.spec.')) continue;
    let modified = false;

    const importDecls = sourceFile.getImportDeclarations();
    for (const importDecl of importDecls) {
        if (importDecl.getModuleSpecifierValue().includes('injectDependencies')) {
            importDecl.remove();
            modified = true;
        }
    }

    const mocksByPath: Map<string, Set<string>> = new Map();

    while (true) {
        const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
        let found = false;

        for (const callExpr of callExpressions) {
            const expr = callExpr.getExpression();
            if (
                (expr.getKind() === SyntaxKind.Identifier && expr.getText() === 'injectDependencies') ||
                (expr.getKind() === SyntaxKind.PropertyAccessExpression &&
                    expr.getText().includes('injectDependencies'))
            ) {
                const args = callExpr.getArguments();
                if (args.length >= 2) {
                    const depsObj = args[1];
                    if (depsObj.getKind() === SyntaxKind.ObjectLiteralExpression) {
                        const obj = depsObj as ObjectLiteralExpression;
                        const props = obj.getProperties();
                        const replacements: string[] = [];

                        for (const prop of props) {
                            let name: string | undefined;
                            let initializerText: string | undefined;

                            if (prop.getKind() === SyntaxKind.PropertyAssignment) {
                                const propAssignment = prop as PropertyAssignment;
                                name = propAssignment.getName();
                                initializerText = propAssignment.getInitializer()?.getText();
                            } else if (prop.getKind() === SyntaxKind.ShorthandPropertyAssignment) {
                                name = prop.getName();
                                initializerText = name;
                            }

                            if (name && initializerText) {
                                const importDecl = sourceFile.getImportDeclaration((decl) => {
                                    return decl.getNamedImports().some((ni) => ni.getName() === name);
                                });

                                if (importDecl) {
                                    const importPath = importDecl.getModuleSpecifierValue();
                                    if (!mocksByPath.has(importPath)) {
                                        mocksByPath.set(importPath, new Set());
                                    }
                                    mocksByPath.get(importPath)!.add(name);
                                }

                                replacements.push(`vi.mocked(${name}).mockImplementation(${initializerText} as any)`);
                            }
                        }

                        const parent = callExpr.getParentIfKind(SyntaxKind.ExpressionStatement);
                        if (parent) {
                            if (replacements.length > 0) {
                                parent.replaceWithText(replacements.join(';\n') + ';');
                            } else {
                                parent.remove();
                            }
                        } else {
                            if (replacements.length > 0) {
                                callExpr.replaceWithText(`(() => { ${replacements.join(';\n')}; })()`);
                            } else {
                                callExpr.replaceWithText('undefined');
                            }
                        }
                        found = true;
                        modified = true;
                        break; // Break the for loop and restart while loop
                    }
                }
            }
        }

        if (!found) {
            break;
        }
    }

    if (modified) {
        let vitestImport = sourceFile.getImportDeclaration('vitest');
        if (!vitestImport) {
            vitestImport = sourceFile.addImportDeclaration({
                moduleSpecifier: 'vitest',
                namedImports: ['vi'],
            });
        } else {
            const hasVi = vitestImport.getNamedImports().some((ni) => ni.getName() === 'vi');
            if (!hasVi) {
                vitestImport.addNamedImport('vi');
            }
        }

        const mockBlocks: string[] = [];
        for (const [importPath, mocks] of mocksByPath.entries()) {
            const isBarrel =
                importPath.endsWith('useCases') || importPath.endsWith('repositories') || importPath.endsWith('index');

            const existingMock = sourceFile.getStatements().some((stmt) => {
                if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
                    const text = stmt.getText();
                    return text.includes(`vi.mock('${importPath}'`) || text.includes(`vi.mock("${importPath}"`);
                }
                return false;
            });

            if (existingMock) continue;

            if (isBarrel) {
                const mockExports = Array.from(mocks)
                    .map((name) => `${name}: vi.fn()`)
                    .join(',\n    ');
                mockBlocks.push(`vi.mock('${importPath}', async (importOriginal) => {
  const mod = await importOriginal<typeof import('${importPath}')>();
  return {
    ...mod,
    ${mockExports}
  };
});`);
            } else {
                mockBlocks.push(`vi.mock('${importPath}');`);
            }
        }

        if (mockBlocks.length > 0) {
            const lastImportIndex = sourceFile.getImportDeclarations().length;
            sourceFile.insertStatements(lastImportIndex, mockBlocks.join('\n\n'));
        }

        sourceFile.saveSync();
        console.log(`Updated ${sourceFile.getFilePath()}`);
        processedCount++;
    }
}
console.log(`Successfully processed ${processedCount} files.`);
