/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'core',
        'web',
        'site',
        'mobile',
        'ui',
        'renderer',
        'store',
        'export',
        'presets',
        'ci',
        'deps',
        'docs',
        'release',
        'brand',
        'repo',
      ],
    ],
  },
}
