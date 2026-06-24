import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Load packages/server/.env so integration tests can reach the database.
    setupFiles: ['dotenv/config'],
  },
});
