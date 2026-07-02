export type LocaleCode =
  | 'tr'
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'pt'
  | 'ru'
  | 'ar'
  | 'ja'
  | 'ko'
  | 'zh'
  | 'nl'
  | 'pl';

export const supportedLanguages = [
  { code: 'tr', country: 'TR', flag: 'TR', nativeName: 'T\u00fcrk\u00e7e', name: 'Turkish' },
  { code: 'en', country: 'US', flag: 'US', nativeName: 'English', name: 'English' },
  { code: 'es', country: 'ES', flag: 'ES', nativeName: 'Espa\u00f1ol', name: 'Spanish' },
  { code: 'fr', country: 'FR', flag: 'FR', nativeName: 'Fran\u00e7ais', name: 'French' },
  { code: 'de', country: 'DE', flag: 'DE', nativeName: 'Deutsch', name: 'German' },
  { code: 'it', country: 'IT', flag: 'IT', nativeName: 'Italiano', name: 'Italian' },
  { code: 'pt', country: 'BR', flag: 'BR', nativeName: 'Portugu\u00eas', name: 'Portuguese' },
  { code: 'ru', country: 'RU', flag: 'RU', nativeName: 'Russian', name: 'Russian' },
  { code: 'ar', country: 'SA', flag: 'SA', nativeName: 'Arabic', name: 'Arabic' },
  { code: 'ja', country: 'JP', flag: 'JP', nativeName: 'Japanese', name: 'Japanese' },
  { code: 'ko', country: 'KR', flag: 'KR', nativeName: 'Korean', name: 'Korean' },
  { code: 'zh', country: 'CN', flag: 'CN', nativeName: 'Chinese', name: 'Chinese' },
  { code: 'nl', country: 'NL', flag: 'NL', nativeName: 'Nederlands', name: 'Dutch' },
  { code: 'pl', country: 'PL', flag: 'PL', nativeName: 'Polski', name: 'Polish' },
] as const;

export const languageFlags = Object.fromEntries(
  supportedLanguages.map((language) => [language.country, language.flag]),
) as Record<string, string>;

export const uiTranslations: Record<LocaleCode, Record<string, string>> = {
  tr: {
    home: 'Anasayfa',
    explore: 'Ke\u015ffet',
    program: 'Program',
    personal: 'Ki\u015fisel',
    settings: 'Ayarlar',
    notifications: 'Bildirimler',
    searchPlaceholder: 'Hareket, tarif, supplement ara',
    exerciseLibrary: 'Egzersiz K\u00fct\u00fcphanesi',
    languageSettings: 'Dil Ayarlar\u0131',
    save: 'Kaydet',
    retry: 'Tekrar Dene',
  },
  en: { home: 'Home', explore: 'Explore', program: 'Program', personal: 'Personal', settings: 'Settings', notifications: 'Notifications', searchPlaceholder: 'Search exercises, recipes, supplements', exerciseLibrary: 'Exercise Library', languageSettings: 'Language Settings', save: 'Save', retry: 'Retry' },
  es: { home: 'Inicio', explore: 'Explorar', program: 'Programa', personal: 'Personal', settings: 'Ajustes', notifications: 'Notificaciones', searchPlaceholder: 'Buscar ejercicios, recetas, suplementos', exerciseLibrary: 'Biblioteca de Ejercicios', languageSettings: 'Idioma', save: 'Guardar', retry: 'Reintentar' },
  fr: { home: 'Accueil', explore: 'Explorer', program: 'Programme', personal: 'Personnel', settings: 'R\u00e9glages', notifications: 'Notifications', searchPlaceholder: 'Rechercher exercices, recettes, suppl\u00e9ments', exerciseLibrary: 'Biblioth\u00e8que d\u2019exercices', languageSettings: 'Langue', save: 'Enregistrer', retry: 'R\u00e9essayer' },
  de: { home: 'Start', explore: 'Entdecken', program: 'Programm', personal: 'Pers\u00f6nlich', settings: 'Einstellungen', notifications: 'Mitteilungen', searchPlaceholder: '\u00dcbungen, Rezepte, Supplements suchen', exerciseLibrary: '\u00dcbungsbibliothek', languageSettings: 'Sprache', save: 'Speichern', retry: 'Erneut versuchen' },
  it: { home: 'Home', explore: 'Esplora', program: 'Programma', personal: 'Personale', settings: 'Impostazioni', notifications: 'Notifiche', searchPlaceholder: 'Cerca esercizi, ricette, integratori', exerciseLibrary: 'Libreria Esercizi', languageSettings: 'Lingua', save: 'Salva', retry: 'Riprova' },
  pt: { home: 'In\u00edcio', explore: 'Explorar', program: 'Programa', personal: 'Pessoal', settings: 'Configura\u00e7\u00f5es', notifications: 'Notifica\u00e7\u00f5es', searchPlaceholder: 'Buscar exerc\u00edcios, receitas, suplementos', exerciseLibrary: 'Biblioteca de Exerc\u00edcios', languageSettings: 'Idioma', save: 'Salvar', retry: 'Tentar novamente' },
  ru: { home: 'Home', explore: 'Search', program: 'Program', personal: 'Profile', settings: 'Settings', notifications: 'Notifications', searchPlaceholder: 'Search exercises, recipes, supplements', exerciseLibrary: 'Exercise Library', languageSettings: 'Language', save: 'Save', retry: 'Retry' },
  ar: { home: 'Home', explore: 'Explore', program: 'Program', personal: 'Personal', settings: 'Settings', notifications: 'Notifications', searchPlaceholder: 'Search exercises, recipes, supplements', exerciseLibrary: 'Exercise Library', languageSettings: 'Language', save: 'Save', retry: 'Retry' },
  ja: { home: 'Home', explore: 'Explore', program: 'Program', personal: 'Personal', settings: 'Settings', notifications: 'Notifications', searchPlaceholder: 'Search exercises, recipes, supplements', exerciseLibrary: 'Exercise Library', languageSettings: 'Language', save: 'Save', retry: 'Retry' },
  ko: { home: 'Home', explore: 'Explore', program: 'Program', personal: 'Personal', settings: 'Settings', notifications: 'Notifications', searchPlaceholder: 'Search exercises, recipes, supplements', exerciseLibrary: 'Exercise Library', languageSettings: 'Language', save: 'Save', retry: 'Retry' },
  zh: { home: 'Home', explore: 'Explore', program: 'Program', personal: 'Personal', settings: 'Settings', notifications: 'Notifications', searchPlaceholder: 'Search exercises, recipes, supplements', exerciseLibrary: 'Exercise Library', languageSettings: 'Language', save: 'Save', retry: 'Retry' },
  nl: { home: 'Home', explore: 'Ontdek', program: 'Programma', personal: 'Persoonlijk', settings: 'Instellingen', notifications: 'Meldingen', searchPlaceholder: 'Zoek oefeningen, recepten, supplementen', exerciseLibrary: 'Oefeningenbibliotheek', languageSettings: 'Taal', save: 'Opslaan', retry: 'Opnieuw' },
  pl: { home: 'Start', explore: 'Odkrywaj', program: 'Program', personal: 'Osobiste', settings: 'Ustawienia', notifications: 'Powiadomienia', searchPlaceholder: 'Szukaj cwiczen, przepisow, suplementow', exerciseLibrary: 'Biblioteka Cwiczen', languageSettings: 'Jezyk', save: 'Zapisz', retry: 'Ponow' },
};

export function translateUi(locale: LocaleCode, key: string) {
  return uiTranslations[locale]?.[key] ?? uiTranslations.tr[key] ?? key;
}
