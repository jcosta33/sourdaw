import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export function physicalChild(parent, name) {
    const nested = join(parent, 'node_modules', name);
    if (existsSync(join(nested, 'package.json'))) return realpathSync(nested);
    let directory = parent;
    while (basename(directory) !== 'node_modules') {
        const next = dirname(directory);
        if (next === directory) return undefined;
        directory = next;
    }
    const candidate = join(directory, name);
    return existsSync(join(candidate, 'package.json')) ? realpathSync(candidate) : undefined;
}

export function installedGraph(repository) {
    const root = resolve(repository);
    const queue = [root];
    const seen = new Map();
    const edges = [];
    while (queue.length) {
        const parent = queue.shift();
        if (seen.has(parent)) continue;
        const metadata = JSON.parse(readFileSync(join(parent, 'package.json'), 'utf8'));
        seen.set(parent, { root: parent, name: metadata.name, version: metadata.version });
        const dependencies = {
            ...metadata.dependencies,
            ...metadata.optionalDependencies,
            ...metadata.peerDependencies,
            ...(parent === root ? metadata.devDependencies : {}),
        };
        for (const name of Object.keys(dependencies)) {
            const child = physicalChild(parent, name);
            if (!child) continue;
            const version = JSON.parse(readFileSync(join(child, 'package.json'), 'utf8')).version;
            edges.push({ parent: metadata.name, parentVersion: metadata.version, child: name, version });
            queue.push(child);
        }
    }
    function packageRoot(name, version) {
        const matches = [...seen.values()].filter(
            (record) => record.name === name && (!version || record.version === version)
        );
        assert(matches.length, `No actual installed graph route reaches ${name}@${version ?? '*'}`);
        const managed = matches.find((record) => {
            const owner = record.name.startsWith('@') ? dirname(dirname(record.root)) : dirname(record.root);
            return dirname(dirname(owner)) === join(root, 'node_modules/.pnpm');
        });
        return (managed ?? matches[0]).root;
    }
    return { packages: [...seen.values()], edges, packageRoot };
}
