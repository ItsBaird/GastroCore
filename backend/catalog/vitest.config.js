import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test/setup.js'],
    // argon2id (OWASP) tarda unas decenas de ms por hash
    testTimeout: 15000,
  },
});
