import { resolve } from 'node:path';

import { ESLint, type Linter } from 'eslint';

export async function configuredSourdawRules() {
    const config: Linter.Config | undefined = await new ESLint().calculateConfigForFile(
        resolve('src/app/bootstrap.ts')
    );
    const rules = config?.plugins?.sourdaw?.rules;
    if (!rules) {
        throw new Error('ESLint did not register the local rule definitions');
    }
    return rules;
}
