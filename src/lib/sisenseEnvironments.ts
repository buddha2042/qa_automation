export type Environment = 'regular' | 'refactor';
export type BaseUrlPreset = Environment | 'manual';

export const SISENSE_BASE_URLS: Record<Environment, string> = {
  regular: 'https://sisensemtprod2025-1.dxc-ins.com/',
  refactor: 'https://sisensemtuat2025-1.dxc-ins.com/',
};

export const BASE_URL_PRESET_OPTIONS: Array<{ value: BaseUrlPreset; label: string }> = [
  { value: 'regular', label: 'Regular - MT PROD NEW' },
  { value: 'refactor', label: 'Refactor -  MT UAT NEW' },
  { value: 'manual', label: 'Manual URL' },
];

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '').toLowerCase();

export const getPresetFromUrl = (value: string): BaseUrlPreset => {
  const normalized = normalizeUrl(value);
  if (!normalized) return 'manual';

  for (const [preset, presetUrl] of Object.entries(SISENSE_BASE_URLS) as Array<[Environment, string]>) {
    if (normalizeUrl(presetUrl) === normalized) return preset;
  }

  return 'manual';
};

export const getUrlForPreset = (preset: BaseUrlPreset, currentValue: string): string => {
  if (preset === 'manual') return currentValue;
  return SISENSE_BASE_URLS[preset];
};
