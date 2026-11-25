/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'This dependency is part of a circular relationship. Circular dependencies between workspace packages make the codebase harder to reason about and can cause subtle runtime issues.',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-circular-between-workspace-packages',
      severity: 'error',
      comment:
        'Circular dependencies between workspace packages are not allowed. Break the cycle by extracting shared code into a separate package or by restructuring the dependency direction.',
      from: {
        path: '^packages/[^/]+/src',
      },
      to: {
        path: '^packages/[^/]+/src',
        circular: true,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: '(^|/)(node_modules|dist|build|coverage)(/|$)',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)',
      },
      archi: {
        collapsePattern:
          '^(packages/[^/]+)/src|^node_modules/(@[^/]+/[^/]+|[^/]+)',
      },
    },
  },
};