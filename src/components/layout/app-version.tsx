// Version + short commit shown as an in-flow footer at the bottom of the app content, linking to
// the public repo. Version and commit come from package.json / git via next.config env at build.
const REPO_URL = "https://github.com/rollecode/dough";

export function AppVersion() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  if (!version) return null;
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT;
  const label = commit ? `v${version}-${commit}` : `v${version}`;
  return (
    <footer className="app-version">
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{label}</a>
    </footer>
  );
}
