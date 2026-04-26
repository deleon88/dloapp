import { useLangStore } from '@/stores/langStore'
import { translations, type TKey } from './translations'

export type { TKey }

export function useT() {
  const lang = useLangStore((s) => s.lang)
  return (key: TKey): string => translations[lang][key] ?? translations.en[key]
}
