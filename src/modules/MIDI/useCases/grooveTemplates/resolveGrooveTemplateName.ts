import { resolveGrooveTemplateNameCollision, type GrooveTemplate } from '../../models/GrooveTemplate';

type ResolveGrooveTemplateNameInput = {
    requestedName: string;
    templates: readonly GrooveTemplate[];
    ignoreTemplateId?: string;
};

export function resolveGrooveTemplateName({
    requestedName,
    templates,
    ignoreTemplateId,
}: ResolveGrooveTemplateNameInput): string {
    return resolveGrooveTemplateNameCollision({ requestedName, templates, ignoreTemplateId });
}
