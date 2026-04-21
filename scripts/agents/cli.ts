import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

// Flags that never consume the next argument
const BOOLEAN_FLAGS = new Set(['no-launch', 'json', 'duplicate', 'force', 'dirty-only', 'sparse']);

/**
 * Minimal arg parser — no external deps.
 * Handles --flag, --flag value, and --flag=value forms.
 * Returns { flags: Map<string, string|true>, positional: string[] }
 */
export function parseArgs(argv) {
    const flags = new Map();
    const positional = [];
    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '--') {
            // POSIX end-of-flags sentinel — everything after is positional
            for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]);
            break;
        }
        if (arg.startsWith('--')) {
            // Handle --key=value
            const eqIdx = arg.indexOf('=');
            if (eqIdx !== -1) {
                const key = arg.slice(2, eqIdx);
                const val = arg.slice(eqIdx + 1);
                flags.set(key, val);
                i++;
                continue;
            }
            const key = arg.slice(2);
            const isBoolean = BOOLEAN_FLAGS.has(key);
            const next = argv[i + 1];
            if (isBoolean || !next || next.startsWith('--')) {
                flags.set(key, true);
            } else {
                flags.set(key, next);
                i++;
            }
        } else {
            positional.push(arg);
        }
        i++;
    }
    return { flags, positional };
}

/**
 * Recursively find all .md files under a directory.
 * Returns paths relative to the given root.
 */
export function findMarkdownFiles(dir) {
    const results = [];
    function walk(absDir, relDir) {
        let entries;
        try {
            entries = readdirSync(absDir, { withFileTypes: true });
        } catch (e) {
            console.warn(`Warning: could not read directory ${absDir}: ${e.message}`);
            return;
        }
        for (const entry of entries) {
            const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(join(absDir, entry.name), relPath);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push(relPath);
            }
        }
    }
    walk(dir, '');
    return results;
}

/**
 * Run fzf over a list of items. Returns the selected item or null if cancelled.
 */
export function fzfSelect(items, { prompt = '> ', preview = '', multi = false } = {}) {
    if (!items.length) return null;
    const args = ['--prompt', prompt, '--height', '60%', '--border', '--ansi'];
    if (multi) args.push('-m');
    if (preview) args.push('--preview', preview, '--preview-window', 'right:55%:wrap');
    
    const result = spawnSync('fzf', args, {
        input: items.join('\n'),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'inherit'],
    });

    if (result.status !== 0 || !result.stdout.trim()) {
        return null;
    }
    
    // If multi, return an array of strings, otherwise just a string.
    if (multi) {
        return result.stdout.trim().split('\n');
    }
    return result.stdout.trim();
}

/**
 * Simple synchronous readline polyfill for prompting strings.
 */
export async function promptInput(promptText, defaultVal = '') {
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => {
        rl.question(promptText, (answer) => {
            rl.close();
            resolve(answer || defaultVal);
        });
    });
}
