import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: {
        get value() {
            return mockAutomation;
        },
    },
}));

vi.mock('../../../services/classifyRenderSilence', () => ({
    classifyRenderSilence: vi.fn(),
}));

vi.mock('../../../services/isSilentAudioBuffer', () => ({
    isSilentAudioBuffer: vi.fn(),
}));

import { classifyRenderSilence } from '../../../services/classifyRenderSilence';
import { isSilentAudioBuffer } from '../../../services/isSilentAudioBuffer';
import { detectSilentBake } from '../detectSilentBake';

const mockedClassify = vi.mocked(classifyRenderSilence);
const mockedIsSilent = vi.mocked(isSilentAudioBuffer);

let mockAutomation: { lanes: unknown[] } | null = null;

function makeTrack(id: string = 't1', name: string = 'Kick') {
    return { id, name } as never;
}

function makeTally(notes = 0, buffers: string[] = [], withheldDeviceTypes: string[] = []) {
    return { scheduledNotes: notes, scheduledBuffers: buffers, withheldDeviceTypes } as never;
}

function makeBuffer(silent: boolean) {
    return { getChannelData: () => new Float32Array(10).fill(silent ? 0 : 0.5) } as never;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockAutomation = { lanes: [] };
});

describe('detectSilentBake — early returns', () => {
    it('returns silentBake=false when nothing was scheduled', () => {
        const result = detectSilentBake({
            track: makeTrack(),
            buffer: makeBuffer(true),
            tally: makeTally(0, []),
            bakedFaderGain: 0.8,
            bakesAutomation: false,
            operation: 'Freeze',
        });
        expect(result).toEqual({ silentBake: false });
        expect(mockedIsSilent).not.toHaveBeenCalled();
    });

    it('refuses a withheld device ahead of every abstention', () => {
        mockedIsSilent.mockReturnValue(true);
        // The abstention that used to swallow this: `classifyRenderSilence`
        // stands down for any track with an enabled lane while automation is
        // baked, and `freezeTrack` always bakes automation. If the withheld
        // verdict were read after it, this call would return silentBake=false.
        mockedClassify.mockReturnValue({ unexpected: false, abstention: 'automation-not-modelled' });
        mockAutomation = { lanes: [{ trackId: 't1', enabled: true, points: [{}] }] };

        const result = detectSilentBake({
            track: makeTrack(),
            buffer: makeBuffer(true),
            tally: makeTally(4, [], ['grand-boule']),
            bakedFaderGain: 1,
            bakesAutomation: true,
            operation: 'Freeze',
        });

        expect(result).toMatchObject({ silentBake: true });
        expect(result).toMatchObject({ message: expect.stringContaining('withheld from this build') });
        // The silence advice must not appear: it tells the user to play the
        // track back and try again, which can never succeed for a device the
        // build does not contain.
        expect(result).not.toMatchObject({ message: expect.stringContaining('Play the track back') });
        // Decided without consulting the classifier at all — the verdict is a
        // fact about the build, not a reading of the audio.
        expect(mockedClassify).not.toHaveBeenCalled();
    });

    it('returns silentBake=false when buffer is not silent', () => {
        mockedIsSilent.mockReturnValue(false);
        const result = detectSilentBake({
            track: makeTrack(),
            buffer: makeBuffer(false),
            tally: makeTally(5, []),
            bakedFaderGain: 0.8,
            bakesAutomation: false,
            operation: 'Bounce',
        });
        expect(result).toEqual({ silentBake: false });
    });
});

describe('detectSilentBake — expected silence', () => {
    it('returns silentBake=false when classifyRenderSilence says not unexpected', () => {
        mockedIsSilent.mockReturnValue(true);
        mockedClassify.mockReturnValue({ unexpected: false } as never);
        const result = detectSilentBake({
            track: makeTrack(),
            buffer: makeBuffer(true),
            tally: makeTally(3, ['b1']),
            bakedFaderGain: 0,
            bakesAutomation: false,
            operation: 'Freeze',
        });
        expect(result).toEqual({ silentBake: false });
    });
});

describe('detectSilentBake — silent bake detected', () => {
    it('returns silentBake=true with message containing track name and tally', () => {
        mockedIsSilent.mockReturnValue(true);
        mockedClassify.mockReturnValue({ unexpected: true } as never);
        const result = detectSilentBake({
            track: makeTrack('t1', 'Snare'),
            buffer: makeBuffer(true),
            tally: makeTally(2, ['b1']),
            bakedFaderGain: 0.8,
            bakesAutomation: true,
            operation: 'Freeze',
        });
        expect(result.silentBake).toBe(true);
        if (result.silentBake) {
            expect(result.message).toContain('Snare');
            expect(result.message).toContain('2 notes');
            expect(result.message).toContain('1 audio clip');
            expect(result.message).toContain('Freeze');
        }
    });

    it('uses singular "note" for tally with 1 note', () => {
        mockedIsSilent.mockReturnValue(true);
        mockedClassify.mockReturnValue({ unexpected: true } as never);
        const result = detectSilentBake({
            track: makeTrack(),
            buffer: makeBuffer(true),
            tally: makeTally(1, []),
            bakedFaderGain: 0.8,
            bakesAutomation: false,
            operation: 'Bounce',
        });
        if (result.silentBake) {
            expect(result.message).toContain('1 note');
            expect(result.message).not.toContain('1 notes');
        }
    });
});

describe('detectSilentBake — automation lane check', () => {
    it('passes hasEnabledAutomationLanes result to classifyRenderSilence', () => {
        mockAutomation = { lanes: [{ trackId: 't1', enabled: true, points: [{ beat: 0 }] }] };
        mockedIsSilent.mockReturnValue(true);
        mockedClassify.mockReturnValue({ unexpected: false } as never);
        detectSilentBake({
            track: makeTrack('t1'),
            buffer: makeBuffer(true),
            tally: makeTally(1, []),
            bakedFaderGain: 0.8,
            bakesAutomation: true,
            operation: 'Freeze',
        });
        const callArg = mockedClassify.mock.calls[0]?.[0] as { hasAutomationLanes: boolean };
        expect(callArg.hasAutomationLanes).toBe(true);
    });

    it('returns false for automation lanes on other tracks', () => {
        mockAutomation = { lanes: [{ trackId: 't2', enabled: true, points: [{ beat: 0 }] }] };
        mockedIsSilent.mockReturnValue(true);
        mockedClassify.mockReturnValue({ unexpected: false } as never);
        detectSilentBake({
            track: makeTrack('t1'),
            buffer: makeBuffer(true),
            tally: makeTally(1, []),
            bakedFaderGain: 0.8,
            bakesAutomation: true,
            operation: 'Freeze',
        });
        const callArg = mockedClassify.mock.calls[0]?.[0] as { hasAutomationLanes: boolean };
        expect(callArg.hasAutomationLanes).toBe(false);
    });
});
