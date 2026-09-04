/**
 * Seed prose. Kept apart from the seeding logic so the demo city's copy can be
 * edited without touching the insert order.
 */

export const LAUNCH_BRIEF_PARAGRAPHS = {
  intro:
    "Harbor District is the launch we have been circling for two quarters. This brief is the single place the shape of that launch is written down: what we are shipping, what we are deliberately not shipping, and who is holding each piece. If something here disagrees with a conversation you had in a hallway, this document wins until someone edits it.",
  scope:
    "The release covers the ingest pipeline, the reviewer queue, and the public status page. Everything else -- billing changes, the mobile shell, the partner API -- is explicitly out. We have cut scope twice already and both cuts held, which is the main reason the date is still credible.",
  risks:
    "The largest risk is the reviewer queue: it is the only component without a second owner, and it is the one place where a bad week of latency turns into a support problem rather than an engineering one. The second risk is that the status page depends on a vendor we have never load-tested against. Neither risk is severe enough to move the date, but both are worth a weekly look.",
  cadence:
    "We review this brief every Monday. Anything that changes the date, the scope, or an owner gets written here first and announced second -- not the other way round. The Roadmap warehouse next door holds the per-item detail; this page holds the argument.",
};

export const LAUNCH_BRIEF_CHECKLIST = [
  { text: "Freeze the ingest schema", checked: true },
  { text: "Reviewer queue: name a second owner", checked: false },
  { text: "Load-test the status page vendor", checked: false },
  { text: "Draft the customer note", checked: true },
  { text: "Dry run the rollback", checked: false },
];

export const READING_NOTES_PARAGRAPHS = [
  "Notes on things read, kept deliberately short. If a note grows past a screen it wants to be its own building.",
  "The pattern that keeps recurring: tools that make you name where something lives are easier to search later than tools that file everything for you. Retrieval is a spatial act more often than it is a semantic one.",
  "Worth revisiting: the argument that a knowledge base is mostly a graph pretending to be a tree, and that the pretending is the expensive part.",
];

export const RECIPES_PARAGRAPHS = [
  "Things worth cooking twice. Quantities are approximate and the timings assume a pan that runs hot.",
  "Braises freeze better than anything else here. Double them and put half away; the second night is always the better one.",
];

export const PINEGROVE_PARAGRAPHS = [
  "Pinegrove was a side project about generative maps. It stopped rather than failed -- the interesting part had already been learned by the time it was abandoned.",
  "Kept because the terrain notes are still useful, and because an archived project that stays faintly connected reads more honestly than one that disappears.",
];

/** Small-town newspaper voice. These become the ticker at the bottom of the map. */
export const ACTIVITY_HEADLINES: ReadonlyArray<{ verb: string; headline: string }> = [
  { verb: "created", headline: "Ideaburg incorporated; three districts surveyed" },
  { verb: "created", headline: "Harbor District breaks ground on the waterfront" },
  { verb: "created", headline: "Library opens on Maple Row — Launch Brief now on file" },
  { verb: "created", headline: "Warehouse commissioned; Roadmap stock arrives in twelve crates" },
  { verb: "linked", headline: "New street paved between Launch Brief and Roadmap" },
  { verb: "created", headline: "Newsstand opens by the harbour gate, five titles in stock" },
  { verb: "updated", headline: "Roadmap re-shelved: four items moved to Building" },
  { verb: "created", headline: "Old Town charters its first two libraries" },
  { verb: "linked", headline: "Highway opens between Harbor District and Old Town" },
  { verb: "created", headline: "Bridge completed over the Ide; carts crossing by noon" },
  { verb: "pinned", headline: "Seven notices appear on the Harbor plaza board overnight" },
  { verb: "updated", headline: "Reading Notes expanded — three new sections" },
  { verb: "linked", headline: "Dirt track cut through to Pinegrove" },
  { verb: "archived", headline: "Pinegrove boarded up; terrain notes left on the shelf" },
  { verb: "updated", headline: "Launch Brief revised: reviewer queue still wants a second owner" },
];
