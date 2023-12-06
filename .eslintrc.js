module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: 'eslint:recommended',
  overrides: [
    {
      env: {
        node: true,
      },
      files: ['.eslintrc.{js,cjs}'],
      parserOptions: {
        sourceType: 'script',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    'no-unused-vars': 1,
    'no-extra-semi': 0,
    'no-magic-numbers': [
      'warn',
      {
        ignore: [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 60, 80, 100, 1e3, 1024, 1e6, 1e9],
      },
    ],
  },
}
