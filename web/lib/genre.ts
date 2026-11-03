/**
 * Topic Genre Classification Engine & Taxonomies
 * Provides zero-latency deterministic classification of topics and entities.
 */

export type TopicGenre =
  | "Tech & Hardware"
  | "AI & Software"
  | "Gaming & Esports"
  | "Automotive & EV"
  | "Finance & Crypto"
  | "Entertainment & Media"
  | "Lifestyle & Brands"
  | "General & News";

export interface GenreDefinition {
  id: TopicGenre;
  label: string;
  shortLabel: string;
  iconName: string; // Lucide icon reference
  colorBadge: string;
}

export const GENRE_DEFINITIONS: Record<TopicGenre, GenreDefinition> = {
  "Tech & Hardware": {
    id: "Tech & Hardware",
    label: "Tech & Hardware",
    shortLabel: "Tech",
    iconName: "Cpu",
    colorBadge: "bg-sky-500/10 text-sky-700 border-sky-400/30",
  },
  "AI & Software": {
    id: "AI & Software",
    label: "AI & Software",
    shortLabel: "AI",
    iconName: "Sparkles",
    colorBadge: "bg-indigo-500/10 text-indigo-700 border-indigo-400/30",
  },
  "Gaming & Esports": {
    id: "Gaming & Esports",
    label: "Gaming & Esports",
    shortLabel: "Gaming",
    iconName: "Gamepad2",
    colorBadge: "bg-violet-500/10 text-violet-700 border-violet-400/30",
  },
  "Automotive & EV": {
    id: "Automotive & EV",
    label: "Automotive & EV",
    shortLabel: "Auto",
    iconName: "Car",
    colorBadge: "bg-teal-500/10 text-teal-700 border-teal-400/30",
  },
  "Finance & Crypto": {
    id: "Finance & Crypto",
    label: "Finance & Crypto",
    shortLabel: "Finance",
    iconName: "Coins",
    colorBadge: "bg-emerald-500/10 text-emerald-700 border-emerald-400/30",
  },
  "Entertainment & Media": {
    id: "Entertainment & Media",
    label: "Entertainment & Media",
    shortLabel: "Media",
    iconName: "Film",
    colorBadge: "bg-rose-500/10 text-rose-700 border-rose-400/30",
  },
  "Lifestyle & Brands": {
    id: "Lifestyle & Brands",
    label: "Lifestyle & Brands",
    shortLabel: "Lifestyle",
    iconName: "ShoppingBag",
    colorBadge: "bg-amber-500/10 text-amber-700 border-amber-400/30",
  },
  "General & News": {
    id: "General & News",
    label: "General & News",
    shortLabel: "General",
    iconName: "Globe",
    colorBadge: "bg-slate-500/10 text-slate-700 border-slate-400/30",
  },
};

export const POPULAR_GENRES: Array<{ id: string; label: string }> = [
  { id: "all", label: "All Topics" },
  { id: "Tech & Hardware", label: "Tech & Hardware" },
  { id: "AI & Software", label: "AI & Software" },
  { id: "Gaming & Esports", label: "Gaming" },
  { id: "Automotive & EV", label: "Automotive" },
  { id: "Finance & Crypto", label: "Finance & Crypto" },
  { id: "Entertainment & Media", label: "Entertainment" },
];

interface ClassificationRule {
  genre: TopicGenre;
  keywords: string[];
  patterns?: RegExp[];
}

