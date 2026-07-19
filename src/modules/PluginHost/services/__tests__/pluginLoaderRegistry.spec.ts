import { describe, it, expect } from 'vitest';

import { findPluginLoader, registerPluginLoader, type PluginAudioNodeLoader } from '../pluginLoaderRegistry';

function loaderReturning(node: AudioNode): PluginAudioNodeLoader {
    return () => Promise.resolve(node);
}

describe('pluginLoaderRegistry', () => {
    it('should return null when no registered prefix matches the plugin id', () => {
        expect(findPluginLoader('unregistered-format.some-id')).toBeNull();
    });

    it('should find the loader whose prefix matches the plugin id', async () => {
        const node = {} as AudioNode;
        registerPluginLoader('spec-a.', loaderReturning(node));

        const found = findPluginLoader('spec-a.reverb');
        if (!found) {
            throw new Error('expected a loader to be found for spec-a.reverb');
        }

        await expect(found('spec-a.reverb', {} as AudioContext)).resolves.toBe(node);
    });

    it('should not match when the plugin id does not start with the registered prefix', () => {
        registerPluginLoader('spec-b.', loaderReturning({} as AudioNode));

        expect(findPluginLoader('other.spec-b.reverb')).toBeNull();
    });

    it('should replace the loader when the same prefix is registered again', async () => {
        const first = {} as AudioNode;
        const second = {} as AudioNode;
        registerPluginLoader('spec-c.', loaderReturning(first));
        registerPluginLoader('spec-c.', loaderReturning(second));

        const found = findPluginLoader('spec-c.delay');
        if (!found) {
            throw new Error('expected a loader to be found for spec-c.delay');
        }

        await expect(found('spec-c.delay', {} as AudioContext)).resolves.toBe(second);
    });

    it('should resolve to the first-registered matching loader when two registered prefixes both match', async () => {
        const outer = {} as AudioNode;
        const inner = {} as AudioNode;
        registerPluginLoader('spec-d.', loaderReturning(outer));
        registerPluginLoader('spec-d.nested.', loaderReturning(inner));

        const found = findPluginLoader('spec-d.nested.delay');
        if (!found) {
            throw new Error('expected a loader to be found for spec-d.nested.delay');
        }

        await expect(found('spec-d.nested.delay', {} as AudioContext)).resolves.toBe(outer);
    });
});
