module.exports = {
  extends: './node_modules/@restorecommerce/dev/.eslintrc.cjs',
  parserOptions: {
    project: [
      'tsconfig.json',
    ],
  },
  rules: {
    '@typescript-eslint/consistent-type-imports': 0
  }
};