import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from './openapi.js';

// Writes the committed spec. `yarn test` fails if docs/openapi.json is out of date.
export const OPENAPI_PATH = 'docs/openapi.json';

export function renderOpenApi(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}

if (process.argv[1]?.endsWith('generate.ts')) {
  writeFileSync(OPENAPI_PATH, renderOpenApi());
  console.info(`wrote ${OPENAPI_PATH}`);
}
