import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClient, redirectUriAllowed, normaliseScopes, isS256Challenge } from "@/lib/oauth";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

// The consent screen. Everything is validated before anything is shown, and a request that fails
// validation is explained here rather than redirected: sending a person onward to an address we
// have not verified is how codes end up in the wrong hands.
export default async function AuthorizePage({ searchParams }: Props) {
  const params = await searchParams;
  const clientId = first(params.client_id);
  const redirectUri = first(params.redirect_uri);
  const responseType = first(params.response_type);
  const state = first(params.state);
  const codeChallenge = first(params.code_challenge);
  const codeChallengeMethod = first(params.code_challenge_method);
  const scopes = normaliseScopes(first(params.scope));

  const client = clientId ? getClient(clientId) : null;
  if (!client) return <Problem title="Unknown application" detail="This application is not registered with your instance." />;
  if (!redirectUriAllowed(client, redirectUri)) {
    return <Problem title="Address not registered" detail="This application asked to be sent somewhere it did not register." />;
  }
  if (responseType !== "code") {
    return <Problem title="Unsupported request" detail="Only the authorization code flow is supported." />;
  }
  if (!isS256Challenge(codeChallengeMethod, codeChallenge)) {
    return <Problem title="Unsupported request" detail="This instance requires PKCE with S256." />;
  }

  const user = await getSession();
  if (!user) {
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: responseType,
      scope: scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      ...(state ? { state } : {}),
    });
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);
  }

  const canWrite = scopes.includes("write");

  return (
    <div className="oauth-consent">
      <div className="oauth-consent-card">
        <h1 className="oauth-consent-title">{client.client_name}</h1>
        <p className="oauth-consent-lede">wants to connect to your Dough.</p>

        <ul className="oauth-consent-scopes">
          <li>
            <strong>Read</strong> your accounts, transactions, budget, bills and income
          </li>
          {canWrite && (
            <li>
              <strong>Add and change</strong> transactions, bills, budget and the rest of your data
            </li>
          )}
        </ul>

        <p className="oauth-consent-note">
          Signed in as {user.email}. You can revoke this from Settings at any time.
        </p>

        <form method="post" action="/api/oauth/authorize" className="oauth-consent-actions">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="scope" value={scopes.join(" ")} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
          <button type="submit" name="decision" value="deny" className="button" data-variant="outline">
            Deny
          </button>
          <button type="submit" name="decision" value="allow" className="button">
            Allow
          </button>
        </form>
      </div>
    </div>
  );
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="oauth-consent">
      <div className="oauth-consent-card">
        <h1 className="oauth-consent-title">{title}</h1>
        <p className="oauth-consent-lede">{detail}</p>
      </div>
    </div>
  );
}
