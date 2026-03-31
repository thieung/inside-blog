/** i18n types and helpers for build-time translation injection */

export interface TranslationMap {
  vi: Record<string, string>;
  en: Record<string, string>;
  zh: Record<string, string>;
  ja: Record<string, string>;
}

export type Lang = 'vi' | 'en' | 'zh' | 'ja';

/** Get translation object for a given locale, fallback to Vietnamese */
export function getTranslation(
  translations: TranslationMap,
  locale: string | undefined,
): Record<string, string> {
  const lang = (locale || 'vi') as Lang;
  return translations[lang] || translations.vi;
}

/** Build locale-prefixed URL. Vietnamese (default) has no prefix. */
export function getLocalizedUrl(
  slug: string,
  locale: string,
  defaultLocale = 'vi',
): string {
  const base = `/posts/${slug}`;
  return locale === defaultLocale ? base : `/${locale}${base}`;
}
