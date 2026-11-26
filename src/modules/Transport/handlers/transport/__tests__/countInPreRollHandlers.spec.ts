import { beforeEach, describe, expect, it } from 'vitest';

import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { defaultTransportState } from '../../../models/TransportState';
import { transportStore } from '../../../stores/transportStore';
import { handleSetCountInBars } from '../handleSetCountInBars';
import { handleSetPreRollBars } from '../handleSetPreRollBars';
import { handleToggleCountIn } from '../handleToggleCountIn';
import { handleTogglePreRoll } from '../handleTogglePreRoll';

type FlagSuite<Action extends AppAction> = {
    type: Action['type'];
    handler: SuiteHandler<Action>;
    make: (payload?: { enabled?: boolean; expectedEnabled?: boolean }) => Action;
    key: 'countInEnabled' | 'preRollEnabled';
};

type SuiteHandler<Action extends AppAction> = {
    execute: (action: Action) => unknown;
    isNoop?: (action: Action) => boolean;
    describe: (action: Action, context?: HandlerValidationContext) => unknown;
    validate?: (action: Action, context: HandlerValidationContext) => boolean;
    validationRefusalReason?: (action: Action, context: HandlerValidationContext) => string | null;
    canReapplyAfterDivergence?: (action: Action, context?: HandlerValidationContext) => boolean;
};

type BarsSuite<Action extends AppAction> = {
    type: Action['type'];
    handler: SuiteHandler<Action>;
    make: (bars: number, expectedBars?: number) => Action;
    key: 'countInBars' | 'preRollBars';
    initial: number;
};

function batchOf(actions: readonly AppAction[], actionIndex: number) {
    return { actions, actionIndex };
}

beforeEach(() => {
    transportStore.set(defaultTransportState);
});

function flagSuite<Action extends AppAction>({ type, handler, make: action, key }: FlagSuite<Action>) {
    describe(type, () => {
        it('sets the stated state and leaves a state that already holds alone', async () => {
            await handler.execute(action({ enabled: true }));
            expect(transportStore.value?.[key]).toBe(true);

            expect(handler.isNoop?.(action({ enabled: true }))).toBe(true);
            expect(handler.isNoop?.(action({ enabled: false }))).toBe(false);
            expect(await handler.execute(action({ enabled: true }))).toEqual({ status: 'no-write' });
            expect(transportStore.value?.[key]).toBe(true);
        });

        it('still flips the current state when no state is stated, as the transport bar does', async () => {
            expect(handler.isNoop?.(action())).toBe(false);

            await handler.execute(action());
            expect(transportStore.value?.[key]).toBe(true);
            await handler.execute(action());
            expect(transportStore.value?.[key]).toBe(false);
        });

        it('describes a guarded inverse and redo for an explicit state', () => {
            const forward = action({ enabled: true });

            expect(handler.describe(forward, batchOf([forward], 0))).toMatchObject({
                inverseAction: { type, payload: { enabled: false, expectedEnabled: true } },
                redoAction: { type, payload: { enabled: true, expectedEnabled: false } },
            });
        });

        it('describes the inverse of a bare toggle from the state it will flip', () => {
            transportStore.set({ ...defaultTransportState, [key]: true });
            const forward = action();

            expect(handler.describe(forward, batchOf([forward], 0))).toMatchObject({
                inverseAction: { type, payload: { enabled: true, expectedEnabled: false } },
                redoAction: { type, payload: { enabled: false, expectedEnabled: true } },
            });
        });

        it('describes a later action of a batch from what the earlier one leaves, not the live state', () => {
            const first = action({ enabled: true });
            const second = action({ enabled: false });
            const batch = [first, second];

            expect(handler.describe(second, batchOf(batch, 1))).toMatchObject({
                inverseAction: { type, payload: { enabled: true, expectedEnabled: false } },
            });

            const bareFirst = action();
            const bareSecond = action();
            expect(handler.describe(bareSecond, batchOf([bareFirst, bareSecond], 1))).toMatchObject({
                inverseAction: { type, payload: { enabled: true, expectedEnabled: false } },
                redoAction: { type, payload: { enabled: false, expectedEnabled: true } },
            });
        });

        it('reports a restore whose target state already holds as no-write, and only a guarded restore may reapply', async () => {
            const restore = action({ enabled: false, expectedEnabled: true });

            expect(await handler.execute(restore)).toEqual({ status: 'no-write' });
            expect(transportStore.value?.[key]).toBe(false);
            expect(handler.canReapplyAfterDivergence?.(restore)).toBe(true);
            expect(handler.canReapplyAfterDivergence?.(action({ enabled: true }))).toBe(false);
        });

        it('applies a restore whose expected state still holds', async () => {
            transportStore.set({ ...defaultTransportState, [key]: true });

            expect(await handler.execute(action({ enabled: false, expectedEnabled: true }))).toEqual({
                status: 'written',
            });
            expect(transportStore.value?.[key]).toBe(false);
        });

        it('refuses without transport state', () => {
            transportStore.set(null);
            const forward = action({ enabled: true });

            expect(handler.validate?.(forward, batchOf([forward], 0))).toBe(false);
            expect(handler.validationRefusalReason?.(forward, batchOf([forward], 0))).toBe(
                'Transport state is not available'
            );
        });
    });
}

