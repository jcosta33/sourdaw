import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeBackingVocalPlatePlan } from '../bridgeBackingVocalPlatePlan';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 0,
    metronomeEnabled: false,
    metronomeVolume: 1,
    masterGain: 1,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('bridgeBackingVocalPlatePlan', () => {
    it.each(['automateSendRanges', 'renderProjectSections'])(
        'keeps %s unavailable outside the selected workflow admission',
        (name) => {
            const calls = [
                {
                    name,
                    arguments:
                        name === 'automateSendRanges'
                            ? {
                                  trackIds: ['track-bgv'],
                                  busId: 'bus-plate',
                                  sectionIds: ['section-chorus'],
                                  tailBars: 4,
                                  targetLevelDb: -10,
                              }
                            : { sectionIds: ['section-chorus'] },
                },
            ];

            expect(bridgeBackingVocalPlatePlan({ calls, context, selected: false })).toEqual({
                status: 'rejected',
                reason: `${name} is available only through the selected backing-vocal plate workflow`,
            });
        }
    );
});
