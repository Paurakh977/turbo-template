import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(t|j)sx?$': 'ts-jest',
  },
  moduleFileExtensions: ['js', 'ts', 'json', 'jsx', 'tsx'],
  collectCoverageFrom: ['src/**/*.(t|j)sx'],
  coverageDirectory: 'coverage',
};

export default config;
