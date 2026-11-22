import { describe, expect, it, vi } from 'vitest';

import { commandRuntimeRepairPort } from '../commandRuntimeRepairPort';

const first = vi.fn();
const second = vi.fn();

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: the unfilled read first, then the fills.
describe('commandRuntimeRepairPort', () => {
    it('throws on a read before registration, naming the registrar', () => {
        expect(() => commandRuntimeRepairPort.repair()).toThrow('commandRuntimeRepairPort.setProvider');
    });

    it('runs the registered provider', async () => {
        commandRuntimeRepairPort.setProvider(first);

        await commandRuntimeRepairPort.repair();

        expect(first).toHaveBeenCalledTimes(1);
    });

    it('rejects when the provider rejects', async () => {
        commandRuntimeRepairPort.setProvider(() => Promise.reject(new Error('runtime graph rebuild failed')));

        await expect(commandRuntimeRepairPort.repair()).rejects.toThrow('runtime graph rebuild failed');
    });

    it('runs only the second provider after a second fill', async () => {
        commandRuntimeRepairPort.setProvider(second);

        await commandRuntimeRepairPort.repair();

        expect(second).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledTimes(1);
    });
});
