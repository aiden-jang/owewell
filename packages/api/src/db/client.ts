import { drizzle } from 'drizzle-orm/d1';
import type { Env } from '../env.js';
import * as schema from './schema.js';

export function createDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type DB = ReturnType<typeof createDb>;
