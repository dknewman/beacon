export interface ColorPalette {
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  onAccent: string;
}

export const lightColors: ColorPalette = {
  background: '#F5F6F8',
  surface: '#FFFFFF',
  textPrimary: '#111418',
  textSecondary: '#5B6470',
  accent: '#1F6FEB',
  onAccent: '#FFFFFF',
};

export const darkColors: ColorPalette = {
  background: '#0F1216',
  surface: '#1A1F26',
  textPrimary: '#F2F4F7',
  textSecondary: '#9AA4B2',
  accent: '#4C8DFF',
  onAccent: '#0B1220',
};
