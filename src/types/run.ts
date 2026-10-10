// Verified (Health), typed in, or read from a screenshot and confirmed.
export type RunSource = 'health' | 'manual' | 'screenshot';

// Your own runs, as the database shows them to you (column grants).
export type MyRun = {
  id: string;
  source: RunSource;
  started_at: string;
  distance_m: number;
  duration_s: number;
  status: 'accepted' | 'flagged' | 'superseded';
  flag_reasons: string[];
  created_at: string;
};

// A league-mate's run: distance, date and source only (owner decision 7).
export type MateRun = {
  user_id: string;
  display_name: string;
  run_date: string;
  distance_m: number;
  source: RunSource;
};

export type LogResult = {
  status: 'accepted' | 'flagged';
  run_id: string;
  reasons: string[];
};

// What the screenshot reader found (screenshot-read). Dates and times are as
// the screenshot shows them, in UK time. start_time is null when the
// screenshot does not show one.
export type Reading = {
  id: string;
  expires_at: string;
  distance_m: number;
  duration_s: number;
  date: string;
  start_time: string | null;
  source_app: string | null;
};

// screenshot-confirm: the server decides whether the run was saved as a
// screenshot run (unchanged) or a typed-in run (changed).
export type ConfirmResult = LogResult & { saved_as: 'screenshot' | 'manual' };
