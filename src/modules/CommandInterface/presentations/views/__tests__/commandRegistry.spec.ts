import { describe, it, expect, beforeEach, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { initRaveModels } from '#/modules/BrowserAi/useCases';

import { commandRegistry, searchCommands } from '../commandRegistry';

describe('commandRegistry', () => {
    it('should expose each command id once', () => {
        const command_counts_by_id = new Map<string, number>();

        for (const command_entry of commandRegistry) {
            const previous_count = command_counts_by_id.get(command_entry.id) ?? 0;
            command_counts_by_id.set(command_entry.id, previous_count + 1);
        }

        const duplicate_ids = Array.from(command_counts_by_id.entries())
            .filter(([, duplicate_count]) => duplicate_count > 1)
            .map(([command_id]) => command_id);

        expect(duplicate_ids).toEqual([]);
    });

    it('dispatches the clear-all MIDI mappings action', () => {
        const entry = commandRegistry.find((command) => command.id === 'clear-all-midi-mappings');

        expect(entry?.action).toEqual({ type: 'clearAllMidiMappings' });
    });
});

/**
 * RAVE architecture remains in the catalog, but release admission overrides
 * stale or manually seeded model-presence state.
 */
describe('RAVE command availability', () => {
    const RAVE_COMMAND_IDS = ['load-rave-strings', 'load-rave-vocals'];

    function offeredRaveCommandIds(): string[] {
        return searchCommands('')
            .filter((entry) => RAVE_COMMAND_IDS.includes(entry.id))
            .map((entry) => entry.id);
    }

    async function probeWithPresentModelIds(presentModelIds: string[]): Promise<void> {
        injectDependencies(initRaveModels, {
            logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            checkModelCached: vi.fn(({ modelId }: { family: string; modelId: string }) =>
                Promise.resolve(presentModelIds.includes(modelId))
            ),
        });

        await initRaveModels();
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('withholds both RAVE entries from the palette when no model weights are present', async () => {
        await probeWithPresentModelIds([]);

        expect(offeredRaveCommandIds()).toEqual([]);
    });

    it('withholds RAVE when one model appears present without release admission', async () => {
        await probeWithPresentModelIds(['rave-vocals']);

        expect(offeredRaveCommandIds()).toEqual([]);
    });

    it('withholds RAVE when every model appears present without release admission', async () => {
        await probeWithPresentModelIds(['rave-strings', 'rave-vocals']);

        expect(offeredRaveCommandIds()).toEqual([]);
    });

    it('keeps the neutral RAVE commands in the catalog', () => {
        expect(commandRegistry.filter((entry) => RAVE_COMMAND_IDS.includes(entry.id)).map((entry) => entry.id)).toEqual(
            RAVE_COMMAND_IDS
        );
    });

    it('leaves ungated commands offered regardless of RAVE model presence', async () => {
        await probeWithPresentModelIds([]);

        expect(searchCommands('').some((entry) => entry.id === 'clear-all-midi-mappings')).toBe(true);
    });
});
