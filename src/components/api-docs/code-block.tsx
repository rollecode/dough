"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { highlight, type Language } from "@/lib/highlight";

interface Props {
  code: string;
  language?: Language;
}

// A snippet on the reference is there to be run, so it carries its own copy button. Highlighting is
// done by our own tokeniser rather than a library, see lib/highlight.
export function CodeBlock({ code, language = "bash" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="api-code-block">
      <button
        type="button"
        className="api-code-copy"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
      >
        {copied ? <Check /> : <Copy />}
      </button>

      <pre className="api-code-pre">
        <code>
          {highlight(code, language).map((token, index) => (
            <span key={index} className={`api-token-${token.type}`}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
