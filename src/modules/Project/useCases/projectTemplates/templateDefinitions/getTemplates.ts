import type { ProjectTemplate } from './helpers';
import { templates } from './helpers';

function isNativePlatform(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getTemplates(): ProjectTemplate[] {
    const native = isNativePlatform();
    return templates.filter((t) => {
        if (t.platform === 'native' && !native) return false;
        if (t.platform === 'web' && native) return false;
        return true;
    });
}