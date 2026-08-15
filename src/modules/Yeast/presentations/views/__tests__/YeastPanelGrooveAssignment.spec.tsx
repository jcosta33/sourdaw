import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { createGrooveTemplate } from '#/modules/MIDI/useCases';

import { type YeastState } from '../../../stores/yeastStore';
import { YeastPanel } from '../YeastPanel';

const storeMock = vi.hoisted(() => ({
    yeastState: null as YeastState | null,
    setYeastState: vi.fn(),
}));

vi.mock('../../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return storeMock.yeastState;
        },
        set: storeMock.setYeastState,
        getSnapshot: () => storeMock.yeastState,
        subscribe: () => () => undefined,
        subscribeReact: () => () => undefined,
    },
}));

vi.mock('../../../engine/yeastRuntime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/yeastRuntime')>()),
    applyYeastRuntimeProjection: vi.fn().mockResolvedValue(undefined),
    getYeastRuntimeStatus: vi.fn().mockReturnValue('ready'),
    getYeastRuntimeError: vi.fn().mockReturnValue(undefined),
}));

const GROOVE_PROCESSOR_ID = 'groove-proc-1';
const USER_TEMPLATE_ID = 'user-pocket-1';

function expandGrooveRow(): void {
    fireEvent.click(screen.getByText('Groove', { selector: 'span' }));
}

describe('YeastPanel groove assignment reactivity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        createGrooveTemplate({
            id: USER_TEMPLATE_ID,
            name: 'User pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        storeMock.yeastState = {
            processors: [{ id: GROOVE_PROCESSOR_ID, type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 3,
        };
    });

    afterEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        storeMock.yeastState = null;
    });

    it('renders straight with no assignment, then follows a store assignment without remount', () => {
        // Regression for the React Compiler defect: the panel derived the
        // assignment via an impure store read that the compiler memoized on
        // processor.id alone, so a later assignment write never re-rendered
        // the combobox (it kept 'groove-straight' and the lifecycle controls
        // never mounted). The derivation must flow through the subscribed
        // groove state instead.
        render(<YeastPanel />);
        expandGrooveRow();
        const combobox = screen.getByRole('combobox', { name: 'Groove template' }) as HTMLSelectElement;
        expect(combobox.value).toBe('groove-straight');
        expect(screen.queryByRole('textbox', { name: 'Groove template name' })).not.toBeInTheDocument();

        // The assignment lands while the panel stays mounted.
        act(() => {
            const state = grooveTemplateStore.value;
            grooveTemplateStore.set({
                ...(state ?? defaultGrooveTemplateState),
                assignments: [
                    {
                        consumerType: 'yeast-processor',
                        consumerId: `groove-consumer:yeast-rack:${GROOVE_PROCESSOR_ID}`,
                        templateId: USER_TEMPLATE_ID,
                        amount: 0.5,
                    },
                ],
            });
        });

        expect(combobox.value).toBe(USER_TEMPLATE_ID);
        expect(screen.getByRole('textbox', { name: 'Groove template name' })).toHaveValue('User pocket');
    });

    it('a legacy un-scoped assignment still binds (pre-scoping persisted state)', () => {
        const state = grooveTemplateStore.value;
        grooveTemplateStore.set({
            ...(state ?? defaultGrooveTemplateState),
            assignments: [
                {
                    consumerType: 'yeast-processor',
                    // Pre-scoping builds keyed assignments by the raw id.
                    consumerId: GROOVE_PROCESSOR_ID,
                    templateId: USER_TEMPLATE_ID,
                    amount: 0.5,
                },
            ],
        });

        render(<YeastPanel />);
        expandGrooveRow();
        const combobox = screen.getByRole('combobox', { name: 'Groove template' }) as HTMLSelectElement;
        expect(combobox.value).toBe(USER_TEMPLATE_ID);
        expect(screen.getByRole('textbox', { name: 'Groove template name' })).toHaveValue('User pocket');
    });
});
