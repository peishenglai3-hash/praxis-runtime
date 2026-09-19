/**
 * Small, dependency-free Node version-range helpers shared by the canonical
 * runtime-pin check and its negative controls.
 */

/** Compare dotted numeric versions. Missing components are treated as zero. */
export function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/** Extract the simple lower/upper bounds used by package.json engines.node. */
export function extractNodeBounds(range) {
  return {
    minimum: />=\s*([0-9]+(?:\.[0-9]+){0,2})/.exec(range)?.[1],
    maximum: /<\s*([0-9]+(?:\.[0-9]+){0,2})/.exec(range)?.[1],
  };
}

/** Return whether a version lies inside the supported Node range. */
export function isVersionInNodeRange(version, range) {
  const { minimum, maximum } = extractNodeBounds(range);
  if (minimum !== undefined && compareVersions(version, minimum) < 0) {
    return false;
  }
  if (maximum !== undefined && compareVersions(version, maximum) >= 0) {
    return false;
  }
  return true;
}
