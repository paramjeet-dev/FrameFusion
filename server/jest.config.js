module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/uploads/', '/processed/'],
  verbose: true,
  clearMocks: true,
};
