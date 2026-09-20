import type { Metadata } from "next";
import { SECTIONS, ENDPOINT_COUNT } from "@/lib/api-docs";
import { CodeBlock } from "@/components/api-docs/code-block";

export const metadata: Metadata = {
  title: "Dough API",
  description:
    "The Dough HTTP API: read and write accounts, transactions, budget, bills, income, savings goals, debts and investments on your own instance with an API key.",
};

const NAV = [
  { id: "start", title: "Getting started" },
  { id: "auth", title: "Authentication" },
  ...SECTIONS.map((section) => ({ id: section.id, title: section.title })),
  { id: "errors", title: "Errors" },
  { id: "mcp", title: "MCP server" },
];

// Served on the api. host of whatever domain an instance runs on, so every self-hosted Dough has its
// own reference at its own address. Public: the middleware lets this page through the session gate,
// and nothing here reads the database.
export default function ApiDocs() {
  return (
    <div className="api-docs">
      <nav className="api-docs-nav" aria-label="Reference">
        <ul>
          {NAV.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`}>{item.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="api-docs-content">
        <header className="api-docs-hero">
          <h1>Dough API</h1>
          <p className="api-docs-lede">
            {ENDPOINT_COUNT} endpoints over HTTP, on your own instance, authenticated with a key you
            mint yourself. Your finances are yours: read them, write them, move them elsewhere.
          </p>
        </header>

        <section id="start" className="api-docs-section">
          <h2>Getting started</h2>
          <p>
            Every endpoint lives under <code>/api/v1</code> on the instance you run. Responses are
            JSON, amounts are in euros, and a <code>month</code> parameter is always{" "}
            <code>YYYY-MM</code>, defaulting to the current month in the server&rsquo;s timezone.
          </p>
          <CodeBlock
            code={`curl -s https://dough.example.com/api/v1/summary \\
  -H "Authorization: Bearer $DOUGH_API_KEY"`}
          />
        </section>

        <section id="auth" className="api-docs-section">
          <h2>Authentication</h2>
          <p>
            Create a key in the app under Settings, then API keys. It is shown once, because only its
            SHA-256 hash is stored: the database never holds a usable secret. Send it as a bearer
            token, or as <code>x-api-key</code>.
          </p>
          <CodeBlock code={`Authorization: Bearer dough_xxxxxxxx`} language="http" />
          <p>
            A key carries <code>read</code>, or <code>read</code> and <code>write</code>. A read key
            can see everything and change nothing. A missing or revoked key returns{" "}
            <code>401</code>; a key without the scope an endpoint needs returns <code>403</code>.
            Revoking a key in settings stops it working on its next request.
          </p>
          <p>
            On an instance without the settings page, a key can still be minted on the machine that
            owns the database:
          </p>
          <CodeBlock code={`npx tsx scripts/create-api-key.ts --name "my-client" --scopes read,write`} />
        </section>

        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="api-docs-section">
            <h2>{section.title}</h2>
            <p>{section.intro}</p>

            {section.endpoints.map((endpoint) => (
              <article key={`${endpoint.method} ${endpoint.path}`} className="api-endpoint">
                <h3 className="api-endpoint-head">
                  <span className="api-method" data-method={endpoint.method}>
                    {endpoint.method}
                  </span>
                  <code className="api-path">/api/v1{endpoint.path}</code>
                  <span className="api-scope" data-scope={endpoint.scope}>
                    {endpoint.scope}
                  </span>
                  {endpoint.localOnly && <span className="api-note">local mode only</span>}
                </h3>
                <p className="api-endpoint-summary">{endpoint.summary}</p>

                {endpoint.params && (
                  <FieldTable title="Query parameters" fields={endpoint.params} />
                )}
                {endpoint.body && <FieldTable title="Body" fields={endpoint.body} />}
              </article>
            ))}
          </section>
        ))}

        <section id="errors" className="api-docs-section">
          <h2>Errors</h2>
          <p>
            Errors are JSON with an <code>error</code> string. <code>400</code> means the body was
            wrong, or the write is not available in the instance&rsquo;s current mode.{" "}
            <code>401</code> means the key is missing, wrong or revoked. <code>403</code> means the
            key lacks the scope. <code>404</code> means the row is not there. A client should
            degrade per endpoint rather than per app: a read key is perfectly useful, and so is an
            instance in YNAB mode where transaction writes are refused.
          </p>
        </section>

        <section id="mcp" className="api-docs-section">
          <h2>MCP server</h2>
          <p>
            The Dough MCP server is a thin client of this API: point it at your instance with an API
            key and an assistant can answer questions about your finances. It exposes each endpoint
            here as a tool.
          </p>
        </section>
      </div>
    </div>
  );
}

function FieldTable({ title, fields }: { title: string; fields: { name: string; type: string; required?: boolean; description: string }[] }) {
  return (
    <div className="api-fields">
      <h4>{title}</h4>
      <ul>
        {fields.map((field) => (
          <li key={field.name}>
            <code>{field.name}</code>
            <span className="api-field-type">{field.type}</span>
            {field.required && <span className="api-field-required">required</span>}
            {field.description && <span className="api-field-description">{field.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
