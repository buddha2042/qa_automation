export type BaseUrlPreset = 'sisense_25_4_sp2' | 'manual';

export const SISENSE_BASE_URLS: Record<Exclude<BaseUrlPreset, 'manual'>, string> = {
  sisense_25_4_sp2: 'https://assureinsightsmtuat.dxc-ins.com/',
};

export const BASE_URL_PRESET_OPTIONS: Array<{ value: BaseUrlPreset; label: string }> = [
  { value: 'sisense_25_4_sp2', label: 'SISENSE_25.4_SP2' },
  { value: 'manual', label: 'Manual URL' },
];

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '').toLowerCase();

export const getPresetFromUrl = (value: string): BaseUrlPreset => {
  const normalized = normalizeUrl(value);
  if (!normalized) return 'manual';

  for (const [preset, presetUrl] of Object.entries(SISENSE_BASE_URLS) as Array<
    [Exclude<BaseUrlPreset, 'manual'>, string]
  >) {
    if (normalizeUrl(presetUrl) === normalized) return preset;
  }

  return 'manual';
};

export const getUrlForPreset = (preset: BaseUrlPreset, currentValue: string): string => {
  if (preset === 'manual') return currentValue;
  return SISENSE_BASE_URLS[preset];
};
