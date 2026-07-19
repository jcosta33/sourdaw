import { type GrooveTemplate } from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { markGrooveTemplateProjectWrite } from './markGrooveTemplateProjectWrite';
import { resolveGrooveTemplateRename } from './resolveGrooveTemplateRename';

type RenameGrooveTemplateInput = {
    templateId: string;
    name: string;
};

export function renameGrooveTemplate({ templateId, name }: RenameGrooveTemplateInput): GrooveTemplate | null {
    const state = grooveTemplateStore.value;
    const resolved = resolveGrooveTemplateRename({ templateId, name });
    if (!state || !resolved) {
        return state?.templates.find((template) => template.id === templateId) ?? null;
    }
    if (resolved.current.name === resolved.nextName) {
        return resolved.current;
    }
    const renamed = {
        ...resolved.current,
        name: resolved.nextName,
    };
    grooveTemplateStore.set({
        ...state,
        templates: state.templates.map((template) => (template.id === templateId ? renamed : template)),
    });
    markGrooveTemplateProjectWrite();
    return renamed;
}
