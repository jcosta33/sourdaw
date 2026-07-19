import { grooveTemplateProjectRevisionStore } from '../../stores/grooveTemplateProjectRevisionStore';

export function markGrooveTemplateProjectWrite(): void {
    const currentRevision = grooveTemplateProjectRevisionStore.value ?? 0;
    grooveTemplateProjectRevisionStore.set((currentRevision + 1) % Number.MAX_SAFE_INTEGER);
}
