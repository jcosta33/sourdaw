import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('../../../useCases/midiLearn/findMappingForTarget', () => ({
    findMappingForTarget: vi.fn(),
}));

vi.mock('../../../useCases/midiLearn/startMidiLearn', () => ({
    startMidiLearn: vi.fn(),
}));

vi.mock('../../../useCases/midiLearn/stopMidiLearn', () => ({
    stopMidiLearn: vi.fn(),
}));

vi.mock('../../../useCases/midiLearn/removeMapping', () => ({
    removeMapping: vi.fn(),
}));

import { useStore } from '#/infra/store/useStore';

import { findMappingForTarget } from '../../../useCases/midiLearn/findMappingForTarget';
import { removeMapping } from '../../../useCases/midiLearn/removeMapping';
import { startMidiLearn } from '../../../useCases/midiLearn/startMidiLearn';
import { stopMidiLearn } from '../../../useCases/midiLearn/stopMidiLearn';
import { MidiLearnButton } from '../MidiLearnButton';

const mockedUseStore = vi.mocked(useStore);
const mockedFindMapping = vi.mocked(findMappingForTarget);
const mockedStartLearn = vi.mocked(startMidiLearn);
const mockedStopLearn = vi.mocked(stopMidiLearn);
const mockedRemoveMapping = vi.mocked(removeMapping);

function renderButton(
    props: Partial<Parameters<typeof MidiLearnButton>[0]> = {},
    state: { isLearning?: boolean; learningTarget?: unknown } = {}
): void {
    mockedUseStore.mockReturnValue({
        mappings: [],
        isLearning: state.isLearning ?? false,
        learningTarget: (state.learningTarget as never) ?? null,
    });
    mockedFindMapping.mockReturnValue(undefined);
    render(<MidiLearnButton targetType="trackGain" trackId="t1" deviceId={undefined} paramId={undefined} {...props} />);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('MidiLearnButton — default state', () => {
    it('renders aria-label "MIDI Learn" when no mapping and not learning', () => {
        renderButton();
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'MIDI Learn');
    });

    it('renders "M" as button text when no mapping exists', () => {
        renderButton();
        expect(screen.getByRole('button')).toHaveTextContent('M');
    });

    it('aria-pressed is false when not learning', () => {
        renderButton();
        expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('MidiLearnButton — learning state', () => {
    it('renders aria-label "Listening for MIDI CC..." when learning this target', () => {
        renderButton(
            { targetType: 'trackGain', trackId: 't1' },
            {
                isLearning: true,
                learningTarget: { targetType: 'trackGain', trackId: 't1', deviceId: undefined, paramId: undefined },
            }
        );
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Listening for MIDI CC...');
    });

    it('aria-pressed is true when learning this target', () => {
        renderButton(
            { targetType: 'trackGain', trackId: 't1' },
            {
                isLearning: true,
                learningTarget: { targetType: 'trackGain', trackId: 't1', deviceId: undefined, paramId: undefined },
            }
        );
        expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    });

    it('does not show learning state when learning a different target', () => {
        renderButton(
            { targetType: 'trackGain', trackId: 't1' },
            {
                isLearning: true,
                learningTarget: { targetType: 'trackPan', trackId: 't2', deviceId: undefined, paramId: undefined },
            }
        );
        // Learning is active but for a different target — button should show default.
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'MIDI Learn');
        expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('MidiLearnButton — existing mapping', () => {
    it('renders the CC number when a mapping exists', () => {
        mockedUseStore.mockReturnValue({ mappings: [], isLearning: false, learningTarget: null });
        mockedFindMapping.mockReturnValue({
            id: 'm1',
            channel: 3,
            cc: 7,
            targetType: 'trackGain',
            trackId: 't1',
            minValue: 0,
            maxValue: 1,
        });
        render(<MidiLearnButton targetType="trackGain" trackId="t1" />);
        expect(screen.getByRole('button')).toHaveTextContent('7');
    });

    it('aria-label shows CC and channel (1-based) when a mapping exists', () => {
        mockedUseStore.mockReturnValue({ mappings: [], isLearning: false, learningTarget: null });
        mockedFindMapping.mockReturnValue({
            id: 'm1',
            channel: 2,
            cc: 74,
            targetType: 'deviceParam',
            trackId: 't1',
            deviceId: 'd1',
            paramId: 'cutoff',
            minValue: 0,
            maxValue: 1,
        });
        render(<MidiLearnButton targetType="deviceParam" trackId="t1" deviceId="d1" paramId="cutoff" />);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'MIDI CC 74 (ch 3)');
    });

    it('shows "M" text when mapping exists but is learning (learning takes priority)', () => {
        mockedUseStore.mockReturnValue({
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 't1', deviceId: undefined, paramId: undefined },
        });
        mockedFindMapping.mockReturnValue({
            id: 'm1',
            channel: 0,
            cc: 7,
            targetType: 'trackGain',
            trackId: 't1',
            minValue: 0,
            maxValue: 1,
        });
        render(<MidiLearnButton targetType="trackGain" trackId="t1" />);
        // Learning takes priority over mapping display.
        expect(screen.getByRole('button')).toHaveTextContent('M');
    });
});

describe('MidiLearnButton — click behavior', () => {
    it('calls startMidiLearn when clicked and not currently learning', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button'));
        expect(mockedStartLearn).toHaveBeenCalledTimes(1);
        expect(mockedStopLearn).not.toHaveBeenCalled();
    });

    it('calls stopMidiLearn when clicked while learning this target', () => {
        renderButton(
            { targetType: 'trackGain', trackId: 't1' },
            {
                isLearning: true,
                learningTarget: { targetType: 'trackGain', trackId: 't1', deviceId: undefined, paramId: undefined },
            }
        );
        fireEvent.click(screen.getByRole('button'));
        expect(mockedStopLearn).toHaveBeenCalledTimes(1);
        expect(mockedStartLearn).not.toHaveBeenCalled();
    });

    it('removes the existing mapping on Alt+click instead of starting a new learn (F-10)', () => {
        mockedUseStore.mockReturnValue({ mappings: [], isLearning: false, learningTarget: null });
        mockedFindMapping.mockReturnValue({
            id: 'm1',
            channel: 3,
            cc: 7,
            targetType: 'trackGain',
            trackId: 't1',
            minValue: 0,
            maxValue: 1,
        });
        render(<MidiLearnButton targetType="trackGain" trackId="t1" />);

        fireEvent.click(screen.getByRole('button'), { altKey: true });

        expect(mockedRemoveMapping).toHaveBeenCalledWith('m1');
        expect(mockedStartLearn).not.toHaveBeenCalled();
    });

    it('starts a new learn on Alt+click when no mapping exists yet', () => {
        renderButton();

        fireEvent.click(screen.getByRole('button'), { altKey: true });

        expect(mockedRemoveMapping).not.toHaveBeenCalled();
        expect(mockedStartLearn).toHaveBeenCalledTimes(1);
    });
});
