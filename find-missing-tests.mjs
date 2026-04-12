import fs from 'fs';
import path from 'path';

function walkDir(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            if (file !== '__tests__' && !file.includes('node_modules')) {
                walkDir(filePath, fileList);
            }
        } else {
            if ((filePath.endsWith('.ts') || filePath.endsWith('.tsx')) && !filePath.endsWith('.d.ts')) {
                fileList.push(filePath);
            }
        }
    }
    return fileList;
}

const allSources = walkDir('./src/modules');
const missingTests = [];
for (const source of allSources) {
    if (source.endsWith('index.ts') || source.endsWith('index.tsx')) continue;
    if (source.includes('/models/')) continue; // Skip models for now
    if (source.includes('/types/')) continue; // Skip types
    const dir = path.dirname(source);
    const ext = path.extname(source);
    const name = path.basename(source, ext);
    const testFile = path.join(dir, '__tests__', `${name}.spec${ext}`);
    if (!fs.existsSync(testFile)) {
        missingTests.push(source);
    }
}
console.log(missingTests.slice(0, 30).join('\n'));
console.log("Total missing:", missingTests.length);
