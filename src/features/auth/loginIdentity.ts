/** Resolve an optional public convenience alias to the account email used by Supabase Auth. */
export function resolveLoginEmail(identity: string, alias?: string, aliasEmail?: string): string {
  const input = identity.trim()
  const configuredAlias = alias?.trim()
  const configuredEmail = aliasEmail?.trim()

  if (
    input &&
    configuredAlias &&
    configuredEmail &&
    input.toLocaleLowerCase('en-US') === configuredAlias.toLocaleLowerCase('en-US')
  ) {
    return configuredEmail
  }

  return input
}
