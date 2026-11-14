'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFormat } = require('../fixtures/installed-cache.cjs');
for (const format of ['cjs', 'esm']) {
    test(format + ': synchronous memory cloning, ordered batches, expiry and hooks', async (context) => {
        const { CacheableMemory, CacheableMemoryHooks } = await loadFormat('@cacheable/memory', format);
        const cache = new CacheableMemory({ storeHashSize: 1 });
        const events = [];
        cache.onHook(CacheableMemoryHooks.BEFORE_SET, (item) => {
            events.push('before:' + item.key);
        });
        cache.onHook(CacheableMemoryHooks.AFTER_SET, (item) => {
            events.push('after:' + item.key);
        });
        cache.set('a', { nested: { value: 1 } });
        const read = cache.get('a');
        read.nested.value = 9;
        assert.deepEqual(cache.getMany(['a', 'missing', 'a']), [
            { nested: { value: 1 } },
            undefined,
            { nested: { value: 1 } },
        ]);
        assert.deepEqual(events, ['before:a', 'after:a']);
        const before = Date.now();
        cache.set('ttl', 'expires', 100);
        const after = Date.now();
        const expires = cache.getRaw('ttl').expires;
        assert.ok(expires >= before + 100 && expires <= after + 100);
        let now = expires;
        context.mock.method(Date, 'now', () => now);
        assert.equal(cache.get('ttl'), 'expires');
        now = expires + 1;
        assert.equal(cache.get('ttl'), undefined);
        assert.equal([...cache.keys].includes('ttl'), false);
        cache.delete('a');
        assert.equal(cache.get('a'), undefined);
        cache.set('b', 2);
        cache.clear();
        assert.equal(cache.size, 0);
        const shared = new CacheableMemory({ useClone: false });
        shared.set('object', { value: 1 });
        shared.get('object').value = 2;
        assert.deepEqual(shared.get('object'), { value: 2 });
    });
    test(format + ': native Keyv bridge retains relative TTL and namespace scoped clear', async (context) => {
        const { createKeyv, KeyvCacheableMemory } = await loadFormat('@cacheable/memory', format);
        const { Keyv, KeyvBridgeAdapter } = await loadFormat('keyv', format);
        const keyv = createKeyv({ namespace: 'one' });
        assert.equal(keyv.serialization, undefined);
        assert.ok(keyv.store instanceof KeyvBridgeAdapter);
        assert.ok(keyv.store.store instanceof KeyvCacheableMemory);
        assert.equal(keyv.store.store.hasMany instanceof Function, true);
        await keyv.set('same', { value: 'one' }, 200);
        const expiry = (await keyv.getRaw('same')).expires;
        assert.ok(expiry > Date.now());
        keyv.namespace = 'two';
        await keyv.set('same', { value: 'two' });
        await keyv.clear();
        assert.equal(await keyv.get('same'), undefined);
        keyv.namespace = 'one';
        assert.deepEqual(await keyv.get('same'), { value: 'one' });
        assert.deepEqual(await keyv.getMany(['same', 'absent', 'same']), [
            { value: 'one' },
            undefined,
            { value: 'one' },
        ]);
        context.mock.method(Date, 'now', () => expiry + 1);
        assert.equal(await keyv.get('same'), undefined);
        assert.equal(await keyv.has('same'), false);
        const independent = new Keyv();
        assert.equal(independent.throwOnEmptyListeners, true, 'factory policy must not weaken current Keyv globally');
    });
    test(format + ': genuine current Keyv detection and boolean batch boundary', async () => {
        const { Cacheable } = await loadFormat('cacheable', format);
        const { isKeyvInstance } = await loadFormat('@cacheable/utils', format);
        const { Keyv, KeyvMemoryAdapter } = await loadFormat('keyv', format);
        const primary = new Keyv();
        assert.equal(isKeyvInstance(primary), true);
        assert.equal(isKeyvInstance(new Map()), false);
        assert.equal(isKeyvInstance({ get() {}, set() {} }), false);
        const { Keyv: ForeignKeyv } = await loadFormat('keyv', format === 'cjs' ? 'esm' : 'cjs');
        const foreign = new ForeignKeyv();
        assert.equal(foreign instanceof Keyv, false);
        assert.equal(
            isKeyvInstance(foreign),
            true,
            'genuine current instance from the other shipped module format must be recognized'
        );
        assert.equal(new Cacheable({ primary: foreign }).primary, foreign);
        const cache = new Cacheable({ primary });
        assert.equal(cache.primary, primary);
        await cache.setMany([
            { key: 'a', value: 1 },
            { key: 'b', value: 2 },
        ]);
        assert.deepEqual(await cache.getMany(['b', 'a', 'absent']), [2, 1, undefined]);
        assert.equal(await cache.deleteMany(['a', 'b']), true);
        const store = new KeyvMemoryAdapter(new Map());
        store.deleteMany = async () => [true, false];
        const partial = new Cacheable({ primary: new Keyv({ store }) });
        assert.equal(await partial.deleteMany(['a', 'b']), false, 'boolean[] must not become truthy success');
    });
}
