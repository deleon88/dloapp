import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '@/i18n/translations'

interface LangStore {
  lang: Lang
  setLang: (lang: Lang) => void
}

/**
 * The browser's first preference between Spanish (any variant: es-MX, es-ES…)
 * and English; English if it lists neither.
 */
function browserLang(): Lang {
  try {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language]
    const first = prefs.map(l => l?.toLowerCase().slice(0, 2)).find(l => l === 'es' || l === 'en')
    return first === 'es' ? 'es' : 'en'
  } catch {
    return 'en'
  }
}

// Until someone picks a language on their profile, it follows the browser.
// persist only writes on setLang, so a choice made once wins from then on.
export const useLangStore = create<LangStore>()(
  persist(
    (set) => ({
      lang: browserLang(),
      setLang: (lang) => set({ lang }),
    }),
    { name: 'dloapp-lang' },
  ),
)
