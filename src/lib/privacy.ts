// Privacy mode — pure helpers. Fake repo names + length-preserving redaction
// for display when the user toggles privacy on. Same repo id always picks the
// same fake name across sessions because the PRNG seed comes from a stable
// hash of the id.

import { hashString, mulberry32 } from "@/lib/sprite";

// Wordlists picked for RepoGarden's voice — calm-pretty mixed with the
// cute/small register. Adjective + noun combos should read like quiet little
// names of forest creatures or pocket-sized things.
const ADJECTIVES = [
  "tiny", "little", "small", "wee", "snug", "soft", "fuzzy", "plump",
  "sleepy", "drowsy", "quiet", "shy", "calm", "mellow", "dreamy",
  "mossy", "ferny", "leafy", "dewy", "misty", "foggy", "dappled",
  "velvet", "silky", "downy", "fluffy", "wooly", "tufted",
  "plum", "rosy", "amber", "honey", "buttery", "creamy", "minty",
  "lilac", "violet", "indigo", "navy", "slate", "pearly", "milky",
  "glimmery", "glowy", "starlit", "moonlit", "twilit", "dusky",
  "brave", "merry", "cheery", "jolly", "jaunty", "sprightly",
  "humble", "polite", "dainty", "demure", "modest", "petite",
  "pocket", "thimble", "button", "marble", "pebble",
  "cozy", "snuggly", "huggable", "nestled", "tucked",
  "dimpled", "freckled", "speckled", "spotted", "striped",
  "feral", "wild", "curious", "watchful", "thoughtful",
  "lazy", "lounging", "bobbing", "drifting", "floating",
  "quick", "darting", "hopping", "scampering", "skipping",
  "whiskered", "tufty", "bristly", "scruffy", "shaggy",
  "ancient", "olden", "weathered", "rustic", "homely",
  "salty", "sweet", "tart", "spicy", "warm",
  "bright", "shimmery", "twinkly", "sparkly", "glinty",
  "patient", "gentle", "tender", "kindly", "good",
  "round", "rolly", "blobby", "lumpy", "squishy",
  "blue", "green", "gold", "copper", "coral",
  "rainy", "sunny", "snowy", "cloudy", "breezy",
  "garden", "meadow", "thicket", "hedgerow", "brook",
  "pillowy", "puffy", "cottony", "feathery", "lacy",
  "shadowed", "lit", "warmlit", "hushed", "still"
];

const NOUNS = [
  "moss", "fern", "clover", "thistle", "bramble", "ivy", "lichen",
  "acorn", "pip", "seed", "sprout", "shoot", "bud", "bloom", "petal",
  "pebble", "stone", "cobble", "marble", "shell",
  "mole", "mouse", "vole", "shrew", "hedgehog",
  "fawn", "kit", "cub", "pup", "joey", "duckling",
  "wren", "finch", "robin", "sparrow", "starling", "tit", "lark",
  "moth", "beetle", "snail", "ladybug", "firefly", "cricket",
  "frog", "toad", "newt", "tadpole", "minnow", "guppy",
  "kitten", "cat", "tabby", "fox", "owl", "bat", "hare",
  "whisker", "paw", "ear", "tail", "snout", "nose",
  "lantern", "candle", "ember", "wick", "lamp",
  "kettle", "teapot", "biscuit", "scone", "dumpling",
  "mitten", "scarf", "sock", "boot", "shawl",
  "thimble", "spool", "button", "ribbon", "lace",
  "pocket", "satchel", "knapsack", "bundle", "parcel",
  "feather", "pinecone", "snowflake", "raindrop", "dewdrop",
  "comet", "spark", "star", "moonbeam", "sunbeam",
  "pond", "creek", "brook", "puddle", "rivulet",
  "cottage", "burrow", "den", "nook", "hollow",
  "lullaby", "hum", "whisper", "murmur", "sigh",
  "pillow", "quilt", "blanket", "cushion", "throw",
  "doodle", "scribble", "sketch", "tracing", "mark",
  "sprig", "bough", "twig", "bark", "stump",
  "nub", "wisp", "tuft", "puff", "fluff",
  "echo", "drift", "swirl", "eddy", "ripple",
  "honey", "syrup", "jam", "preserve", "marmalade",
  "marbleling", "pebbleling", "wisplet", "fernling", "mossling",
  "kindling", "tinder", "ash", "ember", "smoke",
  "cinder", "fleck", "mote", "speck", "dot"
];

const PLACEHOLDER_BLOCK = "▓";

/** 1-3 hyphenated words, deterministic by id. Weight: ~20% 1-word,
 *  ~60% 2-word, ~20% 3-word. */
export const fakeName = (id: string): string => {
  const rng = mulberry32(hashString(`privacy:${id}`));
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const lengthRoll = rng();
  const wordCount = lengthRoll < 0.2 ? 1 : lengthRoll < 0.8 ? 2 : 3;
  // Compose: noun alone (1 word), adj-noun (2), adj-adj-noun (3). Keeps the
  // pattern grammatical-ish so aliases read like quiet little names rather
  // than random word salads.
  if (wordCount === 1) return pick(NOUNS);
  if (wordCount === 2) return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
  return `${pick(ADJECTIVES)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`;
};

export type RedactKind = "subject" | "branch" | "author" | "path" | "note" | "vibe";

const NOTE_PLACEHOLDER = "▓▓ private content ▓▓";

// Per-vibe generic reasons — keep the focus card from going blank without
// leaking specifics (dirty file counts, commit counts, etc.).
const VIBE_GENERIC: Record<string, string> = {
  happy: "humming along quietly",
  noisy: "lots of recent activity",
  sleepy: "resting for a while",
  blocked: "something is in the way"
};

/** Length-preserving block redaction for short fields; placeholder text for
 *  freeform content where preserving length would just be misleading. */
export const redact = (text: string, kind: RedactKind = "subject"): string => {
  if (!text) return text;
  if (kind === "note") return NOTE_PLACEHOLDER;
  if (kind === "vibe") return VIBE_GENERIC[text.toLowerCase()] ?? "quietly waiting";
  if (kind === "path") {
    // Tildify-friendly: keep the leading ~ if present so the focus card still
    // shows "lives somewhere on disk" without exposing the exact path.
    return text.startsWith("~") ? `~/${PLACEHOLDER_BLOCK.repeat(6)}` : PLACEHOLDER_BLOCK.repeat(Math.min(text.length, 12));
  }
  // subject, branch, author: same-length block.
  return PLACEHOLDER_BLOCK.repeat(text.length);
};
