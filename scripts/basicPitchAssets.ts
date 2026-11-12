import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Plugin } from 'vite';

const moduleId = 'virtual:sourdaw-basic-pitch-model';
const resolvedModuleId = `\0${moduleId}`;
const shardName = 'group1-shard1of1.bin';

function isExpectedWeightsManifest(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        'paths' in value &&
        JSON.stringify(value.paths) === JSON.stringify([shardName])
    );
}

export function basicPitchAssets(): Plugin {
    const packageRoot = dirname(createRequire(import.meta.url).resolve('@spotify/basic-pitch/package.json'));
    const model = readFileSync(join(packageRoot, 'model/model.json'));
    const shard = readFileSync(join(packageRoot, 'model', shardName));
    const manifest: unknown = JSON.parse(model.toString('utf8'));
    if (
        typeof manifest !== 'object' ||
        manifest === null ||
        !('weightsManifest' in manifest) ||
        !Array.isArray(manifest.weightsManifest) ||
        manifest.weightsManifest.length !== 1 ||
        !isExpectedWeightsManifest(manifest.weightsManifest[0])
    ) {
        throw new Error('Basic Pitch model weights manifest changed');
    }
    const digest = createHash('sha256').update(model).update(shard).digest('hex');
    const directory = `assets/basic-pitch-${digest}`;
    let serving = false;
    let base = '/';
    return {
        name: 'sourdaw-basic-pitch-assets',
        configResolved(config) {
            serving = config.command === 'serve';
            base = config.base === './' || config.base === '' ? '/' : config.base;
        },
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const url = request.url?.split('?')[0];
                const prefix = `/${directory}/`;
                const path = url?.startsWith(base) ? `/${url.slice(base.length)}` : url;
                if (path !== `${prefix}model.json` && path !== `${prefix}${shardName}`) {
                    next();
                    return;
                }
                const bytes = path.endsWith('/model.json') ? model : shard;
                response.setHeader(
                    'Content-Type',
                    path.endsWith('.json') ? 'application/json' : 'application/octet-stream'
                );
                response.end(bytes);
            });
        },
        resolveId(id) {
            if (id === moduleId) {
                return resolvedModuleId;
            }
            return null;
        },
        load(id) {
            if (id !== resolvedModuleId) {
                return null;
            }
            if (serving) {
                return `export const modelUrl = ${JSON.stringify(`${base}${directory}/model.json`)}`;
            }
            const referenceId = this.emitFile({ type: 'asset', fileName: `${directory}/model.json`, source: model });
            this.emitFile({ type: 'asset', fileName: `${directory}/${shardName}`, source: shard });
            return `export const modelUrl = import.meta.ROLLDOWN_FILE_URL_${referenceId}`;
        },
    };
}
