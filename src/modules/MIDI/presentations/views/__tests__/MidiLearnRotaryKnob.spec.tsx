import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { midiLearnStore, type MidiLearnState } from '../../../stores/midiLearnStore';
import { startMidiLearn } from '../../../useCases/midiLearn/startMidiLearn';
import { MidiLearnRotaryKnob } from '../MidiLearnRotaryKnob';

const baseMidiState: MidiLearnState = {
    mappings: [],
    isLearning: false,
    learningTarget: null,
};

vi.mock('../../../useCases/midiLearn/startMidiLearn', () => ({
    startMidiLearn: vi.fn(),
}));

const getRoot = (container: HTMLElement): HTMLElement => {
    const root = container.firstElementChild;
    if (!(root instanceof HTMLElement)) {
        throw new TypeError('Expected a MidiLearnRotaryKnob root');
    }
    return root;
};

describe('MidiLearnRotaryKnob', () => {
    beforeEach(() => {
        midiLearnStore.set({ ...baseMidiState });
        vi.mocked(startMidiLearn).mockClear();
    });

    it('projects the active MIDI learn state onto the matching target', () => {
        midiLearnStore.set({
            mappings: [],
            isLearning: true,
            learningTarget: {
                targetType: 'fermenterGlobalParam',
                trackId: 'global',
                paramId: 'cutoff',
            },
        });

        const { container } = render(<MidiLearnRotaryKnob value={50} onChange={vi.fn()} paramId="cutoff" />);

        expect(container.querySelector('.border-dashed')).toBeInTheDocument();
    });

    it('projects an existing mapping onto the matching target', () => {
        midiLearnStore.set({
            mappings: [
                {
                    id: 'mapping-1',
                    channel: 1,
                    cc: 74,
                    targetType: 'deviceParam',
                    trackId: 'track-1',
                    deviceId: 'device-1',
                    paramId: 'cutoff',
                    minValue: 0,
                    maxValue: 1,
                },
            ],
            isLearning: false,
            learningTarget: null,
        });

        const { container } = render(
            <MidiLearnRotaryKnob
                value={50}
                onChange={vi.fn()}
                paramId="cutoff"
                targetType="deviceParam"
                trackId="track-1"
                deviceId="device-1"
            />
        );

        expect(container.querySelector('.size-2.rounded-full')).toBeInTheDocument();
    });

    it('does not project another target with the same parameter id', () => {
        midiLearnStore.set({
            mappings: [
                {
                    id: 'mapping-1',
                    channel: 1,
                    cc: 74,
                    targetType: 'deviceParam',
                    trackId: 'track-1',
                    deviceId: 'device-1',
                    paramId: 'cutoff',
                    minValue: 0,
                    maxValue: 1,
                },
            ],
            isLearning: true,
            learningTarget: {
                targetType: 'deviceParam',
                trackId: 'track-1',
                deviceId: 'device-1',
                paramId: 'cutoff',
            },
        });

        const { container } = render(
            <MidiLearnRotaryKnob
                value={50}
                onChange={vi.fn()}
                paramId="cutoff"
                targetType="deviceParam"
                trackId="track-2"
                deviceId="device-2"
            />
        );

        expect(container.querySelector('.border-dashed')).not.toBeInTheDocument();
        expect(container.querySelector('.size-2.rounded-full')).not.toBeInTheDocument();
    });

    it('starts MIDI learn from the context menu with the target identity', () => {
        const { container } = render(
            <MidiLearnRotaryKnob
                value={50}
                onChange={vi.fn()}
                paramId="cutoff"
                targetType="deviceParam"
                trackId="track-1"
                deviceId="device-1"
            />
        );

        fireEvent.contextMenu(getRoot(container));

        expect(startMidiLearn).toHaveBeenCalledWith({
            targetType: 'deviceParam',
            paramId: 'cutoff',
            trackId: 'track-1',
            deviceId: 'device-1',
        });
    });
});
