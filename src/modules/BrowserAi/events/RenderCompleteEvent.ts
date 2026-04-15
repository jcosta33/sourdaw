import { type RenderProvenance } from '../models/RenderProgress';

export type RenderCompletePayload = {
    requestId: string;
    phraseId: string;
    durationSeconds: number;
    provenance: RenderProvenance;
};
