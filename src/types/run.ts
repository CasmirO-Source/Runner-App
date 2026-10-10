// Your own runs, as the database shows them to you (column grants).
export type MyRun = {
  id: string;
  source: 'health' | 'manual';
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
  source: 'health' | 'manual';
};

export type LogResult = {
  status: 'accepted' | 'flagged';
  run_id: string;
  reasons: string[];
};
