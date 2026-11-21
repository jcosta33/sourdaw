import { describe, expect, it, vi } from 'vitest';

import { emitCrumbsModeChanged, setCrumbsEventBus } from '../crumbsEventBus';

const payload = { deviceId: 'crumbs-1', mode: 'quick' } as const;

describe('crumbsEventBus', () => {
    it('refuses to emit before an emitter is registered, naming the registrar', () => {
        expect(() => emitCrumbsModeChanged(payload)).toThrow(/setCrumbsEventBus\(\) from #\/app\/bootstrap/);
    });

    it('emits through the registered emitter', () => {
        const emitter = { emit: vi.fn(() => Promise.resolve()) };
        setCrumbsEventBus(emitter);

        emitCrumbsModeChanged(payload);

        expect(emitter.emit).toHaveBeenCalledExactlyOnceWith('crumbs.modeChanged', payload);
    });

    it('replaces the registered emitter on a second fill', () => {
        const replaced = { emit: vi.fn(() => Promise.resolve()) };
        const replacement = { emit: vi.fn(() => Promise.resolve()) };
        setCrumbsEventBus(replaced);
        setCrumbsEventBus(replacement);

        emitCrumbsModeChanged(payload);

        expect(replacement.emit).toHaveBeenCalledExactlyOnceWith('crumbs.modeChanged', payload);
        expect(replaced.emit).not.toHaveBeenCalled();
    });
});
