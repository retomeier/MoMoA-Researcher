/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js'],
  testPathIgnorePatterns: ["/dist/"],
  transform: {
    '^.+\.ts$': ['ts-jest', {
      useESM: true,
    }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.\\.?/(?:(?!node_modules).)*)\\.js$': '$1',
  },
};
