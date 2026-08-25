import { defineConfig } from 'vitest/config';

// oxlint-disable-next-line import/no-default-export -- Vitest requires this export shape.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['__tests__/**/*.spec.ts'],
    },
});
