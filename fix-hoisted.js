import fs from 'fs';
import path from 'path';

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(file));
        } else if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) {
            results.push(file);
        }
    });
    return results;
}

const files = walkDir('src/modules/Workspace').concat(walkDir('src/modules/Project'));

for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    if (content.includes('const { mockEventBus } = vi.hoisted(')) {
        content = content.replace(/const\s+\{\s*mockEventBus\s*\}\s*=\s*vi\.hoisted\(\(\)\s*=>\s*\(\{\s*mockEventBus:\s*\{([^}]*)\}\s*,\s*\}\)\);/m, 
            'const mocks = vi.hoisted(() => ({ mockEventBus: {$1} }));');
        content = content.replace(/mockEventBus\./g, 'mocks.mockEventBus.');
        content = content.replace(/eventBus:\s*mockEventBus/g, 'eventBus: mocks.mockEventBus');
        fs.writeFileSync(file, content);
        console.log(`Fixed mockEventBus hoisting in ${file}`);
    }
}
