import { Project, SyntaxKind, ImportDeclaration } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
});

project.addSourceFilesAtPaths('src/modules/Transport/useCases/transportControls/__tests__/setPreRollBars.spec.ts');

const sourceFile = project.getSourceFiles()[0];

// Just manually add the imports and vi.mock for this one to test the theory
sourceFile.addImportDeclaration({
    moduleSpecifier: '#/modules/Transport/repositories/transport/getTransportState',
    namedImports: ['getTransportState'],
});
sourceFile.addImportDeclaration({
    moduleSpecifier: '#/modules/Transport/repositories/transport/updateTransportState',
    namedImports: ['updateTransportState'],
});
sourceFile.insertStatements(sourceFile.getImportDeclarations().length, [
    `vi.mock('#/modules/Transport/repositories/transport/getTransportState');`,
    `vi.mock('#/modules/Transport/repositories/transport/updateTransportState');`,
]);

sourceFile.saveSync();
