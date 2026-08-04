const { defineConfig } = require('vitest/config');

module.exports = defineConfig({ test: { environment: 'node', include: ['tests/e2e/__tests__/**/*.spec.ts'] } });
