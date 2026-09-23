"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useLocale } from "@/lib/locale-context";

// What the connector is called in every client it is added to.
const SERVER = "dough";
export const API_KEYS_CHANGED = "dough:api-keys-changed";

type Kind = "key" | "str" | "url" | "secret" | "punct" | "cmd" | "flag" | "arg";
type Part = { text: string; kind?: Kind };

export function McpMark() {
  return (
    <svg viewBox="0 0 180 180" fill="none" aria-hidden focusable="false">
      <path
        d="M18 84.8528L85.8822 16.9706C95.2548 7.59798 110.451 7.59798 119.823 16.9706C129.196 26.3431 129.196 41.5391 119.823 50.9117L68.5581 102.177"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M69.2652 101.47L119.823 50.9117C129.196 41.5391 144.392 41.5391 153.765 50.9117L154.118 51.2652C163.491 60.6378 163.491 75.8338 154.118 85.2063L92.7248 146.6C89.6006 149.724 89.6006 154.789 92.7248 157.913L105.331 170.52"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M102.853 33.9411L52.6482 84.1457C43.2756 93.5183 43.2756 108.714 52.6482 118.087C62.0208 127.459 77.2167 127.459 86.5893 118.087L136.794 67.8822"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Anthropic's mark, drawn rather than served.
function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      {[0, 45, 90, 135].map((deg) => (
        <rect key={deg} x="11.1" y="2.4" width="1.8" height="19.2" rx="0.9" transform={`rotate(${deg} 12 12)`} />
      ))}
    </svg>
  );
}

function TerminalMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="m4.8 6.3 2.2 1.9-2.2 1.9M8.6 10.4h2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="mcp-copy"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />}
    </button>
  );
}

function Tokens({ parts }: { parts: Part[] }) {
  return parts.map((p, i) => (
    <span key={i} className={p.kind ? `mcp-tok mcp-tok-${p.kind}` : undefined}>
      {p.text}
    </span>
  ));
}

