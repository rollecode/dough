// Shared brand colours and icons for recurring payments (subscriptions and bills), so every
// surface renders the same logo treatment. Auto-detected from the name. Kept free of JSX so the
// API can resolve a brand too, and a phone gets the same colour and mark as the browser.

// Known brand configs
export const BRANDS: Record<string, { color: string; logo: string; svg?: string; img?: string }> = {
  netflix: { color: "#E50914", logo: "N", svg: "netflix" },
  spotify: { color: "#1DB954", logo: "S", svg: "spotify" },
  disney: { color: "#113CCF", logo: "D+" },
  "hbo max": { color: "#5822B4", logo: "H" },
  "apple tv": { color: "#000000", logo: "" },
  "apple music": { color: "#FC3C44", logo: "♪", svg: "applemusic" },
  "youtube premium": { color: "#FF0000", logo: "▶" },
  "youtube music": { color: "#FF0000", logo: "♪" },
  "amazon prime": { color: "#00A8E1", logo: "P" },
  "xbox game pass": { color: "#107C10", logo: "X" },
  "playstation plus": { color: "#003087", logo: "PS" },
  "nintendo switch online": { color: "#E60012", logo: "N" },
  adobe: { color: "#FF0000", logo: "Ai" },
  figma: { color: "#A259FF", logo: "F" },
  notion: { color: "#000000", logo: "N" },
  slack: { color: "#4A154B", logo: "S" },
  github: { color: "#24292F", logo: "GH" },
  dropbox: { color: "#0061FF", logo: "D" },
  "1password": { color: "#0572EC", logo: "1P" },
  nordvpn: { color: "#4687FF", logo: "N" },
  claude: { color: "#cc785c", logo: "A", img: "claude.png" },
  anthropic: { color: "#cc785c", logo: "A", svg: "anthropic" },
  icloud: { color: "#3693F3", logo: "", svg: "icloud" },
  "apple icloud": { color: "#3693F3", logo: "", svg: "icloud" },
  "ultra.cc": { color: "#14b89f", logo: "U", svg: "ultracc" },
  ultra: { color: "#14b89f", logo: "U", svg: "ultracc" },
  elisa: { color: "#009bdb", logo: "E" },
  telia: { color: "#990AE3", logo: "T" },
  dna: { color: "#00A651", logo: "D" },
  nextdns: { color: "#007BFF", logo: "N", svg: "nextdns" },
  oura: { color: "#2F4A73", logo: "O", svg: "oura" },
  "no-ip": { color: "#8fbe00", logo: "N", svg: "noip" },
  bookbeat: { color: "#CD96FF", logo: "B", svg: "bookbeat" },
  runna: { color: "#1E8C74", logo: "R", img: "runna.png" },
  torbox: { color: "#17A34A", logo: "T", img: "torbox.png" },
  cronometer: { color: "#F26B21", logo: "C", img: "cronometer.png" },
  "insight timer": { color: "#17A2B8", logo: "I", img: "insighttimer.png" },
  patreon: { color: "#FF424D", logo: "P", img: "patreon.png" },
  rungap: { color: "#DB4437", logo: "R", img: "rungap.png" },
  trakt: { color: "#A44DBB", logo: "T", img: "trakt.png" },
  mementomori: { color: "#B23A48", logo: "M", img: "mementomori.png" },
  hostingby: { color: "#2B3A55", logo: "H", img: "hostingby.png" },
  outsider: { color: "#E5308A", logo: "O", img: "outsider.png" },
};

export function getBrandConfig(name: string): { color: string; logo: string; svg?: string; img?: string; known: boolean } {
  const lower = name.toLowerCase();
  for (const [key, config] of Object.entries(BRANDS)) {
    if (lower.includes(key)) return { ...config, known: true };
  }
  return { color: "#9f6ce9", logo: name.charAt(0).toUpperCase(), known: false };
}

// True when the name matches a known brand (so callers can skip the generic initial fallback)
export function isKnownBrand(name: string): boolean {
  return getBrandConfig(name).known;
}

// Where a brand's bitmap lives on the instance, for a client that cannot draw the inline SVGs.
export function brandImagePath(name: string): string {
  const config = getBrandConfig(name);
  return config.img ? `/brands/${config.img}` : "";
}
