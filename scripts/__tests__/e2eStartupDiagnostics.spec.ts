// @vitest-environment node
import { rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
    STARTUP_DIAGNOSTIC_CLIENT,
    STARTUP_DIAGNOSTIC_HEARTBEAT,
    STARTUP_DIAGNOSTIC_TARGET,
} from '../e2eStartupDiagnostics.ts';

import { createFixture, deferred, event, type Fixture } from './fixtures/e2eStartupDiagnostics.ts';

const fixtures: Fixture[] = [];

async function fixture(...args: Parameters<typeof createFixture>): Promise<Fixture> {
    const result = await createFixture(...args);
    fixtures.push(result);
    return result;
}

afterEach(async () => {
    for (const item of fixtures.splice(0)) {
        await item.server.close();
        await rm(item.root, { recursive: true, force: true });
    }
});

describe('startup server diagnostics', () => {
    it('observes the actual held HTTP transform and preserves its response, correlation and cleanup', async () => {
        const gate = deferred<string>();
        const item = await fixture('e2e', gate);
        const pending = fetch(`${item.origin}${STARTUP_DIAGNOSTIC_TARGET}?private=hidden-value`);
        let status: number;
        let body: string;
        try {
            await expect.poll(() => event(item, 'transform-start')).toBeDefined();
            const received = event(item, 'http-received');
            const started = event(item, 'transform-start');
            expect(received?.requestId).toEqual(started?.requestId);
            expect(started?.path).toBe(STARTUP_DIAGNOSTIC_TARGET);
            expect(event(item, 'transform-resolve')).toBeUndefined();
            await expect.poll(() => event(item, 'server-heartbeat'), { timeout: 8_000 }).toBeDefined();
        } finally {
            gate.resolve('export const fixtureValue = 23;');
            const response = await pending;
            status = response.status;
            body = await response.text();
        }
        expect(status).toBe(200);
        expect(body).toContain('fixtureValue = 23');
        await expect.poll(() => event(item, 'http-close')).toMatchObject({ finished: true });
        expect(event(item, 'http-finish')).toMatchObject({
            requestId: event(item, 'http-received')?.requestId,
            status: 200,
        });
        expect(event(item, 'transform-resolve')).toMatchObject({
            transformId: event(item, 'transform-start')?.transformId,
            found: true,
        });
        expect(JSON.stringify(item.events)).not.toContain('hidden-value');
        await item.server.close();
        expect(item.server.environments.client.transformRequest).toBe(item.original);
        expect(event(item, 'observer-closed')).toBeDefined();
    }, 15_000);

    it('observes a real load rejection without changing the HTTP failure or exposing its message', async () => {
        const gate = deferred<string>();
        const item = await fixture('e2e', gate);
        const pending = fetch(`${item.origin}${STARTUP_DIAGNOSTIC_TARGET}`);
        await expect.poll(() => event(item, 'transform-start')).toBeDefined();
        gate.reject(new TypeError('private-token-never-log'));
        const response = await pending;
        expect(response.status).toBe(500);
        await response.text();
        expect(event(item, 'transform-reject')).toMatchObject({ kind: 'TypeError' });
        expect(JSON.stringify(item.events)).not.toContain('private-token-never-log');
    });

    it('records a premature HTTP close independently of the held transform result', async () => {
        const gate = deferred<string>();
        const item = await fixture('e2e', gate);
        const abort = new AbortController();
        const pending = fetch(`${item.origin}${STARTUP_DIAGNOSTIC_TARGET}`, { signal: abort.signal });
        await expect.poll(() => event(item, 'transform-start')).toBeDefined();
        abort.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        try {
            await expect.poll(() => event(item, 'http-close')).toMatchObject({ finished: false });
            expect(event(item, 'http-finish')).toBeUndefined();
        } finally {
            gate.resolve('export const fixtureValue = 23;');
        }
        await expect.poll(() => event(item, 'transform-resolve')).toBeDefined();
    });

    it('does not activate in normal development or inject into a different fixture HTML', async () => {
        const disabled = await fixture('development');
        expect(await (await fetch(disabled.origin)).text()).not.toContain(STARTUP_DIAGNOSTIC_CLIENT);
        await (await fetch(`${disabled.origin}${STARTUP_DIAGNOSTIC_TARGET}`)).text();
        expect(disabled.events).toEqual([]);
        expect(disabled.server.environments.client.transformRequest).toBe(disabled.original);
        const enabled = await fixture();
        expect(await (await fetch(enabled.origin)).text()).toContain(STARTUP_DIAGNOSTIC_CLIENT);
        expect(await (await fetch(`${enabled.origin}/other.html`)).text()).not.toContain(STARTUP_DIAGNOSTIC_CLIENT);
    });

    it('bounds and validates renderer records without retaining arbitrary request content', async () => {
        const item = await fixture();
        const beat = {
            timeOrigin: Date.now(),
            sequence: 1,
            readyState: 'complete',
            entryStarted: true,
            bootstrapStarted: false,
            appRenderIssued: false,
            retryIssued: false,
            private: 'body-secret',
        };
        const post = (body: string): Promise<Response> =>
            fetch(`${item.origin}${STARTUP_DIAGNOSTIC_HEARTBEAT}?token=query-secret`, { method: 'POST', body });
        await post(JSON.stringify(beat));
        await post(JSON.stringify(beat));
        await post(JSON.stringify({ ...beat, sequence: 14 }));
        await post('oversized-secret'.repeat(100));
        expect(item.events.filter((value) => value.event === 'renderer-heartbeat')).toHaveLength(1);
        expect(JSON.stringify(item.events)).not.toMatch(/body-secret|query-secret|oversized-secret|private/);
        for (let index = 1; index <= 128; index += 1) {
            await post(JSON.stringify({ ...beat, timeOrigin: beat.timeOrigin + index }));
        }
        expect(item.events.filter((value) => value.event === 'renderer-heartbeat')).toHaveLength(128);
        for (let index = 0; index < 2_100; index += 1) {
            await item.server.environments.client.transformRequest(STARTUP_DIAGNOSTIC_TARGET);
        }
        expect(item.events).toHaveLength(4_096);
        expect(item.events.at(-1)?.eventId).toBe(4_096);
    }, 15_000);
});
