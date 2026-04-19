import fs from 'fs';
import path from 'path';

const midiDir = path.resolve('src/modules/MIDI');

function getRelativePath(from, toModulePath) {
    // toModulePath is like 'stores/midiStore' or 'useCases/midiEvent/setNotePressure'
    const absoluteTo = path.resolve('src/modules/MIDI', toModulePath);
    let relative = path.relative(path.dirname(from), absoluteTo);
    if (!relative.startsWith('.')) {
        relative = './' + relative;
    }
    return relative;
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    // Replace #/modules/MIDI/useCases/... or #/modules/MIDI/stores/... or #/modules/MIDI/...
    content = content.replace(/['"]#\/modules\/MIDI\/(.*?)['"]/g, (match, subPath) => {
        const rel = getRelativePath(filePath, subPath);
        changed = true;
        return `'${rel}'`;
    });

    if (changed) {
        fs.writeFileSync(filePath, content);
        console.log(`Updated ${filePath}`);
    }
}

function walk(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
            processFile(fullPath);
        }
    }
}

walk(midiDir);
