// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import hardware from '../../tests/e2e/browserAiWebGpuAdmission.playwright.config';
import { transformE2eViteClient } from '../e2eViteClientPolicy';

const client = fileURLToPath(new URL('./dist/client/client.mjs', import.meta.resolve('vite/package.json')));
const source = readFileSync(client, 'utf8');
const ordinary = { command: 'serve', mode: 'e2e', noHmr: true };
const connect = 'transport.connect(createHMRHandler(handleMessage));';
const forward = 'setupForwardConsoleHandler(transport, forwardConsole);';

describe('ordinary E2E Vite client lifecycle', () => {
    it('fences only the two actual installed-client startup statements', () => {
        const result = transformE2eViteClient(source, client, ordinary);
        expect(result).not.toContain(connect);
        expect(result).not.toContain(forward);
        expect(result.replaceAll('\r\n', '\n').split('\n')).toHaveLength(source.split('\n').length);
        // Both replacements are deletions: every remaining client byte is original.
        expect(result).toBe(source.replace(connect, '').replace(forward, ''));
        expect(result).toContain('function updateStyle(');
        expect(result).toContain('function removeStyle(');
        expect(result).toContain('export {');
    });

    it.each([
        { command: 'serve', mode: 'development', noHmr: false },
        { command: 'serve', mode: 'development', noHmr: true },
        { command: 'serve', mode: 'e2e', noHmr: false },
        { command: 'build', mode: 'e2e', noHmr: true },
        { command: 'build', mode: 'production', noHmr: true },
        { command: 'serve', mode: 'e2e-unknown', noHmr: true },
    ])('preserves every byte outside ordinary E2E: $command/$mode/noHmr=$noHmr', (policy) => {
        expect(transformE2eViteClient(source, client, policy)).toBe(source);
        expect(transformE2eViteClient('unrecognized client bytes', client, policy)).toBe('unrecognized client bytes');
    });

    it.each([connect, forward])('refuses missing, duplicated or changed startup site %s', (call) => {
        expect(() => transformE2eViteClient(source.replace(call, ''), client, ordinary)).toThrow('Unsupported Vite');
        expect(() => transformE2eViteClient(`${source}\n${call}`, client, ordinary)).toThrow('Unsupported Vite');
        expect(() => transformE2eViteClient(source.replace(call, `changed_${call}`), client, ordinary)).toThrow(
            'Unsupported Vite'
        );
    });

    it('leaves unrelated modules byte-identical and registers the policy in the real Vite configuration', () => {
        expect(transformE2eViteClient(source, resolve('src/app/main.tsx'), ordinary)).toBe(source);
        const config = readFileSync(resolve(import.meta.dirname, '../../vite.config.ts'), 'utf8');
        expect(config).toContain('        e2eViteClientPolicyPlugin(),');
    });

    it('keeps the hardware optimizer on its explicit ordinary-development HMR path', () => {
        expect(hardware.webServer).toMatchObject({ env: { NO_HMR: '0' } });
        expect(hardware.webServer).toMatchObject({ command: expect.stringContaining('pnpm dev --host') });
    });
});
