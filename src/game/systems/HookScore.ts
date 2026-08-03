/** Corrected hook scorer — inclusive, talks-with, not at, story-led */

export type ScoreLine = { rule: string; pts: number; max: number; why: string };

export function scoreHook(raw: string): {
  score: number;
  lines: ScoreLine[];
  shareWorthy: boolean;
} {
  const text = (raw || '').trim();
  const norm = text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
  const lower = norm.toLowerCase();
  const firstLine = norm.split(/\n/)[0] || '';
  const stripped = lower
    .replace(/https?:\/\/\S+/g, '')
    .replace(/#\w+/g, '')
    .replace(/@\w+/g, '')
    .trim();

  const lines: ScoreLine[] = [];
  let score = 0;

  const add = (
    rule: string,
    pts: number,
    max: number,
    ok: boolean,
    why: string
  ) => {
    const p = ok ? pts : 0;
    score += p;
    lines.push({ rule, pts: p, max, why });
  };

  // Inclusive we/us/our
  const inclusive = /\b(we|us|our|ours)\b/i.test(stripped);
  add(
    'Inclusive voice',
    20,
    20,
    inclusive,
    inclusive
      ? 'Uses we / us / our — talks as a peer, not a billboard.'
      : 'Add we / us / our when true. Inclusive openers travel further.'
  );

  // Talks with, not at (questions, curiosity, invite)
  const talksWith =
    /\?/.test(norm) ||
    /\b(curious|wondering|you|your)\b/i.test(stripped) ||
    /\b(how are you|what do you|have you)\b/i.test(stripped);
  const lectures =
    /\b(you need to|you must|stop doing|most people fail|here'?s why you'?re wrong)\b/i.test(
      stripped
    );
  add(
    'Talks with the reader',
    18,
    18,
    talksWith && !lectures,
    lectures
      ? 'This lectures. Soften into a shared problem or a real question.'
      : talksWith
        ? 'Invites the reader into the thought.'
        : 'Invite a reply — a real question or shared stake.'
  );

  // Human / story / vulnerability (not corporate)
  const human =
    /\b(i |i'|we |our |mistake|failed|wrong|cost|learned|rebuilt|honestly)\b/i.test(
      stripped
    );
  const corporate =
    /\b(synergy|leverag|thought leader|delighted to announce|in today'?s fast-paced)\b/i.test(
      stripped
    );
  add(
    'Human & specific',
    16,
    16,
    human && !corporate,
    corporate
      ? 'Corporate warm-up kills the scroll. Drop the throat-clearing.'
      : human
        ? 'Sounds like a person, not a press release.'
        : 'Add a real detail only you could write.'
  );

  // Something real (proof OR lesson OR change) — stats OK but not required
  const real =
    /\b(\d+|%|lessons?|mistake|changed|broke|worked|failed|client|revenue|pipeline|replies?)\b/i.test(
      stripped
    );
  add(
    'Gives something real',
    14,
    14,
    real,
    real
      ? 'Carries a real outcome, lesson, or detail.'
      : 'Name an outcome, a lesson, or a change — not vibes alone.'
  );

  // Opens with payoff (first line not warm-up)
  const warmUp =
    /^(in today|excited to|happy (monday|to share)|just wanted|hope everyone|as we all know|thoughts on)/i.test(
      firstLine
    );
  add(
    'Opens with the point',
    12,
    12,
    !warmUp && firstLine.length > 8,
    warmUp
      ? 'First line clears its throat. Lead with the interesting part.'
      : 'First line earns the second line.'
  );

  // Mobile cut survival
  const mobileOk = firstLine.length > 0 && firstLine.length <= 120;
  add(
    'Survives the mobile cut',
    8,
    8,
    mobileOk,
    mobileOk
      ? 'First line fits above the fold on a phone.'
      : 'Shorten the first line to ~120 characters.'
  );

  // Path to conversation
  const path =
    /\?/.test(norm) ||
    /\b(comment|reply|dm|template|curious|what about you|how do you)\b/i.test(
      stripped
    );
  add(
    'Path to a conversation',
    12,
    12,
    path,
    path
      ? 'Ends in a way someone can respond.'
      : 'Leave a soft next step — a question or low-friction ask.'
  );

  // Hashtag discipline
  const tags = (norm.match(/#\w+/g) || []).length;
  add(
    'Hashtag restraint',
    6,
    6,
    tags <= 4,
    tags <= 4
      ? tags === 0
        ? 'No hashtag spam.'
        : `${tags} hashtags — fine.`
      : 'Cap at 4 hashtags. More reads as noise.'
  );

  // Point of view
  const pov =
    /\b(i |we |most |nobody |stop |start |wrong|right|instead)\b/i.test(
      stripped
    ) && !corporate;
  add(
    'Point of view',
    14,
    14,
    pov,
    pov
      ? 'Takes a stance someone can agree or argue with.'
      : 'What do you believe that a peer might disagree with?'
  );

  score = Math.max(0, Math.min(100, score));
  const shareWorthy =
    inclusive && !lectures && real && score >= 70 && !corporate;

  return { score, lines, shareWorthy };
}
