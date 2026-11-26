import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { clearUndoHistory } from '../clearUndoHistory';
import { compileCommandArgumentMetadata } from '../commandArgumentMetadata';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

/**
 * The versioned executable-command route is the one an agent's command takes. Count-in and pre-roll
 * arguments the descriptor refuses must be refused there too: nothing is rounded, clamped or defaulted.
 */

type Setting = {
    readonly bars: 'setCountInBars' | 'setPreRollBars';
    readonly toggle: 'toggleCountIn' | 'togglePreRoll';
    readonly readBars: () => number | undefined;
    readonly readEnabled: () => boolean | undefined;
};

const SETTINGS: readonly Setting[] = [
    {
        bars: 'setCountInBars',
        toggle: 'toggleCountIn',
        readBars: () => transportStore.value?.countInBars,
        readEnabled: () => transportStore.value?.countInEnabled,
    },
    {
        bars: 'setPreRollBars',
        toggle: 'togglePreRoll',
        readBars: () => transportStore.value?.preRollBars,
        readEnabled: () => transportStore.value?.preRollEnabled,
    },
];

function store(type: string, args: Record<string, unknown>): string {
    // The arguments are deliberately outside the typed payload: the envelope is data a provider supplied.
    const action = { type, payload: args } as AppAction;
    return serializeVersionedCommandEnvelope(
        createVersionedCommandEnvelope({
            action,
            availableDeviceVersions: {},
            expectedEffect: 'Change the count-in or pre-roll',
            normalizedProjectRevision: 'stored-revision',
            ...compileCommandArgumentMetadata(args, type),
            reason: 'Envelope argument refusal',
        })
    );
}

/**
 * What an envelope's arguments reach: the schema at the parse boundary first, then, as a batch member,
 * the handler's own validation, which the batch route runs before any write.
 */
async function executionOutcome(serialized: string): Promise<'executed' | 'refused'> {
    const parsed = parseVersionedCommandEnvelope(serialized);
    if (parsed.status === 'invalid') {
        return 'refused';
    }
    const action = { type: parsed.envelope.operation, payload: parsed.envelope.arguments } as AppAction;
    const result = await executeAppActionBatch([action]);
    return result.status === 'conflicted' || result.status === 'rejected' ? 'refused' : 'executed';
}

describe('count-in and pre-roll envelope arguments', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, countInBars: 2, preRollBars: 3 });
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        transportStore.set(defaultTransportState);
    });

    describe.each(SETTINGS)('$bars', ({ bars, readBars }) => {
        it.each([2.5, 0, 9, -1])('refuses %s bars and writes nothing', async (requested) => {
            const before = readBars();

            expect(await executionOutcome(store(bars, { bars: requested }))).toBe('refused');
            expect(readBars()).toBe(before);
            expect(undoStore.value?.past).toEqual([]);
        });

        it.each([1, 5, 8])('writes %s bars exactly', async (requested) => {
            expect(await executionOutcome(store(bars, { bars: requested }))).toBe('executed');
            expect(readBars()).toBe(requested);
        });
    });

    describe.each(SETTINGS)('$toggle', ({ toggle, readEnabled }) => {
        it('refuses arguments that state no wanted state and flips nothing', async () => {
            const before = readEnabled();
            const serialized = store(toggle, {});

            expect(parseVersionedCommandEnvelope(serialized)).toMatchObject({ status: 'invalid' });
            expect(await executionOutcome(serialized)).toBe('refused');
            expect(readEnabled()).toBe(before);
            expect(undoStore.value?.past).toEqual([]);
        });

        it('sets the stated state', async () => {
            expect(await executionOutcome(store(toggle, { enabled: true }))).toBe('executed');
            expect(readEnabled()).toBe(true);
        });
    });
});
