// The signed-in user's own profile, as returned by get_my_profile() and the
// profile Edge Function. Other people's profiles only ever include id,
// display_name and avatar_id.
export type MyProfile = {
  id: string;
  display_name: string;
  avatar_id: number;
  home_city: string | null;
  over_18: boolean;
  created_at: string;
  updated_at: string;
  // Stride (PRD 4): empty until placed. Public, like the display name.
  stride: number | null;
  placement_runs: number;
  // Estimated Stride (PRD 4.5): the two answers are private to you; the
  // estimate is public and always shown as one.
  estimate_5k_s: number | null;
  estimate_weekly_km: number | null;
  estimated_stride: number | null;
};

export type StrideEstimate = { five_k_s: number | null; weekly_km: number };
