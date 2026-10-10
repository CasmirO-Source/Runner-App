// What the app can read about leagues. Matches the columns the database
// grants to signed-in users: nothing more is ever returned.
export type League = {
  id: string;
  name: string;
  owner_id: string;
  verified_only: boolean;
  member_limit: number;
  created_at: string;
};

export type Standing = {
  place: number;
  user_id: string;
  display_name: string;
  avatar_id: number;
  distance_m: number;
  run_count: number;
};

export type Invite = {
  code: string;
  expires_at: string;
};

export type Season = {
  id: string;
  month: string;
  starts_at: string;
  ends_at: string;
};
