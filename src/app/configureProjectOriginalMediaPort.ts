import {
    activateProjectOriginalMedia,
    captureProjectOriginalMedia,
    restoreProjectOriginalMedia,
} from '#/modules/Collaboration/useCases';
import { projectOriginalMediaPort } from '#/modules/Project/useCases';

/**
 * Project owns the original-media port and Collaboration owns the durable store
 * that answers it; the composition root is the only place allowed to know both.
 */
export function configureProjectOriginalMediaPort(): void {
    projectOriginalMediaPort.configure({
        capture: captureProjectOriginalMedia,
        restore: restoreProjectOriginalMedia,
        activate: activateProjectOriginalMedia,
    });
}
