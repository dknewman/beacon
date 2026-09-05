import { useColorScheme } from 'react-native';
import { darkColors, lightColors, type ColorPalette } from './colors';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ColorPalette;
}

export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: scheme === 'dark' ? darkColors : lightColors };
}
