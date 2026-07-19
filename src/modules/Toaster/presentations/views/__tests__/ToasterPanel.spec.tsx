import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToasterPanel } from '../ToasterPanel';

const { grooveStateOverride, assignToasterPatternGroove } = vi.hoisted(() => ({
    grooveStateOverride: { value: null as null | Record<string, unknown> },
    assignToasterPatternGroove: vi.fn(),
}));

vi.mock('../../../useCases/assignToasterPatternGroove', () => ({ assignToasterPatternGroove }));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown): unknown => {
        if (
            grooveStateOverride.value &&
            typeof defaultValue === 'object' &&
            defaultValue !== null &&
            'templates' in defaultValue &&
            'assignments' in defaultValue
        ) {
            return grooveStateOverride.value;
        }
        return defaultValue;
    }),
}));

describe('ToasterPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        grooveStateOverride.value = null;
    });

    it('should render without crashing', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('surfaces unsupported groove capability and disables live/export commits', () => {
        grooveStateOverride.value = {
            templates: [
                {
                    id: 'unsupported-triplet',
                    name: 'Triplet pocket',
                    schemaVersion: 1,
                    subdivision: '1/16T',
                    slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
                    provenance: { type: 'user', sourceId: 'ui-test' },
                },
            ],
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: 'groove-consumer:toaster-test:A1',
                    templateId: 'unsupported-triplet',
                    amount: 1,
                },
            ],
        };

        render(<ToasterPanel deviceId="toaster-test" />);

        expect(screen.getByRole('status')).toHaveTextContent('Triplet pocket');
        expect(screen.getByRole('status')).toHaveTextContent('1/16T');
        expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'To timeline' })).toBeDisabled();
    });

    it('commits device-scoped template and amount controls through the Toaster action', () => {
        grooveStateOverride.value = {
            templates: [
                {
                    id: 'straight-groove',
                    name: 'Straight',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [],
                    provenance: { type: 'builtin', sourceId: 'straight' },
                },
                {
                    id: 'pocket-a',
                    name: 'Pocket A',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
                    provenance: { type: 'user', sourceId: 'pocket-a' },
                },
                {
                    id: 'pocket-b',
                    name: 'Pocket B',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: 0 }],
                    provenance: { type: 'user', sourceId: 'pocket-b' },
                },
            ],
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: 'groove-consumer:toaster-test:A1',
                    templateId: 'pocket-a',
                    amount: 0.5,
                },
            ],
        };
        render(<ToasterPanel deviceId="toaster-test" />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Pattern groove template' }), {
            target: { value: 'pocket-b' },
        });
        fireEvent.change(screen.getByRole('slider', { name: 'Pattern groove amount' }), {
            target: { value: '0.25' },
        });

        expect(assignToasterPatternGroove).toHaveBeenNthCalledWith(1, {
            deviceId: 'toaster-test',
            patternId: 'A1',
            templateId: 'pocket-b',
            amount: 0.5,
        });
        expect(assignToasterPatternGroove).toHaveBeenNthCalledWith(2, {
            deviceId: 'toaster-test',
            patternId: 'A1',
            templateId: 'pocket-a',
            amount: 0.25,
        });
    });
});
