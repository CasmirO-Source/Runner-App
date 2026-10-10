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
};
