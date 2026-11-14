import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { snapshotImportSpecifiers } from '../../trustedGithubWriteBootstrap.ts';

/** The repository-relative paths `entry` reaches through relative imports, itself included. */
export function relativeImportClosure(repositoryRoot: string, entry: string): string[] {
    const closure = new Set<string>();
    const pending = [entry];
    while (pending.length > 0) {
        const path = pending.pop();
        if (path === undefined || closure.has(path)) {
            continue;
        }
        closure.add(path);
        for (const specifier of snapshotImportSpecifiers(readFileSync(join(repositoryRoot, path), 'utf8'))) {
            if (specifier.startsWith('.')) {
                pending.push(join(dirname(path), specifier));
            }
        }
    }
    return [...closure];
}
