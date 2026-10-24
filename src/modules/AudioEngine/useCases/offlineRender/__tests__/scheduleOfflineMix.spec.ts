import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type buildOfflineWebAudioGraph } from '../buildOfflineWebAudioGraph';
import { type captureOfflineRenderInput } from '../captureOfflineRenderInput';
import { type resolveOfflineMixPlan } from '../resolveOfflineMixPlan';
import { scheduleOfflineMix } from '../scheduleOfflineMix';
import { scheduleTrackClips } from '../scheduleTrackClips';

vi.mock('../scheduleTrackClips', () => ({ scheduleTrackClips: vi.fn(() => Promise.resolve()) }));
vi.mock('../schedulePendingSuspends', () => ({ schedulePendingSuspends: vi.fn() }));
vi.mock('../yieldToMain', () => ({ yieldToMain: vi.fn(() => Promise.resolve()) }));
vi.mock('../renderInSegments', () => ({ renderInSegments: vi.fn(() => Promise.resolve({ id: 'mix' })) }));

type MixPlan = ReturnType<typeof resolveOfflineMixPlan>;
type MixGraph = Awaited<ReturnType<typeof buildOfflineWebAudioGraph>>;

describe('scheduleOfflineMix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('hands every track the projections the composition root injected into the render, stored controllers and channel bend alike', async () => {
        const projectClipControllers = () => [];
        const projectChannelBend = () => [];
        const track = { id: 'track-1' };
        const plan = {
            scheduledTracks: [track],
            sourceTracks: [track],
            vcaMultiplierByTrackId: new Map(),
            renderContext: {
                tracks: { tracks: [track] },
                midi: {},
                durationSeconds: 1,
                defaultTempo: 120,
                changes: [],
                projectClipControllers,
                projectChannelBend,
            },
        } as unknown as MixPlan;
        const strip = { inputNode: {}, faderNode: {}, preFaderTap: {}, panNode: {} };
        const graph = {
            trackStripsById: new Map([[track.id, strip]]),
            sendAutomationParamsByTrack: new Map(),
            deviceEntriesByTrack: new Map(),
        } as unknown as MixGraph;

        await scheduleOfflineMix({
            input: {} as ReturnType<typeof captureOfflineRenderInput>,
            plan,
            graph,
            offlineCtx: {} as OfflineAudioContext,
            masterGain: {} as GainNode,
            scheduleFrame: vi.fn(),
            callbacks: {},
        });

        expect(scheduleTrackClips).toHaveBeenCalledTimes(1);
        expect(vi.mocked(scheduleTrackClips).mock.calls[0]![0].projections).toMatchObject({
            projectClipControllers,
            projectChannelBend,
        });
    });
});
