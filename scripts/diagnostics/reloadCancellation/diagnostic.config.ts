import original from '../../../playwright.config.ts';

import { configureDiagnostic } from './configure.ts';
import { requiredText } from './journal.ts';
import { phaseOutput } from './paths.ts';

// oxlint-disable-next-line import/no-default-export -- Playwright loads its config through this export.
export default configureDiagnostic(
    original,
    requiredText(process.env.RELOAD_DIAGNOSTIC_ROOT, 'target root'),
    phaseOutput(),
    process.env.RELOAD_DIAGNOSTIC_PHASE === 'run'
);
