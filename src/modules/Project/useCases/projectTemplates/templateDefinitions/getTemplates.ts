import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { templates } from './helpers';

import type { ProjectTemplate } from './helpers';

function isNativePlatform(): boolean {
    return isDesktopRuntime();
}

export function getTemplates(): ProjectTemplate[] {
    const native = isNativePlatform();
    return templates.filter((time) => {
        if (time.platform === 'native' && !native) {
            return false;
        }
        if (time.platform === 'web' && native) {
            return false;
        }
        return true;
    });
}
