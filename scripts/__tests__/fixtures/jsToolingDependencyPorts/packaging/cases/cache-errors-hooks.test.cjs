'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { loadFormat } = require('../fixtures/installed-cache.cjs');
for (const format of ['cjs', 'esm']) {
    test(
        format + ': only historical optional emitters preserve false, listeners and explicit failures survive',
        async () => {
            const { CacheableMemory } = await loadFormat('@cacheable/memory', format);
            const memory = new CacheableMemory();
            const errors = [];
            memory.on('error', (error) => errors.push(error));
            memory.lruSize = 16777217;
            assert.equal(memory.lruSize, 0);
            assert.match(errors[0].message, /LRU size cannot be larger/);
            assert.doesNotThrow(() => {
                new CacheableMemory({ lruSize: 16777217 });
            });
            const { Cacheable, CacheableSync } = await loadFormat('cacheable', format);
            const { Keyv, KeyvMemoryAdapter } = await loadFormat('keyv', format);
            const store = new KeyvMemoryAdapter(new Map());
            const expected = new Error('fixture storage failure');
            store.get = async () => {
                throw expected;
            };
            const cache = new Cacheable({ primary: new Keyv({ store }) });
            const delivered = [];
            cache.on('error', (error) => delivered.push(error));
            assert.equal(await cache.get('a'), undefined);
            assert.ok(delivered.includes(expected));
            cache.removeAllListeners('error');
            const listenerError = new Error('fixture listener failure');
            cache.on('error', () => {
                throw listenerError;
            });
            await assert.rejects(cache.get('a'), (error) => error === listenerError);
            const { Qified } = await loadFormat('qified', format);
            const providerError = new Error('fixture provider failure');
            const queue = new Qified({
                messageProviders: [
                    {
                        publish: async () => {
                            throw providerError;
                        },
                    },
                ],
            });
            await assert.rejects(queue.publish('local', { data: 1 }), (error) => error === providerError);
            const optionalSync = new CacheableSync({
                qified: queue,
                throwOnEmptyListeners: undefined,
            });
            assert.equal(optionalSync.throwOnEmptyListeners, false);
            const strictSync = new CacheableSync({
                qified: queue,
                throwOnEmptyListeners: true,
            });
            assert.throws(
                () => strictSync.emit('error', providerError),
                (error) => error === providerError
            );
            const seen = [];
            queue.on('error', (error) => seen.push(error));
            await queue.publish('local', { data: 2 });
            assert.deepEqual(seen, [providerError]);
        }
    );
    test(
        format + ': native hooks retain registration order, changed value, returned handle and rejection policy',
        async () => {
            const { Cacheable, CacheableHooks } = await loadFormat('cacheable', format);
            const cache = new Cacheable();
            const calls = [];
            const handle = cache.onHook(CacheableHooks.BEFORE_SET, (item) => {
                calls.push('before');
                item.value = { written: true };
            });
            assert.equal(handle.event, CacheableHooks.BEFORE_SET);
            cache.onHook({
                event: CacheableHooks.AFTER_SET,
                handler: () => {
                    calls.push('after');
                },
            });
            assert.equal(await cache.set('a', { written: false }), true);
            assert.deepEqual(await cache.get('a'), { written: true });
            assert.deepEqual(calls, ['before', 'after']);
            cache.throwOnHookError = true;
            cache.onHook(CacheableHooks.BEFORE_GET, () => {
                throw new Error('fixture hook failure');
            });
            const errors = [];
            cache.on('error', (error) => errors.push(error));
            await cache.get('a');
            assert.ok(errors.some((error) => error.message.includes('fixture hook failure')));
        }
    );
    test(format + ': latest published hash consumer preserves serialization and native digest values', async () => {
        const { hash, hashToNumberSync } = await loadFormat('@cacheable/utils', format);
        const value = { key: 'Ω 音楽', nested: [1, true, null] };
        const expected = createHash('sha256')
            .update(JSON.stringify(JSON.stringify(value)))
            .digest('hex');
        assert.equal(await hash(value), expected);
        assert.notEqual(await hash({ ...value, key: 'changed' }), expected);
        const bucket = hashToNumberSync(value, { min: 0, max: 15 });
        assert.equal(Number.isInteger(bucket), true);
        assert.ok(bucket >= 0 && bucket <= 15);
        assert.throws(() => hashToNumberSync(value, { min: 2, max: 1 }), /Invalid range/);
    });
}
