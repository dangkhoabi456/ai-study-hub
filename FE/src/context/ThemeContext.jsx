import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ThemeContext } from "./themeContextValue.js";
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  normalizeTheme,
} from "./themeConfig.js";

const STUDY_THEME_MAP = {
  current: "warm",
  white: "light",
  black: "dark",
};

function getStoredTheme() {
  if (typeof window === "undefined") return DEFAULT_THEME;
  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}

function persistTheme(theme) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

function applyTheme(nextTheme) {
  const theme = normalizeTheme(nextTheme);
  const legacyStudyTheme = STUDY_THEME_MAP[theme] || STUDY_THEME_MAP.current;

  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.studyTheme = legacyStudyTheme;

    if (document.body) {
      document.body.dataset.theme = theme;
      document.body.dataset.studyTheme = legacyStudyTheme;
    }
  }

  return theme;
}

const initialTheme = applyTheme(getStoredTheme());

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(initialTheme);

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  const setTheme = useCallback((nextTheme) => {
    const normalizedTheme = applyTheme(nextTheme);
    persistTheme(normalizedTheme);
    setThemeState(normalizedTheme);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      availableThemes: THEME_OPTIONS,
    }),
    [setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
