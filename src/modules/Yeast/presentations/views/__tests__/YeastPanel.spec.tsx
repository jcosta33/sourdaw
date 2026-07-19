import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore, type GrooveTemplateState } from '#/modules/MIDI/stores';

import { type YeastState } from '../../../stores/yeastStore';
import { YeastPanel } from '../YeastPanel';

const storeMock = vi.hoisted((): { grooveState: GrooveTemplateState; yeastState: YeastState | null } => ({
    grooveState: { templates: [], assignments: [] },
    yeastState: null,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue?: YeastState): YeastState | GrooveTemplateState =>
        defaultValue === undefined ? storeMock.grooveState : (storeMock.yeastState ?? defaultValue)
    ),
}));

describe('YeastPanel', () => {
    beforeEach(() => {
        storeMock.grooveState = structuredClone(defaultGrooveTemplateState);
        storeMock.yeastState = null;
        vi.clearAllMocks();
    });

    it('should render the default rack when the store has no value', () => {
        render(<YeastPanel />);

        expect(screen.getByText('Note flow')).toBeInTheDocument();
        expect(screen.getByText('Phrase view')).toBeInTheDocument();
        expect(screen.getByText(/No processors yet/)).toBeInTheDocument();
    });

    it('should expose the default panel controls', () => {
        render(<YeastPanel />);

        expect(screen.getByRole('button', { name: 'Arp Off' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Latch' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ Arpeggiator' })).toBeInTheDocument();
        expect(screen.getByText('Mode')).toBeInTheDocument();
        expect(screen.getByText('Rate')).toBeInTheDocument();
    });

    it('should render stored processor rack text', () => {
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                },
                {
                    id: 'chord-1',
                    type: 'chord',
                    name: 'Harmony latch lane',
                    bypassed: true,
                },
            ],
            uiLevel: 3,
        };

        render(<YeastPanel />);

        expect(screen.getByText('Rack build')).toBeInTheDocument();
        const rack_read = screen.getByText('Rack read').closest('section');
        if (!rack_read) {
            throw new Error('Rack read section not found');
        }

        const rack_read_scope = within(rack_read);
        expect(rack_read_scope.getByText('Lead arp lane')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Harmony latch lane')).toBeInTheDocument();
        expect(rack_read_scope.getByText('arpeggiator')).toBeInTheDocument();
        expect(rack_read_scope.getByText('chord')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Bypass')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Live')).toBeInTheDocument();
    });

    it.each(['selected', 'reloaded', 'migrated'] as const)(
        'should display the $0 scoped groove assignment',
        (source) => {
            const templateId = `${source}-groove`;
            storeMock.yeastState = {
                processors: [
                    {
                        id: 'groove-processor',
                        type: 'groove',
                        name: `${source} groove lane`,
                        bypassed: false,
                    },
                ],
                uiLevel: 3,
            };
            storeMock.grooveState = {
                templates: [
                    ...structuredClone(defaultGrooveTemplateState.templates),
                    {
                        id: templateId,
                        name: `${source} groove`,
                        schemaVersion: 1,
                        subdivision: '1/16',
                        slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
                        provenance: { type: 'user', sourceId: source },
                    },
                ],
                assignments: [
                    {
                        consumerType: 'yeast-processor',
                        consumerId: 'groove-consumer:yeast-rack:groove-processor',
                        templateId,
                        amount: 0.75,
                    },
                ],
            };
            grooveTemplateStore.set(storeMock.grooveState);

            render(<YeastPanel />);
            fireEvent.click(screen.getAllByText(`${source} groove lane`)[0]!);

            expect(screen.getByRole('combobox', { name: 'Groove template' })).toHaveValue(templateId);
        }
    );
});
