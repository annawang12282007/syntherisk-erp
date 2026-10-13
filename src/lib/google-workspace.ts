/** An explicit organization domain is required before admitting a Google identity. */
export function googleWorkspaceDomain(env: Record<string, string | undefined> = process.env): string | undefined {
  const domain = env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase();
  if (!domain || domain.length > 253) return undefined;
  const labels = domain.split('.');
  return labels.length > 1 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ? domain : undefined;
}

export function googleIdentityMatches(
  identity: { email?: string; domain?: string },
  expectedEmail: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const domain = googleWorkspaceDomain(env), email = identity.email?.toLowerCase();
  return Boolean(domain && email && expectedEmail && email === expectedEmail.toLowerCase()
    && identity.domain?.toLowerCase() === domain && email.split('@').length === 2 && email.split('@')[1] === domain);
}
