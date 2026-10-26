import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPreferences, type Preferences } from '../../models/Preferences';
import { preferencesStore } from '../../stores/preferencesStore';
import { onSoloModePreferenceApplied } from '../onSoloModePreferenceApplied';
import { updatePreferences } from '../updatePreferences';

const mocks = vi.hoisted(() => ({
    preferencesStoreValue: { value: null as Preferences | null },
    preferencesStoreSet: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        get value() {
            return mocks.preferencesStoreValue.value;
        },
        trySet: mocks.preferencesStoreSet,
    },
}));

describe('updatePreferences', () => {
    let unsubscribe: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preferencesStoreValue.value = { ...defaultPreferences, theme: 'dark', soloMode: 'sip' };
    });

    afterEach(() => {
        unsubscribe?.();
        unsubscribe = null;
    });

    it('should merge the patch into preferencesStore', () => {
        updatePreferences({ patch: { theme: 'light' } });

        expect(preferencesStore.trySet).toHaveBeenCalledWith({
            ...defaultPreferences,
            theme: 'light',
            soloMode: 'sip',
        });
    });

    it.each([
        [0.82, 0.82],
        [-0.3, 0],
        [1.7, 1],
        [Number.NaN, 0.5],
        [Number.POSITIVE_INFINITY, 0.5],
    ])('normalizes Elastic transient sensitivity %s before writing %s', (input, expected) => {
        updatePreferences({ patch: { elasticTransientSensitivity: input } });
        expect(preferencesStore.trySet).toHaveBeenCalledWith({
            ...defaultPreferences,
            theme: 'dark',
            soloMode: 'sip',
            elasticTransientSensitivity: expected,
        });
    });

    it('writes soloMode into the preferences store when the patch changes it', () => {
        updatePreferences({ patch: { soloMode: 'pfl' } });

        expect(preferencesStore.trySet).toHaveBeenCalledWith({
            ...defaultPreferences,
            theme: 'dark',
            soloMode: 'pfl',
        });
    });

    it('reports an explicit same-value solo choice after the owner write even when storage refuses durability', () => {
        const order: string[] = [];
        mocks.preferencesStoreSet.mockImplementation(() => {
            order.push('write');
            return false;
        });
        unsubscribe = onSoloModePreferenceApplied(({ soloMode }) => {
            order.push(`applied:${soloMode}`);
        });

        updatePreferences({ patch: { soloMode: 'sip' } });

        expect(order).toEqual(['write', 'applied:sip']);
    });

    it('does not report a solo choice for an unrelated preference patch', () => {
        const applied = vi.fn();
        unsubscribe = onSoloModePreferenceApplied(applied);

        updatePreferences({ patch: { elasticTransientSensitivity: 0.82 } });

        expect(applied).not.toHaveBeenCalled();
    });

    it.each([0.5, 1.25, 2])('should preserve a supported UI scale of %s', (uiScale) => {
        updatePreferences({ patch: { uiScale } });

        expect(preferencesStore.trySet).toHaveBeenCalledWith({
            ...defaultPreferences,
            theme: 'dark',
            soloMode: 'sip',
            uiScale,
        });
    });

    it.each([0, -1, 2.01, 100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'should replace an unsupported UI scale of %s with the default',
        (uiScale) => {
            updatePreferences({ patch: { uiScale } });

            expect(preferencesStore.trySet).toHaveBeenCalledWith({
                ...defaultPreferences,
                theme: 'dark',
                soloMode: 'sip',
                uiScale: defaultPreferences.uiScale,
            });
        }
    );
});
