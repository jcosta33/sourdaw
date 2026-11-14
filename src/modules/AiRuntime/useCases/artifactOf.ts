import { type RenderedPreviewTarget } from './measurePreviewTarget';

export function artifactOf(target: RenderedPreviewTarget) {
    return { route: target.route, artifact: target.artifact };
}
