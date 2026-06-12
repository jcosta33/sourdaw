import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { getRepoRoot } from './git.ts';
import { cyan, bold, dim, green } from './colors.ts';

/**
 * Recursively find all TS/TSX files in a directory
 */
function findFiles(dir, maxDepth = 3, currentDepth = 0) {
    if (currentDepth > maxDepth) return [];
    let results = [];
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
            const fullPath = join(dir, entry);
            if (statSync(fullPath).isDirectory()) {
                results = results.concat(findFiles(fullPath, maxDepth, currentDepth + 1));
            } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
                results.push(fullPath);
            }
        }
    } catch (e) {
        // Ignore read errors
    }
    return results;
}

/**
 * Extract exported symbols (very naive regex-based RAG)
 */
function extractExports(filePath) {
    try {
        const content = readFileSync(filePath, 'utf8');
        const exports = [];

        // Naive match for export const/function/class/type/interface
        const regex = /export\s+(const|let|var|function|class|type|interface)\s+([a-zA-Z0-9_]+)/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            exports.push(`${match[1]} ${match[2]}`);
        }
        return exports;
    } catch (e) {
        return [];
    }
}

/**
 * Generate a semantic map of the target directory
 */
export function generateContextMap(repoRoot, targetDirRel) {
    const targetDir = targetDirRel ? join(repoRoot, targetDirRel) : repoRoot;
    const files = findFiles(targetDir);

    const map = {};
    for (const file of files) {
        const relPath = relative(repoRoot, file);
        const exports = extractExports(file);
        if (exports.length > 0) {
            map[relPath] = exports;
        }
    }

    return map;
}
