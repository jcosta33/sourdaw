import { timelineViewStore } from '../../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../../buildTimelineRenderModel';
import { getTrackAtY } from '../getTrackAtY';

export const hitTestClipDependencies = {
    timelineViewStore,
    buildTimelineRenderModel,
    getTrackAtY,
} as const;