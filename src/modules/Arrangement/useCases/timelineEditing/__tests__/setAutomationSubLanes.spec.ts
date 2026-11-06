import { afterEach, describe, expect, it } from 'vitest';

import { defaultTimelineEditingState, timelineEditingStore } from '../../../stores/timelineEditingStore';
import { setAutomationSubLanes } from '../setAutomationSubLanes';

describe('setAutomationSubLanes', () => {
    afterEach(() => {
        timelineEditingStore.set(defaultTimelineEditingState);
    });

    it('does not update when the timeline editing state is missing', () => {
        timelineEditingStore.set(null);

        setAutomationSubLanes('t1', ['gain']);

        expect(timelineEditingStore.value).toBeNull();
    });

    it('writes the param ids for the given track, preserving other tracks', () => {
        timelineEditingStore.set({ ...defaultTimelineEditingState, automationSubLanes: { t2: ['existing'] } });

        setAutomationSubLanes('t1', ['gain', 'pan']);

        expect(timelineEditingStore.value?.automationSubLanes).toEqual({ t2: ['existing'], t1: ['gain', 'pan'] });
    });

    it('replaces the param ids of a track that already has sub-lanes', () => {
        timelineEditingStore.set({ ...defaultTimelineEditingState, automationSubLanes: { t1: ['gain'] } });

        setAutomationSubLanes('t1', ['pan']);

        expect(timelineEditingStore.value?.automationSubLanes).toEqual({ t1: ['pan'] });
    });
});
