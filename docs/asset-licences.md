# Asset licences

Every font, image and icon in the app, the store listing and any website is
recorded here with its licence (PRD section 12, Appendix C #1). Nothing is
taken from image searches. Add a row before adding any asset.

## Fonts

| Asset | Used for | Source | Licence | Notes |
|---|---|---|---|---|
| Barlow Condensed SemiBold 600 and Bold 700 | Numbers and headings | npm `@expo-google-fonts/barlow-condensed` 0.4.1, from Google Fonts. Copyright 2017 The Barlow Project Authors (github.com/jpt/barlow) | SIL Open Font License 1.1 (font files). MIT (Expo's loader code) | OFL allows bundling in a commercial app. The font must not be sold on its own, and the name "Barlow" must not be used for a modified version. Licence text: `node_modules/@expo-google-fonts/barlow-condensed/LICENSE_FONT` |
| SF Pro (iPhone), Roboto (Android) | Body text | Supplied by the operating system | Platform licence | Not bundled. Used through the system font only. |

## Images and icons

| Asset | Used for | Source | Licence | Notes |
|---|---|---|---|---|
| Preset avatars (12) | Profile pictures | Original. Drawn in code from coloured shapes in `src/components/Avatar.tsx` | Owned by the project | No image files. |
| App icon and splash screen | Home screen, store | Not created yet | Not applicable | Expo's template icons were deliberately not copied. Add here when made. |

## Not yet used, record before adding

- SF Symbols (iPhone icons): Apple's licence allows use in apps on Apple platforms only. Record the terms when the first symbol is used.
- Material Symbols (Android icons): Apache License 2.0. Record when the first symbol is used.
- Age-grading tables (milestone 7): check and record the licence before use (PRD section 12).
