export type TokenType =
  | "text"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "command"
  | "flag"
  | "variable"
  | "punctuation"
  | "method"
  | "path";

export interface Token {
  text: string;
  type: TokenType;
}

export type Language = "bash" | "json" | "http";

// A small tokeniser for the few languages the API reference actually shows. A highlighter library
// would be several hundred kilobytes for three shapes of snippet, none of which need a real parser.

const BASH_COMMANDS = new Set([
  "curl", "claude", "npm", "npx", "git", "cd", "node", "openssl", "sudo",
  "systemctl", "cloudflared", "export", "echo", "cat", "mkdir", "chmod",
]);

const BASH_KEYWORDS = new Set(["if", "then", "else", "fi", "for", "in", "do", "done", "&&", "||"]);

const BASH_PATTERN = new RegExp(
  [
    "(?<comment>#[^\\n]*)",
    "(?<string>'[^']*'|\"[^\"]*\")",
    "(?<variable>\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?)",
    "(?<flag>(?<=\\s)--?[A-Za-z][A-Za-z0-9-]*)",
    "(?<word>[A-Za-z_][A-Za-z0-9_.:/-]*)",
    "(?<number>\\b\\d+\\b)",
    "(?<punctuation>[\\\\|{}\\[\\]()=<>;&])",
  ].join("|"),
  "g",
);

const JSON_PATTERN = new RegExp(
  [
    "(?<key>\"[^\"]*\"(?=\\s*:))",
    "(?<string>\"[^\"]*\")",
    "(?<number>-?\\b\\d+(\\.\\d+)?\\b)",
    "(?<keyword>\\b(true|false|null)\\b)",
    "(?<punctuation>[{}\\[\\],:])",
  ].join("|"),
  "g",
);

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function tokenizeBash(code: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let atLineStart = true;

  for (const match of code.matchAll(BASH_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) {
      const gap = code.slice(last, index);
      tokens.push({ text: gap, type: "text" });
      if (gap.includes("\n")) {
        atLineStart = true;
      }
    }
    last = index + match[0].length;

    const groups = match.groups ?? {};
    if (groups.comment) {
      tokens.push({ text: match[0], type: "comment" });
    } else if (groups.string) {
      tokens.push({ text: match[0], type: "string" });
    } else if (groups.variable) {
      tokens.push({ text: match[0], type: "variable" });
    } else if (groups.flag) {
      tokens.push({ text: match[0], type: "flag" });
    } else if (groups.word) {
      const word = match[0];
      if (BASH_COMMANDS.has(word) && atLineStart) {
        tokens.push({ text: word, type: "command" });
      } else if (BASH_KEYWORDS.has(word)) {
        tokens.push({ text: word, type: "keyword" });
      } else if (HTTP_METHODS.has(word)) {
        tokens.push({ text: word, type: "method" });
      } else {
        tokens.push({ text: word, type: "text" });
      }
      atLineStart = false;
    } else if (groups.number) {
      tokens.push({ text: match[0], type: "number" });
    } else {
      tokens.push({ text: match[0], type: "punctuation" });
    }
  }

  if (last < code.length) {
    tokens.push({ text: code.slice(last), type: "text" });
  }
  return tokens;
}

function tokenizeJson(code: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;

  for (const match of code.matchAll(JSON_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) {
      tokens.push({ text: code.slice(last, index), type: "text" });
    }
    last = index + match[0].length;

    const groups = match.groups ?? {};
    if (groups.key) {
      tokens.push({ text: match[0], type: "keyword" });
    } else if (groups.string) {
      tokens.push({ text: match[0], type: "string" });
    } else if (groups.number) {
      tokens.push({ text: match[0], type: "number" });
    } else if (groups.keyword) {
      tokens.push({ text: match[0], type: "keyword" });
    } else {
      tokens.push({ text: match[0], type: "punctuation" });
    }
  }

  if (last < code.length) {
    tokens.push({ text: code.slice(last), type: "text" });
  }
  return tokens;
}

/** Endpoint listings: a method, a path, and whatever note follows them. */
function tokenizeHttp(code: string): Token[] {
  const tokens: Token[] = [];

  for (const line of code.split("\n")) {
    const match = line.match(/^(\s*)([A-Z]+)(\s+)(\S+)(.*)$/);
    if (match && HTTP_METHODS.has(match[2])) {
      tokens.push({ text: match[1], type: "text" });
      tokens.push({ text: match[2], type: "method" });
      tokens.push({ text: match[3], type: "text" });
      tokens.push({ text: match[4], type: "path" });
      tokens.push({ text: match[5], type: "comment" });
    } else if (line.trim().startsWith("GET ") || line.trim().startsWith("/")) {
      tokens.push({ text: line, type: "path" });
    } else {
      tokens.push({ text: line, type: "text" });
    }
    tokens.push({ text: "\n", type: "text" });
  }

  tokens.pop();
  return tokens;
}

export function highlight(code: string, language: Language): Token[] {
  if (language === "json") {
    return tokenizeJson(code);
  }
  if (language === "http") {
    return tokenizeHttp(code);
  }
  return tokenizeBash(code);
}
