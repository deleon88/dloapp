/**
 * Only same-site paths: "/x" yes; "//evil.com", "/\evil.com" (browsers read a
 * backslash as a slash) or anything with control characters, no. Used for the
 * page to return to after logging in.
 */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  // eslint-disable-next-line no-control-regex
  return !!path && /^\/(?![/\\])/.test(path) && !/[\\\u0000-\u001f]/.test(path)
}
