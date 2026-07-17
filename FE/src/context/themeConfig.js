export const THEME_STORAGE_KEY = "aiStudyHub.theme";
export const DEFAULT_THEME = "current";

export const THEME_OPTIONS = [
  {
    value: "current",
    label: "Current",
    description: "Warm cream and brown palette currently used across StudyHub.",
  },
  {
    value: "white",
    label: "White",
    description: "Clean bright surfaces, light grays, and high contrast text.",
  },
  {
    value: "black",
    label: "Black",
    description: "Low-light interface with dark panels and muted text.",
  },
];

const SUPPORTED_THEMES = new Set(THEME_OPTIONS.map((theme) => theme.value));

const LEGACY_THEME_MAP = {
  warm: "current",
  light: "white",
  dark: "black",
};

export function normalizeTheme(theme) {
  const mappedTheme = LEGACY_THEME_MAP[theme] || theme;
  return SUPPORTED_THEMES.has(mappedTheme) ? mappedTheme : DEFAULT_THEME;
}
