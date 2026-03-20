/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-internals',
      severity: 'warn',
      comment: 'Cross-module imports are only permitted from contract folders (models, events, useCases, views).',
      from: {
        path: '^src/modules/([^/]+)/',
      },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: [
          '^src/modules/$1/', // Allowed within the same module
          '^src/modules/[^/]+/(models|events|useCases|presentations/views)/', // Allowed crossing boundaries only to contracts
        ],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'This dependency is part of a circular relationship. You might want to revise your solution (i.e. use dependency inversion, or move to a common module).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'This is an orphan module - it\'s likely not used (anymore?). Either use it or remove it.',
      from: { orphan: true, pathNot: '\\.spec\\.(js|ts|tsx)$' },
      to: {},
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg'],
    },
    includeOnly: '^src/',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
