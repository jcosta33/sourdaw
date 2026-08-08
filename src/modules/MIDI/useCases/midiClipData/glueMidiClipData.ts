import { prepareMidiClipGlueState } from './prepareMidiClipGlueState';
import { restoreMidiClipGlueState } from './restoreMidiClipGlueState';

type GlueMidiClipDataInput = {
    sources: readonly {
        beatOffset: number;
        clipId: string;
        visibleEndBeat: number;
        visibleStartBeat: number;
    }[];
    targetClipId: string;
};

export function glueMidiClipData({ sources, targetClipId }: GlueMidiClipDataInput): boolean {
    const plan = prepareMidiClipGlueState({ sources, targetClipId });
    return plan ? restoreMidiClipGlueState({ expected: plan.previous, replacement: plan.next }) : false;
}
