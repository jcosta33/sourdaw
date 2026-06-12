import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { getRepoRoot } from './git.ts';
import { cyan, bold, dim, green, yellow } from './colors.ts';

/**
 * Ensures the memory directory exists.
 */
function getMemoryDir(repoRoot) {
    const memDir = join(repoRoot, '.agents', 'memory');
    if (!existsSync(memDir)) {
        mkdirSync(memDir, { recursive: true });
    }
    return memDir;
}

/**
 * Write a memory note.
 */
export function writeMemory(repoRoot, topic, content) {
    const memDir = getMemoryDir(repoRoot);
    const file = join(memDir, `${topic}.md`);

    let existing = '';
    if (existsSync(file)) {
        existing = readFileSync(file, 'utf8') + '\n\n';
    }

    const stamped = `## Entry (${new Date().toISOString()})\n${content}\n`;
    writeFileSync(file, existing + stamped, 'utf8');
    return file;
}

/**
 * Read all memories for a topic, or list topics.
 */
export function readMemory(repoRoot, topic) {
    const memDir = getMemoryDir(repoRoot);

    if (!topic) {
        if (!existsSync(memDir)) return [];
        return readdirSync(memDir)
            .filter((f) => f.endsWith('.md'))
            .map((f) => f.replace('.md', ''));
    }

    const file = join(memDir, `${topic}.md`);
    if (!existsSync(file)) return null;

    return readFileSync(file, 'utf8');
}
