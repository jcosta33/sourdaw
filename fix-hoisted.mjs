import fs from 'fs';
import { globSync } from 'glob';

const files = globSync('src/modules/Workspace/**/*.spec.ts').concat(
    globSync('src/modules/Project/**/*.spec.ts')
);

for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    if (content.includes('const { mockEventBus } = vi.hoisted(')) {
        content = content.replace(/const\s+\{\s*mockEventBus\s*\}\s*=\s*vi\.hoisted/g, 'const mocks = vi.hoisted');
        content = content.replace(/mockEventBus/g, 'mocks.mockEventBus');
        // fix the definition inside hoisted where it now looks like mocks.mockEventBus:
        content = content.replace(/mocks\.mockEventBus\s*:\s*\{/g, 'mockEventBus: {');
        // fix the const declaration since we replaced mockEventBus with mocks.mockEventBus inside the regex:
        content = content.replace(/const\s+mocks\s*=\s*vi\.hoisted\(\(\)\s*=>\s*\(\{\s*mockEventBus:\s*\{/g, 'const mocks = vi.hoisted(() => ({\n    mockEventBus: {');
        fs.writeFileSync(file, content);
        console.log(`Fixed mockEventBus hoisting in ${file}`);
    }
}
