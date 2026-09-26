/**
 * A redirect target that stays on this origin, or the fallback.
 *
 * One leading slash, and the next character is neither a slash nor a
 * backslash: `//host` is protocol-relative, and `/\host` becomes the same
 * thing once a browser normalises the backslash. Anything that fails,
 * including an absolute URL, an empty value or a non-string, falls back
 * rather than being repaired.
 *
 * Browser-safe on purpose: the login page and the auth route apply the same
 * rule, and it must be the same rule.
 */
export function localPath(candidate: unknown, fallback: string): string {
  return typeof candidate === 'string' && /^\/[^/\\]/.test(candidate) ? candidate : fallback;
}