// Snippets are tokenised here rather than by a highlighter: they are a few strings whose shape we
// wrote ourselves, and each part already knows what it is.
function Snippet({ label, icon, lines, copy }: { label: string; icon: ReactNode; lines: Part[][]; copy: string }) {
  return (
    <div className="mcp-snippet">
      <div className="mcp-snippet-head">
        <span className="mcp-snippet-icon">{icon}</span>
        <span className="mcp-snippet-label">{label}</span>
        <CopyButton text={copy} label={`Copy ${label}`} />
      </div>
      <pre className="mcp-snippet-body">
        <code>
          {lines.map((parts, i) => (
            <span key={i} className="mcp-snippet-line">
              <Tokens parts={parts} />
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function InlineSnippet({ parts, copy, label }: { parts: Part[]; copy: string; label: string }) {
  return (
    <div className="mcp-inline">
      <span className="mcp-inline-icon">
        <TerminalMark />
      </span>
      <code>
        <Tokens parts={parts} />
      </code>
      <CopyButton text={copy} label={label} />
    </div>
  );
}

// Connecting an assistant to this instance. claude.ai takes the address and signs in by itself, so
// that is the quick way; everything else reads a configuration file, which needs a key.
export function McpConnectCard() {
  const { locale } = useLocale();
  const fi = locale === "fi";
  const [origin, setOrigin] = useState("");
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const endpoint = `${origin}/mcp`;
  const key = fresh || (fi ? "<avaimesi>" : "<your key>");

  async function makeKey() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "MCP", scopes: "read,write" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || (fi ? "Avaimen luonti epäonnistui" : "Could not create the key"));
        return;
      }
      console.info("[mcp-connect] Created MCP key", data.key_prefix);
      setFresh(data.key);
      window.dispatchEvent(new Event(API_KEYS_CHANGED));
    } finally {
      setBusy(false);
    }
  }

  const install = `https://claude.ai/customize/connectors?${new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: "Dough",
    connectorUrl: endpoint,
  })}`;

  const command = `claude mcp add --transport http ${SERVER} ${endpoint}`;
  const commandParts: Part[] = [
    { text: "claude", kind: "cmd" },
    { text: " mcp add ", kind: "arg" },
    { text: "--transport", kind: "flag" },
    { text: " http ", kind: "arg" },
    { text: SERVER, kind: "str" },
    { text: " " },
    { text: endpoint, kind: "url" },
  ];

  const config = JSON.stringify(
    { mcpServers: { [SERVER]: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2
  );
  const q = (kind: Kind, text: string): Part => ({ text: `"${text}"`, kind });
  const lines: Part[][] = [
    [{ text: "{", kind: "punct" }],
    [{ text: "  " }, q("key", "mcpServers"), { text: ": {", kind: "punct" }],
    [{ text: "    " }, q("key", SERVER), { text: ": {", kind: "punct" }],
    [{ text: "      " }, q("key", "type"), { text: ": ", kind: "punct" }, q("str", "http"), { text: ",", kind: "punct" }],
    [{ text: "      " }, q("key", "url"), { text: ": ", kind: "punct" }, q("url", endpoint), { text: ",", kind: "punct" }],
    [{ text: "      " }, q("key", "headers"), { text: ": {", kind: "punct" }],
    [
      { text: "        " },
      q("key", "Authorization"),
      { text: ": ", kind: "punct" },
      { text: '"Bearer ', kind: "str" },
      { text: key, kind: "secret" },
      { text: '"', kind: "str" },
    ],
    [{ text: "      }", kind: "punct" }],
    [{ text: "    }", kind: "punct" }],
    [{ text: "  }", kind: "punct" }],
    [{ text: "}", kind: "punct" }],
  ];

  return (
    <Card className="settings-card">
      <CardHeader>
        <CardTitle className="settings-card-title mcp-title">
          <McpMark />
          {fi ? "Tekoälyavustajat (MCP)" : "AI assistants (MCP)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="mcp-connect">
        <p className="settings-help">
          {fi
            ? "Anna Clauden tai muun MCP-asiakkaan lukea ja päivittää taloutesi. Jokainen kirjautuu omalla Dough-tunnuksellaan, joten avustaja näkee vain sen, mitä tunnuksesi näkee."
            : "Let Claude or any other MCP client read and update your finances. Everyone signs in with their own Dough account, so the assistant sees only what that account can see."}
        </p>

        <section className="mcp-section">
          <h3 className="mcp-section-title">{fi ? "Pika-asennus" : "Quick install"}</h3>
          <p className="mcp-section-lede">
            {fi ? "Avaa Claude valmiiksi täytetyllä nimellä ja osoitteella." : "Open Claude with the name and address already filled in."}
          </p>
          <div className="mcp-install">
            <span className="mcp-install-logo">
              <ClaudeMark />
            </span>
            <span className="mcp-install-text">
              <span className="mcp-install-head">
                Claude <Badge variant="outline">{fi ? "Valmis linkki" : "Preset link"}</Badge>
              </span>
              <span className="mcp-install-body">
                {fi
                  ? "Kirjautuu Dough-tunnuksellasi, joten mitään ei tarvitse liittää."
                  : "Signs in with your Dough account, so there is nothing to paste."}
              </span>
            </span>
            <a className="button" data-variant="outline" data-size="sm" href={install} target="_blank" rel="noreferrer">
              <ExternalLink />
              {fi ? "Asenna" : "Install"}
            </a>
          </div>
        </section>

        <section className="mcp-section">
          <h3 className="mcp-section-title">Claude Code</h3>
          <p className="mcp-section-lede">
            {fi
              ? "Aja komento ja kirjaudu sitten Claude Codessa komennolla /mcp."
              : "Run the command, then sign in from Claude Code with /mcp."}
          </p>
          <InlineSnippet parts={commandParts} copy={command} label={fi ? "Kopioi komento" : "Copy the command"} />
        </section>

        <section className="mcp-section">
          <h3 className="mcp-section-title">{fi ? "Käsin määritys" : "Manual configuration"}</h3>
          <p className="mcp-section-lede">
            {fi
              ? "Codexille, Cursorille ja muille, jotka lukevat MCP-asetustiedostoa. Luo ensin avain: se tulee alla olevaan otsakkeeseen ja näytetään vain kerran."
              : "For Codex, Cursor and anything else that reads an MCP configuration. Make a key first: it goes in the header below and is shown only once."}
          </p>
          <Snippet label={fi ? "MCP-asiakkaan asetukset" : "MCP client configuration"} icon={<McpMark />} lines={lines} copy={config} />
          <div className="mcp-key-row">
            <button type="button" className="button" data-variant="outline" data-size="sm" onClick={makeKey} disabled={busy}>
              {busy ? (fi ? "Luodaan" : "Making") : fi ? "Uusi avain" : "New key"}
            </button>
            {fresh && <span className="mcp-key-note">{fi ? "Kopioi nyt. Avainta ei näytetä uudelleen." : "Copy it now. It is not shown again."}</span>}
            {error && <span className="settings-error">{error}</span>}
          </div>
          <p className="settings-help">
            {fi ? "Avaimet voi mitätöidä alempana kohdassa API-avaimet." : "Revoke keys under API keys below."}
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
