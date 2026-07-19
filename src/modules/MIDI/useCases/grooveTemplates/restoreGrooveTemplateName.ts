import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { renameGrooveTemplate } from './renameGrooveTemplate';
import { resolveGrooveTemplateRename } from './resolveGrooveTemplateRename';

type RestoreGrooveTemplateNameInput = {
    templateId: string;
    name: string;
    expectedName: string;
};

export function restoreGrooveTemplateName({ templateId, name, expectedName }: RestoreGrooveTemplateNameInput): {
    status: 'written' | 'no-write';
} {
    const current = grooveTemplateStore.value?.templates.find((template) => template.id === templateId);
    if (!current || current.name !== expectedName) {
        throw new Error('Cannot restore groove template name: current value diverged from the action result');
    }
    if (current.name === name) {
        return { status: 'no-write' };
    }
    const resolved = resolveGrooveTemplateRename({ templateId, name });
    if (!resolved || resolved.nextName !== name) {
        throw new Error('Cannot restore groove template name: target name is unavailable');
    }
    renameGrooveTemplate({ templateId, name });
    return { status: 'written' };
}
