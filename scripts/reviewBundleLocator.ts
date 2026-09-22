/**
 * The one place that names where a head's review bundle lives (#3376, spec #3367 AC-005): the review
 * side writes the bundle and the delivery side reads its recorded delivery authorization, and both
 * derive the path from here so the two can never drift apart.
 */

import { join } from 'node:path';

export function reviewBundlePath(primaryRoot: string, pr: number, headSha: string): string {
    return join(primaryRoot, '.agents', 'review-bundles', `${pr}-${headSha}`);
}
