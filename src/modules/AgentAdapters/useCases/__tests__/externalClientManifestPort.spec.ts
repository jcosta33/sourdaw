import { describe, expect, it } from 'vitest';

import { externalClientManifestPort } from '../externalClientManifestPort';

type Manifest = ReturnType<typeof externalClientManifestPort.read>;
const first: Manifest = [];
const second: Manifest = [];

describe('externalClientManifestPort', () => {
    it('refuses to read before a provider is registered, naming the registrar', () => {
        expect(() => externalClientManifestPort.read()).toThrow(/setProvider\(\) from #\/app\/bootstrap/);
    });

    it('reads through the registered provider', () => {
        externalClientManifestPort.setProvider(() => first);

        expect(externalClientManifestPort.read()).toBe(first);
    });

    it('replaces the registered provider on a second fill', () => {
        externalClientManifestPort.setProvider(() => second);

        expect(externalClientManifestPort.read()).toBe(second);
    });
});
