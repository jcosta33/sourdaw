import { fileURLToPath } from 'node:url';

import { normalizePath, type Plugin } from 'vite';

import { isSourdawE2eServeMode } from './e2eServerIdentity';

const clientPath = normalizePath(
    fileURLToPath(new URL('./dist/client/client.mjs', import.meta.resolve('vite/package.json')))
);
const startupCalls = [
    'transport.connect(createHMRHandler(handleMessage));',
    'setupForwardConsoleHandler(transport, forwardConsole);',
] as const;

type ClientPolicy = { command: string; mode: string; noHmr: boolean };

/** Keep Vite's real CSS helpers and exports; ordinary E2E owns its document lifecycle. */
export function transformE2eViteClient(code: string, id: string, policy: ClientPolicy): string {
    if (
        policy.command !== 'serve' ||
        !isSourdawE2eServeMode(policy.mode) ||
        !policy.noHmr ||
        normalizePath(id.split('?')[0] ?? '') !== clientPath
    ) {
        return code;
    }
    for (const call of startupCalls) {
        if (code.split(call).length !== 2 || !code.split('\n').includes(call)) {
            throw new Error(`Unsupported Vite client startup: expected exactly one ${call}`);
        }
    }
    return startupCalls.reduce((source, call) => source.replace(call, ''), code);
}

export function e2eViteClientPolicyPlugin(): Plugin {
    let policy: ClientPolicy = { command: '', mode: '', noHmr: false };
    return {
        name: 'sourdaw-e2e-vite-client-policy',
        enforce: 'post',
        apply: (_config, { command, mode }) => command === 'serve' && isSourdawE2eServeMode(mode),
        configResolved(config) {
            policy = { command: config.command, mode: config.mode, noHmr: config.server.hmr === false };
        },
        transform(code, id) {
            const transformed = transformE2eViteClient(code, id, policy);
            if (transformed === code) {
                return null;
            }
            return { code: transformed, map: null };
        },
    };
}
