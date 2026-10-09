// Preset avatars (PRD 5.1: no uploaded photos). Each one is a flat disc in one
// of three tones with a simple geometric mark, drawn in code from Views, so
// there are no image files and no licences to track.
//
// The database stores only the number (1 to 12). Migration checks must accept
// exactly the IDs in this list.

export type AvatarMark = 'dot' | 'bar' | 'ring' | 'split';

export type AvatarPreset = {
  id: number;
  tone: 0 | 1 | 2;
  mark: AvatarMark;
  label: string;
};

const marks: AvatarMark[] = ['dot', 'bar', 'ring', 'split'];
const toneNames = ['Orange', 'Ink', 'Stone'] as const;
const markNames: Record<AvatarMark, string> = { dot: 'dot', bar: 'bar', ring: 'ring', split: 'half' };

export const AVATARS: readonly AvatarPreset[] = ([0, 1, 2] as const).flatMap((tone) =>
  marks.map((mark, i) => ({
    id: tone * marks.length + i + 1,
    tone,
    mark,
    label: `${toneNames[tone]} ${markNames[mark]}`,
  })),
);

export const AVATAR_MIN_ID = 1;
export const AVATAR_MAX_ID = AVATARS.length;
