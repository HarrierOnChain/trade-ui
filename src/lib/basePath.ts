/**
 * Trade UI is served at the root of its host: server.mjs guards `/api/` there,
 * so there is no base path. Kept as a seam for the callers.
 */
export function withBasePath(path: string): string {
  return path;
}
