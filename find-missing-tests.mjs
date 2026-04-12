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
    if (source.includes('/models/')) continue;
    if (source.includes('/types/')) continue;
    const dir = path.dirname(source);
    const ext = path.extname(source);
    const name = path.basename(source, ext);
    const testFileTs = path.join(dir, '__tests__', `${name}.spec.ts`);
    const testFileTsx = path.join(dir, '__tests__', `${name}.spec.tsx`);
    if (!fs.existsSync(testFileTs) && !fs.existsSync(testFileTsx)) {
        missingTests.push(source);
    }
}
missingTests.forEach(f => console.log(f));
