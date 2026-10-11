import type { Language } from '../i18n';
const copies = {
  en: { back: 'Back', secure: 'Your account and session stay protected.', showPassword: 'Show password', hidePassword: 'Hide password', history: 'Conversion history' },
  tr: { back: 'Geri', secure: 'Hesabınız ve oturumunuz güvenle korunur.', showPassword: 'Şifreyi göster', hidePassword: 'Şifreyi gizle', history: 'Dönüşüm geçmişi' },
  zh: { back: '返回', secure: '您的帐户和会话受到安全保护。', showPassword: '显示密码', hidePassword: '隐藏密码', history: '转换历史' },
  fr: { back: 'Retour', secure: 'Votre compte et votre session sont protégés.', showPassword: 'Afficher le mot de passe', hidePassword: 'Masquer le mot de passe', history: 'Historique des conversions' },
  ru: { back: 'Назад', secure: 'Ваш аккаунт и сеанс защищены.', showPassword: 'Показать пароль', hidePassword: 'Скрыть пароль', history: 'История конвертаций' },
  de: { back: 'Zurück', secure: 'Ihr Konto und Ihre Sitzung sind geschützt.', showPassword: 'Passwort anzeigen', hidePassword: 'Passwort verbergen', history: 'Konvertierungsverlauf' },
  es: { back: 'Volver', secure: 'Tu cuenta y tu sesión están protegidas.', showPassword: 'Mostrar contraseña', hidePassword: 'Ocultar contraseña', history: 'Historial de conversiones' }
};
export const accountPageCopy = (language: Language) => copies[language] ?? copies.en;
