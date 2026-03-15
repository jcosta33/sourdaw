/* (c) Copyright Frontify Ltd., all rights reserved. */

import { vi } from 'vitest';

import { type Logger } from '../../Logger/Logger';
import { Store } from '../Store';

const loggerDummy = {
    error: () => {},
    info: () => {},
    warn: () => {},
    debug: () => {},
} as unknown as Logger;

export class DummyStore<TDataSchema> extends Store<TDataSchema> {
    constructor(initialData?: TDataSchema) {
        super(loggerDummy, { initialData });
    }

    set = vi.fn().mockImplementation((value: TDataSchema | null) => {
        super.set(value);
    });

    get value(): TDataSchema | null {
        return super.value;
    }

    subscribe = vi.fn().mockImplementation((callback: (value: TDataSchema | null) => void) => {
        return super.subscribe(callback);
    });

    clear = vi.fn().mockImplementation(() => {
        super.clear();
    });
}
