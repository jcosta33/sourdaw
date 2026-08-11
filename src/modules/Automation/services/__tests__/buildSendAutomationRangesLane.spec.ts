import { describe, expect, it } from 'vitest';

import { buildSendAutomationRangesLane } from '../buildSendAutomationRangesLane';

describe('buildSendAutomationRangesLane', () => {
    it('builds exact half-open final-four-bar ramps and restores the send base at each section end', () => {
        const baseLevel = 10 ** (-18 / 20);
        const targetLevel = 10 ** (-10 / 20);

        const lane = buildSendAutomationRangesLane({
            trackId: 'track-bgv/high',
            busId: 'bus-plate shared',
            busName: 'Backing Vocal Plate',
            baseLevel,
            targetLevelDb: -10,
            ranges: [
                {
                    sectionId: 'section-chorus-one',
                    sectionName: 'Chorus One',
                    startBeat: 16,
                    endBeat: 48,
                    automationStartBeat: 32,
                },
                {
                    sectionId: 'section-chorus-two',
                    sectionName: 'Chorus Two',
                    startBeat: 64,
                    endBeat: 96,
                    automationStartBeat: 80,
                },
            ],
        });

        expect(lane).toEqual({
            id: 'auto-send-track-bgv%2Fhigh-bus-plate%20shared',
            trackId: 'track-bgv/high',
            parameterId: 'send:bus-plate shared',
            parameterName: 'Send: Backing Vocal Plate',
            points: [
                { beat: 0, value: baseLevel, curve: 'step', tension: 0 },
                { beat: 32, value: baseLevel, curve: 'linear', tension: 0 },
                { beat: 48, value: targetLevel, curve: 'step', tension: 0 },
                { beat: 48, value: baseLevel, curve: 'step', tension: 0 },
                { beat: 80, value: baseLevel, curve: 'linear', tension: 0 },
                { beat: 96, value: targetLevel, curve: 'step', tension: 0 },
                { beat: 96, value: baseLevel, curve: 'step', tension: 0 },
            ],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        });
    });

    it('starts the first ramp at beat zero without a duplicate pre-range point', () => {
        const lane = buildSendAutomationRangesLane({
            trackId: 'track-bgv',
            busId: 'bus-plate',
            busName: 'Plate',
            baseLevel: 0.1,
            targetLevelDb: -10,
            ranges: [
                {
                    sectionId: 'section-chorus',
                    sectionName: 'Chorus',
                    startBeat: 0,
                    endBeat: 16,
                    automationStartBeat: 0,
                },
            ],
        });

        expect(lane.points).toHaveLength(3);
        expect(lane.points[0]).toEqual({ beat: 0, value: 0.1, curve: 'linear', tension: 0 });
    });
});
