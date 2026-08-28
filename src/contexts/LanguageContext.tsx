import React, { createContext, useState, useContext, ReactNode } from 'react';
import { translations, Language, TranslationKey } from '../i18n/translations';

const STORAGE_KEY = 'ssp_language';

interface LanguageContextType {
  language: Language;
  // `opts.manual` en `false` es para cuando ParentDashboard aplica el
  // default del colegio (no cuenta como elección del padre); por defecto
  // (o `true`) es una elección manual y se guarda en localStorage.
  setLanguage: (lang: Language, opts?: { manual?: boolean }) => void;
  // El padre eligió el idioma él mismo (vs. es solo el default que puso el
  // colegio) — así ParentDashboard sabe si debe respetar esa elección o
  // seguir aplicando el default del tenant cuando cambie.
  hasManualLanguage: boolean;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function readStoredLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'en' || stored === 'es' ? stored : null;
  } catch {
    return null;
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage() || 'en');
  const [hasManualLanguage, setHasManualLanguage] = useState<boolean>(() => readStoredLanguage() !== null);

  const setLanguage = (lang: Language, opts?: { manual?: boolean }) => {
    setLanguageState(lang);
    const manual = opts?.manual !== false;
    if (manual) {
      setHasManualLanguage(true);
      try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    }
  };

  const t = (key: TranslationKey): string => {
    return translations[language][key] || translations['en'][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, hasManualLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
