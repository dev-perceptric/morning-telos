// Which sign-in providers Supabase Auth has turned on, from its public /auth/v1/settings answer.
// The Google button only shows once Google is set up, so nobody lands on "provider is not enabled".

/** True when the settings say Google sign-in is on. Anything unexpected counts as off. */
export function googleEnabled(settings: unknown): boolean {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external;
  return external?.google === true;
}