flagSuite({
    type: 'toggleCountIn',
    handler: handleToggleCountIn,
    make: (payload) => ({ type: 'toggleCountIn', payload }),
    key: 'countInEnabled',
});
flagSuite({
    type: 'togglePreRoll',
    handler: handleTogglePreRoll,
    make: (payload) => ({ type: 'togglePreRoll', payload }),
    key: 'preRollEnabled',
});

function barsSuite<Action extends AppAction>({ type, handler, make: action, key, initial }: BarsSuite<Action>) {
    describe(type, () => {
        it('describes a guarded inverse and redo that restore the exact previous bars', () => {
            const forward = action(4);

            expect(handler.describe(forward, batchOf([forward], 0))).toMatchObject({
                inverseAction: { type, payload: { bars: initial, expectedBars: 4 } },
                redoAction: { type, payload: { bars: 4, expectedBars: initial } },
            });
        });

        it('records the bars actually written when the request is out of range', async () => {
            const forward = action(20);
            const description = handler.describe(forward, batchOf([forward], 0));

            expect(description).toMatchObject({
                inverseAction: { type, payload: { bars: initial, expectedBars: 8 } },
                redoAction: { type, payload: { bars: 8, expectedBars: initial } },
            });
            await handler.execute(forward);
            expect(transportStore.value?.[key]).toBe(8);
        });

        it('describes a later action of a batch from what the earlier one leaves', () => {
            const first = action(5);
            const second = action(3);

            expect(handler.describe(second, batchOf([first, second], 1))).toMatchObject({
                inverseAction: { type, payload: { bars: 5, expectedBars: 3 } },
            });
        });

        it('refuses a restore whose expected bars changed since, writing nothing', async () => {
            const restore = action(initial, 4);

            expect(await handler.execute(restore)).toEqual({ status: 'conflict' });
            expect(transportStore.value?.[key]).toBe(initial);
            expect(handler.canReapplyAfterDivergence?.(restore)).toBe(true);
            expect(handler.canReapplyAfterDivergence?.(action(4))).toBe(false);
        });

        it('applies a restore whose expected bars still hold', async () => {
            transportStore.set({ ...defaultTransportState, [key]: 4 });

            expect(await handler.execute(action(initial, 4))).toEqual({ status: 'written' });
            expect(transportStore.value?.[key]).toBe(initial);
        });

        it('refuses without transport state', () => {
            transportStore.set(null);
            const forward = action(3);

            expect(handler.validate?.(forward, batchOf([forward], 0))).toBe(false);
            expect(handler.validationRefusalReason?.(forward, batchOf([forward], 0))).toBe(
                'Transport state is not available'
            );
        });
    });
}

barsSuite({
    type: 'setCountInBars',
    handler: handleSetCountInBars,
    make: (bars, expectedBars) => ({ type: 'setCountInBars', payload: { bars, expectedBars } }),
    key: 'countInBars',
    initial: 1,
});
barsSuite({
    type: 'setPreRollBars',
    handler: handleSetPreRollBars,
    make: (bars, expectedBars) => ({ type: 'setPreRollBars', payload: { bars, expectedBars } }),
    key: 'preRollBars',
    initial: 2,
});
