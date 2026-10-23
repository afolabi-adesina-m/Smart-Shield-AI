/** Resolve extensionless imports inside mobile/src/driveScore to .ts files. */

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../"))
    && !/\.(ts|js|mjs|cjs|json|node)$/.test(specifier)
  ) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
