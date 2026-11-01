// The one place E2E files take `test` and `expect` from, so a fixture added here reaches every test.
import { expect, test as base } from '@playwright/test';

export const test = base;
export { expect };