const RULES: ClassificationRule[] = [
  {
    genre: "AI & Software",
    keywords: [
      "chatgpt",
      "openai",
      "gpt",
      "claude",
      "anthropic",
      "gemini",
      "deepseek",
      "mistral",
      "copilot",
      "cursor",
      "qwen",
      "groq",
      "llama",
      "huggingface",
      "transformer",
      "midjourney",
      "stable diffusion",
      "suno",
      "udio",
      "perplexity",
      "github",
      "nextjs",
      "react",
      "typescript",
      "python",
      "rust",
      "linux",
    ],
    patterns: [/\bgpt[-_\s]?[0-9]/i, /\bclaude[-_\s]?[0-9]/i, /\bllama[-_\s]?[0-9]/i, /\bai\b/i, /\bllm\b/i],
  },
  {
    genre: "Gaming & Esports",
    keywords: [
      "gta",
      "grand theft auto",
      "playstation",
      "ps5",
      "ps4",
      "xbox",
      "nintendo",
      "switch",
      "steam",
      "elden ring",
      "zelda",
      "pokemon",
      "valorant",
      "fortnite",
      "minecraft",
      "call of duty",
      "cod",
      "cyberpunk",
      "ea sports",
      "fifa",
      "fc 25",
      "fc 24",
      "blizzard",
      "roblox",
      "genshin",
      "esports",
      "valve",
    ],
    patterns: [/\bgta\s?[0-9ivx]+/i, /\bps[45]/i],
  },
  {
    genre: "Automotive & EV",
    keywords: [
      "tesla",
      "cybertruck",
      "cybercab",
      "model 3",
      "model y",
      "model s",
      "model x",
      "fsd",
      "rivian",
      "lucid",
      "byd",
      "porsche",
      "ferrari",
      "lamborghini",
      "bmw",
      "mercedes",
      "audi",
      "ford",
      "toyota",
      "honda",
      "hyundai",
      "electric vehicle",
      "supercharger",
    ],
    patterns: [/\bmodel\s[3ysx]\b/i, /\bev\b/i],
  },
  {
    genre: "Finance & Crypto",
    keywords: [
      "bitcoin",
      "btc",
      "ethereum",
      "eth",
      "solana",
      "sol",
      "crypto",
      "dogecoin",
      "doge",
      "binance",
      "coinbase",
      "nasdaq",
      "s&p",
      "dow jones",
      "stock",
      "fed",
      "interest rate",
      "inflation",
      "wall street",
      "etf",
      "tether",
      "usdt",
    ],
    patterns: [/\$btc/i, /\$eth/i, /\$sol/i],
  },
  {
    genre: "Tech & Hardware",
    keywords: [
      "iphone",
      "ipad",
      "macbook",
      "apple watch",
      "airpods",
      "apple vision",
      "samsung galaxy",
      "galaxy s24",
      "galaxy s25",
      "galaxy z",
      "pixel 9",
      "pixel 8",
      "google pixel",
      "nvidia",
      "rtx",
      "geforce",
      "amd",
      "ryzen",
      "radeon",
      "intel",
      "snapdragon",
      "qualcomm",
      "smartphone",
      "laptop",
      "oled",
      "gpu",
      "cpu",
      "wearable",
      "headphone",
      "sony wh",
    ],
    patterns: [/\biphone\s?[0-9]+/i, /\brtx\s?[0-9]+/i, /\bpixel\s?[0-9]+/i, /\bgalaxy\s?s[0-9]+/i],
  },
  {
    genre: "Entertainment & Media",
    keywords: [
      "movie",
      "film",
      "cinema",
      "netflix",
      "hbo",
      "max",
      "disney",
      "marvel",
      "dc",
      "batman",
      "superman",
      "star wars",
      "dune",
      "oppenheimer",
      "barbie",
      "taylor swift",
      "beyonce",
      "drake",
      "kendrick",
      "kanye",
      "billie eilish",
      "bts",
      "album",
      "song",
      "concert",
      "tour",
      "oscar",
      "grammy",
      "actor",
      "actress",
    ],
    patterns: [/\btour\b/i, /\balbum\b/i, /\bseason\s?[0-9]+/i],
  },
  {
    genre: "Lifestyle & Brands",
    keywords: [
      "nike",
      "adidas",
      "jordan",
      "yeezy",
      "zara",
      "h&m",
      "gucci",
      "prada",
      "louis vuitton",
      "rolex",
      "starbucks",
      "mcdonalds",
      "sephora",
      "lululemon",
      "dyson",
      "patagonia",
      "sneaker",
    ],
    patterns: [/\bair jordan/i],
  },
];

/**
 * Classifies a topic into a standard genre bucket.
 * Uses exact match, regex patterns, and keyword heuristics.
 */
export function classifyTopicGenre(topicKey: string, aspect?: string): TopicGenre {
  const text = `${topicKey || ""} ${aspect || ""}`.toLowerCase().trim();
  if (!text) return "General & News";

  for (const rule of RULES) {
    // Check regex patterns
    if (rule.patterns) {
      for (const pattern of rule.patterns) {
        if (pattern.test(text)) {
          return rule.genre;
        }
      }
    }

    // Check keyword substring & token matches
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        return rule.genre;
      }
    }
  }

  return "General & News";
}

/**
 * Normalizes an arbitrary genre string into one of the canonical genres.
 */
export function normalizeGenre(rawGenre?: string | null): TopicGenre {
  if (!rawGenre) return "General & News";
  const trimmed = rawGenre.trim();
  if (trimmed in GENRE_DEFINITIONS) {
    return trimmed as TopicGenre;
  }
  return classifyTopicGenre(trimmed);
}

