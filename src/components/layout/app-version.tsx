// Small, dim version label fixed to the bottom-right corner, linking to the public repo.
// The version comes from package.json (exposed via next.config env at build time).
const REPO_URL = "https://github.com/rollecode/dough";

export function AppVersion() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  if (!version) return null;
  return (
    <a className="app-version" href={REPO_URL} target="_blank" rel="noopener noreferrer">
      v{version}
    </a>
  );
}
