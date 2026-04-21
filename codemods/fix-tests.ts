import fs from 'fs';
import path from 'path';
import glob from 'glob';

const files = glob
    .sync('src/modules/Transport/**/__tests__/*.spec.ts')
    .concat(
        glob.sync('src/modules/Arrangement/**/__tests__/*.spec.ts'),
        glob.sync('src/modules/Arrangement/**/__tests__/*.spec.tsx'),
        glob.sync('src/modules/Transport/**/__tests__/*.spec.tsx')
    );

for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes('injectDependencies')) continue;

    // Remove import of injectDependencies
    content = content.replace(/import\s*\{\s*injectDependencies\s*\}\s*from\s*['"][^'"]+['"];?\n?/, '');

    // Look for injectDependencies(fnName, { a, b })
    const regex = /injectDependencies\s*\(\s*([^,]+)\s*,\s*\{\s*([^}]+)\s*\}\s*\)\s*;/g;
    let match;
    const mocksToAdd = new Map<string, string>(); // mockPath -> content
    let newContent = content;

    while ((match = regex.exec(content)) !== null) {
        const [fullMatch, fnName, depsString] = match;

        // Remove the injectDependencies call
        newContent = newContent.replace(fullMatch, '');

        // We need to add vi.mock for each dependency. Since they were passed in tests,
        // we can just mock the files they come from. BUT wait, in tests, they already
        // define `const update = vi.fn();` and then pass `{ updateTransportState: update }`.
        // To fix this without complex AST analysis, we can just replace `injectDependencies`
        // with assigning the passed variables to a global mock or something, but we can't
        // do that without top-level vi.mock.

        // It is actually easier to just let the generalist agent fix it if I scope it well.
    }
}
