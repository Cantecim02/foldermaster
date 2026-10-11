import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Alert,
  findNodeHandle,
  KeyboardAvoidingView,
  BackHandler,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { accountPageCopy } from "../services/accountPageCopy";
import { Feather } from "@expo/vector-icons";
import { Language } from "../i18n";
import {
  AccountUser,
  AuthApiError,
  deleteAccount,
  loginAccount,
  logoutAccount,
  registerAccount,
  getRegistrationPolicy
} from "../services/authService";
import { accountDisplayName } from "../services/accountValidation";
import { finishDeletedAccount } from "../services/accountDeletion";
import { authErrorMessage, profileCopy } from "../services/authMessages";
import { getTheme } from "../theme";
import { InstagramGradient } from "./ui/InstagramGradient";

type Theme = ReturnType<typeof getTheme>;
type AccountMode = "login" | "register";
type LegalKey = "privacy" | "terms";
export type AccountLifecycleEvent = "created" | "deleted";
export type AccountSessionEndReason = "signedOut" | "deleted";

type Props = {
  visible: boolean;
  isLandscape: boolean;
  language: Language;
  theme: Theme;
  user: AccountUser | null;
  onUserChange: (user: AccountUser | null) => void;
  onLifecycleSuccess: (event: AccountLifecycleEvent) => void;
  onSessionEnd: (reason: AccountSessionEndReason) => Promise<void>;
  onClose: () => void;
  onOpenLegal: (key: LegalKey) => void;
  monetizationEnabled?: boolean;
  onManageSubscription?: () => void;
  onOpenHistory: () => void;
  legalOpen: boolean;
};

type Copy = {
  title: string;
  subtitle: string;
  login: string;
  register: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  passwordHint: string;
  acceptPrefix: string;
  terms: string;
  and: string;
  privacy: string;
  acceptSuffix: string;
  secureNotice: string;
  mismatch: string;
  acceptanceRequired: string;
  missingFields: string;
  accountExists: string;
  invalidCredentials: string;
  networkError: string;
  genericError: string;
  signedInAs: string;
  signOut: string;
  deleteAccount: string;
  deleteWarning: string;
  deleteConfirm: string;
  cancel: string;
  benefitsTitle: string;
  benefits: string[];
  historyLoginPrompt: string;
  accountStatus: string;
  deleteSubscriptionWarning: string;
  manageSubscription: string;
};

const en: Copy = {
  title: "Editio account",
  subtitle: "Sign in or create an account securely.",
  login: "Sign in",
  register: "Create account",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  password: "Password",
  confirmPassword: "Repeat password",
  passwordHint: "At least 10 characters with uppercase, lowercase, and a number.",
  acceptPrefix: "I have read and accept the",
  terms: "Terms of Use",
  and: "and",
  privacy: "Privacy Policy",
  acceptSuffix: ".",
  secureNotice: "Passwords are protected with a one-way hash. Only conversion metadata is saved; converted files are not stored in your account.",
  mismatch: "Passwords do not match.",
  acceptanceRequired: "You must accept the Terms of Use and Privacy Policy.",
  missingFields: "Complete all required fields.",
  accountExists: "An account already exists for this email address.",
  invalidCredentials: "Email address or password is incorrect.",
  networkError: "The account service is currently unavailable. Please try again.",
  genericError: "The account request could not be completed.",
  signedInAs: "Signed in as",
  signOut: "Sign out",
  deleteAccount: "Delete account",
  deleteWarning: "Enter your password to permanently delete your account and active sessions.",
  deleteConfirm: "Permanently delete",
  cancel: "Cancel",
  benefitsTitle: "Create your Editio account",
  benefits: [
    "Keep conversion records in your account",
    "Review file name, format, status, and date in one place",
    "Access your account history again after signing back in",
    "View your conversion records on devices signed in to the same account"
  ],
  historyLoginPrompt: "Sign in to keep and view your conversion history.",
  accountStatus: "Active account",
  deleteSubscriptionWarning: "Deleting your Editio account does not cancel an Apple subscription. Manage or cancel it in your Apple subscription settings.",
  manageSubscription: "Manage Apple subscription"
};

const copies: Record<Language, Copy> = {
  en,
  tr: {
    ...en,
    title: "Editio hesabı", subtitle: "Güvenli biçimde oturum açın veya hesap oluşturun.", login: "Oturum aç", register: "Hesap oluştur",
    firstName: "Ad", lastName: "Soyad", email: "E-posta", password: "Şifre", confirmPassword: "Şifreyi tekrar girin",
    passwordHint: "En az 10 karakter; büyük harf, küçük harf ve sayı içermeli.", acceptPrefix: "Okudum ve", terms: "Kullanım Koşulları", and: "ile", privacy: "Gizlilik Politikası", acceptSuffix: "metinlerini kabul ediyorum.",
    secureNotice: "Şifreler tek yönlü hash ile korunur. Yalnızca dönüşüm bilgileri kaydedilir; dönüştürülen dosyalar hesabınızda saklanmaz.", mismatch: "Şifreler eşleşmiyor.", acceptanceRequired: "Kullanım Koşulları ve Gizlilik Politikası'nı kabul etmelisiniz.",
    missingFields: "Tüm zorunlu alanları doldurun.", accountExists: "Bu e-posta adresiyle zaten bir hesap var.", invalidCredentials: "E-posta adresi veya şifre hatalı.",
    networkError: "Hesap servisine şu anda ulaşılamıyor. Lütfen yeniden deneyin.", genericError: "Hesap işlemi tamamlanamadı.", signedInAs: "Oturum açılan hesap", signOut: "Çıkış yap", deleteAccount: "Hesabı sil",
    deleteWarning: "Hesabınızı ve aktif oturumlarınızı kalıcı olarak silmek için şifrenizi girin.", deleteConfirm: "Kalıcı olarak sil", cancel: "Vazgeç",
    benefitsTitle: "Editio hesabı oluşturun",
    benefits: ["Dönüşüm kayıtlarınızı hesabınızda saklayın", "Dosya adı, format, durum ve tarih bilgilerini tek yerde görün", "Çıkış yapıp yeniden girdiğinizde hesap geçmişinize erişin", "Aynı hesapla giriş yaptığınız cihazlarda dönüşüm kayıtlarınızı görüntüleyin"],
    historyLoginPrompt: "Geçmişinizi kaydetmek ve görmek için giriş yapın.", accountStatus: "Aktif hesap",
    deleteSubscriptionWarning: "Editio hesabınızı silmek Apple aboneliğinizi iptal etmez. Aboneliğinizi Apple abonelik ayarlarından yönetmeli veya iptal etmelisiniz.",
    manageSubscription: "Apple aboneliğini yönet"
  },
  zh: { ...en,
    secureNotice: "密码通过单向哈希保护。仅保存转换信息，转换后的文件不会存储在您的帐户中。",
    deleteWarning: "请输入密码以永久删除您的帐户和所有有效会话。",
    deleteSubscriptionWarning: "删除 Editio 帐户不会取消 Apple 订阅。请在 Apple 订阅设置中管理或取消订阅。",
    manageSubscription: "管理 Apple 订阅",
    title: "Editio 帐户", subtitle: "安全登录或创建帐户。", login: "登录", register: "创建帐户", firstName: "名字", lastName: "姓氏", email: "电子邮件", password: "密码", confirmPassword: "再次输入密码",
    acceptPrefix: "我已阅读并接受", terms: "使用条款", and: "和", privacy: "隐私政策", acceptSuffix: "。", signedInAs: "已登录", signOut: "退出登录", deleteAccount: "删除帐户", deleteConfirm: "永久删除", cancel: "取消",
    benefitsTitle: "创建 Editio 帐户", benefits: ["将转换记录保存在您的帐户中", "集中查看文件名、格式、状态和日期", "重新登录后继续访问帐户历史记录", "在登录同一帐户的设备上查看转换记录"], historyLoginPrompt: "登录后可保存并查看转换历史。", accountStatus: "帐户已启用"
  },
  fr: { ...en,
    secureNotice: "Les mots de passe sont protégés par un hachage à sens unique. Seules les informations de conversion sont enregistrées ; les fichiers convertis ne sont pas stockés dans votre compte.",
    deleteWarning: "Saisissez votre mot de passe pour supprimer définitivement votre compte et vos sessions actives.",
    deleteSubscriptionWarning: "Supprimer votre compte Editio n’annule pas un abonnement Apple. Gérez ou annulez cet abonnement dans les réglages d’abonnement Apple.",
    manageSubscription: "Gérer l’abonnement Apple",
    title: "Compte Editio", subtitle: "Connectez-vous ou créez un compte sécurisé.", login: "Connexion", register: "Créer un compte", firstName: "Prénom", lastName: "Nom", email: "E-mail", password: "Mot de passe", confirmPassword: "Répéter le mot de passe",
    acceptPrefix: "J'ai lu et j'accepte les", terms: "Conditions d'utilisation", and: "et la", privacy: "Politique de confidentialité", acceptSuffix: ".", signedInAs: "Connecté en tant que", signOut: "Déconnexion", deleteAccount: "Supprimer le compte", deleteConfirm: "Supprimer définitivement", cancel: "Annuler",
    benefitsTitle: "Créez votre compte Editio", benefits: ["Conservez vos conversions dans votre compte", "Consultez le nom, le format, l’état et la date au même endroit", "Retrouvez l’historique de votre compte après reconnexion", "Affichez vos conversions sur les appareils connectés au même compte"], historyLoginPrompt: "Connectez-vous pour enregistrer et voir votre historique.", accountStatus: "Compte actif"
  },
  ru: {
    ...en, title: "Аккаунт Editio", subtitle: "Безопасно войдите или создайте аккаунт.", login: "Войти", register: "Создать аккаунт", firstName: "Имя", lastName: "Фамилия", email: "Эл. почта", password: "Пароль", confirmPassword: "Повторите пароль",
    acceptPrefix: "Я прочитал и принимаю", terms: "Условия использования", and: "и", privacy: "Политику конфиденциальности", acceptSuffix: ".", signedInAs: "Выполнен вход", signOut: "Выйти", deleteAccount: "Удалить аккаунт", deleteConfirm: "Удалить навсегда", cancel: "Отмена",
    benefitsTitle: "Создайте аккаунт Editio", benefits: ["Храните записи конвертаций в аккаунте", "Просматривайте имя файла, формат, статус и дату в одном месте", "Получайте доступ к истории после повторного входа", "Просматривайте записи на устройствах с тем же аккаунтом"], historyLoginPrompt: "Войдите, чтобы сохранять и просматривать историю.", accountStatus: "Аккаунт активен",
    secureNotice: "Пароли защищены односторонним хешированием. Сохраняются только сведения о конвертации; преобразованные файлы не хранятся в вашем аккаунте.",
    deleteWarning: "Введите пароль, чтобы навсегда удалить аккаунт и все активные сеансы.",
    deleteSubscriptionWarning: "Удаление аккаунта Editio не отменяет подписку Apple. Управляйте подпиской или отмените её в настройках подписок Apple.",
    manageSubscription: "Управление подпиской Apple"
  },
  de: {
    ...en, title: "Editio-Konto", subtitle: "Sicher anmelden oder ein Konto erstellen.", login: "Anmelden", register: "Konto erstellen", firstName: "Vorname", lastName: "Nachname", email: "E-Mail", password: "Passwort", confirmPassword: "Passwort wiederholen",
    acceptPrefix: "Ich habe die", terms: "Nutzungsbedingungen", and: "und die", privacy: "Datenschutzerklärung", acceptSuffix: "gelesen und akzeptiere sie.", signedInAs: "Angemeldet als", signOut: "Abmelden", deleteAccount: "Konto löschen", deleteConfirm: "Dauerhaft löschen", cancel: "Abbrechen",
    benefitsTitle: "Editio-Konto erstellen", benefits: ["Konvertierungseinträge im Konto speichern", "Dateiname, Format, Status und Datum zentral ansehen", "Nach erneuter Anmeldung wieder auf den Kontoverlauf zugreifen", "Einträge auf Geräten mit demselben Konto ansehen"], historyLoginPrompt: "Melden Sie sich an, um Ihren Verlauf zu speichern und anzusehen.", accountStatus: "Aktives Konto",
    secureNotice: "Passwörter werden durch einen Einweg-Hash geschützt. Nur Konvertierungsinformationen werden gespeichert; konvertierte Dateien werden nicht in Ihrem Konto gespeichert.",
    deleteWarning: "Geben Sie Ihr Passwort ein, um Ihr Konto und alle aktiven Sitzungen dauerhaft zu löschen.",
    deleteSubscriptionWarning: "Das Löschen Ihres Editio-Kontos kündigt kein Apple-Abonnement. Verwalten oder kündigen Sie es in den Apple-Abonnementeinstellungen.",
    manageSubscription: "Apple-Abonnement verwalten"
  },
  es: {
    ...en, title: "Cuenta Editio", subtitle: "Inicia sesión o crea una cuenta segura.", login: "Iniciar sesión", register: "Crear cuenta", firstName: "Nombre", lastName: "Apellido", email: "Correo", password: "Contraseña", confirmPassword: "Repetir contraseña",
    acceptPrefix: "He leído y acepto los", terms: "Términos de uso", and: "y la", privacy: "Política de privacidad", acceptSuffix: ".", signedInAs: "Sesión iniciada como", signOut: "Cerrar sesión", deleteAccount: "Eliminar cuenta", deleteConfirm: "Eliminar permanentemente", cancel: "Cancelar",
    benefitsTitle: "Crea tu cuenta Editio", benefits: ["Guarda los registros de conversión en tu cuenta", "Consulta nombre, formato, estado y fecha en un solo lugar", "Recupera el historial de tu cuenta al volver a iniciar sesión", "Consulta tus registros en dispositivos con la misma cuenta"], historyLoginPrompt: "Inicia sesión para guardar y ver tu historial.", accountStatus: "Cuenta activa",
    secureNotice: "Las contraseñas se protegen con un hash unidireccional. Solo se guardan los datos de conversión; los archivos convertidos no se almacenan en tu cuenta.",
    deleteWarning: "Introduce tu contraseña para eliminar permanentemente tu cuenta y todas las sesiones activas.",
    deleteSubscriptionWarning: "Eliminar tu cuenta Editio no cancela una suscripción de Apple. Gestiona o cancela la suscripción en los ajustes de suscripciones de Apple.",
    manageSubscription: "Gestionar suscripción de Apple"
  }
};

export function AccountScreen({
  visible,
  isLandscape,
  language,
  theme,
  user,
  onUserChange,
  onLifecycleSuccess,
  onSessionEnd,
  onClose,
  onOpenLegal,
  monetizationEnabled = false,
  onManageSubscription,
  onOpenHistory,
  legalOpen
}: Props) {
  const copy = copies[language] ?? en;
  const page = accountPageCopy(language);
  const [mode, setMode] = useState<AccountMode>("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [minimumAge, setMinimumAge] = useState<number | null>(null);
  const [policyRetry, setPolicyRetry] = useState(0);
  const [policyError, setPolicyError] = useState<unknown>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const formScrollRef = useRef<ScrollView>(null);
  const firstNameRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const busyRef = useRef(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const borderColor = theme.isDark ? theme.colors.border : "#C7C9D1";
  const fieldColor = theme.colors.surfaceAlt;

  const displayName = useMemo(() => user ? accountDisplayName(user) : "", [user]);

  const revealInput = (inputRef: RefObject<TextInput | null>) => {
    if (Platform.OS === "web") return;
    const delay = Platform.OS === "ios" ? 140 : 80;
    setTimeout(() => {
      const inputHandle = findNodeHandle(inputRef.current);
      if (!inputHandle) return;
      formScrollRef.current
        ?.getScrollResponder()
        ?.scrollResponderScrollNativeHandleToKeyboard(inputHandle, 112, true);
    }, delay);
  };

  const focusInput = (inputRef: RefObject<TextInput | null>) => {
    inputRef.current?.focus();
    revealInput(inputRef);
  };

  useEffect(() => {
    if (!visible) {
      setPassword("");
      setConfirmPassword("");
      setPasswordVisible(false);
      setError(null);
      setDeleting(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || legalOpen) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => listener.remove();
  }, [visible, legalOpen, onClose]);

  const profile = profileCopy(language, minimumAge ?? 13);
  useEffect(() => {
    if (!visible || mode !== "register" || user) return;
    let active = true;
    setMinimumAge(null); setAgeConfirmed(false); setPolicyError(null);
    getRegistrationPolicy().then(policy => { if (active) setMinimumAge(policy.minimumAge); })
      .catch(caught => { if (active) setPolicyError(caught); });
    return () => { active = false; };
  }, [visible, mode, user, policyRetry]);

  const submit = async () => {
    if (busyRef.current) return;
    setError(null);
    if (!email.trim() || !password || (mode === "register" && !confirmPassword)) {
      setError(profile.missing); return;
    }
    if (mode === "register" && password !== confirmPassword) { setError(profile.mismatch); return; }
    if (mode === "register" && minimumAge === null) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const nextUser = mode === "register"
        ? await registerAccount({ firstName, lastName, email: email.trim(), password, acceptedTerms, ageConfirmed, minimumAge: minimumAge! })
        : await loginAccount(email, password);
      onUserChange(nextUser);
      onClose();
      setPassword("");
      setConfirmPassword("");
      setError(null);
      if (mode === "register") {
        setFirstName("");
        setLastName("");
        setAgeConfirmed(false);
        setEmail("");
        setAcceptedTerms(false);
        onLifecycleSuccess("created");
      }
    } catch (caught) {
      setError(authErrorMessage(caught, language));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await logoutAccount();
      onUserChange(null);
      await onSessionEnd("signedOut");
    } catch (caught) {
      onUserChange(null);
      try { await onSessionEnd("signedOut"); } catch { /* Device session already blocked. */ }
      setError(authErrorMessage(caught, language));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    if (busyRef.current) return;
    if (!password) {
      setError(profile.missing);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAccount(password);
      await finishDeletedAccount(result, {
        clearUi: () => {
          onUserChange(null);
          setFirstName("");
          setLastName("");
          setAgeConfirmed(false);
          setEmail("");
          setPassword("");
          setConfirmPassword("");
          setAcceptedTerms(false);
          setDeleting(false);
        },
        onSuccess: () => onLifecycleSuccess("deleted"),
        endSession: () => onSessionEnd("deleted"),
        onCleanupPending: () => Alert.alert(authErrorMessage(new AuthApiError("ACCOUNT_DELETED_CLEANUP_PENDING"), language))
      });
    } catch (caught) {
      setError(authErrorMessage(caught, language));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (!visible) return null;
  return (
    <KeyboardAvoidingView testID="account-screen" accessibilityViewIsModal style={[styles.screen, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.page}>
          <View style={styles.header}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={page.back} style={[styles.close, { backgroundColor: fieldColor }]} onPress={() => { Keyboard.dismiss(); onClose(); }}>
              <Feather name="arrow-left" size={22} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: theme.colors.text }]}>{copy.title}</Text>
              <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{page.secure}</Text>
            </View>

          </View>

          <ScrollView
            ref={formScrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.content, isLandscape && styles.contentLandscape]}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {user ? (
              <View style={styles.signedIn}>
                <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}>
                  <Text style={[styles.avatarText, { color: theme.colors.primary }]}>{displayName.slice(0, 1).toLocaleUpperCase()}</Text>
                </View>
                <Text style={[styles.signedLabel, { color: theme.colors.muted }]}>{copy.signedInAs}</Text>
                <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.signedName, { color: theme.colors.text }]}>{displayName}</Text>
                <Text style={[styles.signedEmail, { color: theme.colors.muted }]}>{user.email}</Text>
                {user.username ? <Text selectable style={[styles.signedEmail, { color: theme.colors.text }]}>{profile.username}: {user.username}</Text> : null}
                <View style={[styles.planBadge, { backgroundColor: theme.colors.accentSoft }]}>
                  <Feather name="star" size={13} color={theme.colors.accent} />
                  <Text style={[styles.planBadgeText, { color: theme.colors.accent }]}>{copy.accountStatus}</Text>
                </View>
                {!deleting ? (
                  <>
                    <TouchableOpacity accessibilityRole="button" style={[styles.secondaryButton, { borderColor }]} onPress={() => { onClose(); onOpenHistory(); }}>
                      <Feather name="clock" size={17} color={theme.colors.text} /><Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>{page.history}</Text>
                    </TouchableOpacity>
                    {monetizationEnabled && onManageSubscription ? <TouchableOpacity accessibilityRole="button" style={[styles.secondaryButton, { borderColor }]} onPress={onManageSubscription}><Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>{copy.manageSubscription}</Text></TouchableOpacity> : null}
                    <TouchableOpacity disabled={busy} style={[styles.secondaryButton, { borderColor }]} onPress={() => void signOut()}>
                      <Feather name="log-out" size={17} color={theme.colors.text} />
                      <Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>{copy.signOut}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={busy} style={[styles.dangerLink]} onPress={() => setDeleting(true)}>
                      <Text style={styles.dangerLinkText}>{copy.deleteAccount}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={[styles.deletePanel, { borderColor: "#EF4444", backgroundColor: theme.colors.surfaceAlt }]}>
                    <Text style={[styles.deleteText, { color: theme.colors.muted }]}>{copy.deleteWarning}</Text>
                    {monetizationEnabled ? (
                      <View style={[styles.subscriptionWarning, { backgroundColor: theme.colors.dangerSoft }]}>
                        <Feather name="alert-triangle" size={15} color={theme.colors.danger} />
                        <View style={styles.subscriptionWarningCopy}>
                          <Text style={[styles.deleteText, { color: theme.colors.text }]}>{copy.deleteSubscriptionWarning}</Text>
                          {onManageSubscription ? (
                            <TouchableOpacity onPress={onManageSubscription}>
                              <Text style={[styles.subscriptionLink, { color: theme.colors.primary }]}>{copy.manageSubscription}</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                    <PasswordField language={language} value={password} onChangeText={setPassword} visible={passwordVisible} onToggle={() => setPasswordVisible((current) => !current)} placeholder={copy.password} theme={theme} borderColor={borderColor} />
                    <View style={styles.deleteActions}>
                      <TouchableOpacity style={[styles.smallButton, { borderColor }]} onPress={() => { setDeleting(false); setPassword(""); setError(null); }}>
                        <Text style={[styles.smallButtonText, { color: theme.colors.text }]}>{copy.cancel}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={busy} style={[styles.smallButton, styles.deleteButton]} onPress={() => void removeAccount()}>
                        <Text style={[styles.smallButtonText, { color: "#FFFFFF" }]}>{copy.deleteConfirm}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ) : (
              <>
                <View style={[styles.benefits, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]}>
                  <View style={styles.benefitsTitleRow}>
                    <Feather name="award" size={17} color={theme.colors.primary} />
                    <Text style={[styles.benefitsTitle, { color: theme.colors.text }]}>{copy.benefitsTitle}</Text>
                  </View>
                  {copy.benefits.map((benefit) => (
                    <View key={benefit} style={styles.benefitRow}>
                      <Feather name="check-circle" size={15} color={theme.colors.primary} />
                      <Text style={[styles.benefitText, { color: theme.colors.muted }]}>{benefit}</Text>
                    </View>
                  ))}
                  <Text style={[styles.historyLoginPrompt, { color: theme.colors.text }]}>{copy.historyLoginPrompt}</Text>
                </View>
                <View accessibilityRole="tablist" style={[styles.modeSwitch, { backgroundColor: fieldColor }]}>
                  {(["login", "register"] as AccountMode[]).map((item) => (
                    <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: mode === item, disabled: busy }} disabled={busy} key={item} style={[styles.modeButton, mode === item && { backgroundColor: theme.colors.primarySoft }]} onPress={() => { setMode(item); setError(null); }}>
                      <Text style={[styles.modeText, { color: mode === item ? theme.colors.primary : theme.colors.muted }]}>{item === "login" ? copy.login : copy.register}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {mode === "register" ? (
                  <>
                    <View style={[styles.nameRow, !isLandscape && styles.nameRowPortrait]}>
                      <AccountInput
                        inputRef={firstNameRef}
                        value={firstName}
                        onChangeText={setFirstName}
                        onFocus={() => revealInput(firstNameRef)}
                        onSubmitEditing={() => focusInput(lastNameRef)}
                        returnKeyType="next"
                        blurOnSubmit={false}
                        placeholder={`${copy.firstName} (${profile.optional})`}
                        theme={theme}
                        borderColor={borderColor}
                      />
                      <AccountInput
                        inputRef={lastNameRef}
                        value={lastName}
                        onChangeText={setLastName}
                        onFocus={() => revealInput(lastNameRef)}
                        onSubmitEditing={() => focusInput(emailRef)}
                        returnKeyType="next"
                        blurOnSubmit={false}
                        placeholder={`${copy.lastName} (${profile.optional})`}
                        theme={theme}
                        borderColor={borderColor}
                      />
                    </View>
                  </>
                ) : null}

                <AccountInput
                  inputRef={emailRef}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => revealInput(emailRef)}
                  onSubmitEditing={() => focusInput(passwordRef)}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  placeholder={copy.email}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  theme={theme}
                  borderColor={borderColor}
                />
                <PasswordField
                  language={language}
                  inputRef={passwordRef}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => revealInput(passwordRef)}
                  onSubmitEditing={() => mode === "register" ? focusInput(confirmPasswordRef) : void submit()}
                  returnKeyType={mode === "register" ? "next" : "done"}
                  visible={passwordVisible}
                  onToggle={() => setPasswordVisible((current) => !current)}
                  placeholder={copy.password}
                  theme={theme}
                  borderColor={borderColor}
                />
                {mode === "register" ? (
                  <>
                    <PasswordField
                  language={language}
                      inputRef={confirmPasswordRef}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      onFocus={() => revealInput(confirmPasswordRef)}
                      onSubmitEditing={() => void submit()}
                      returnKeyType="done"
                      visible={passwordVisible}
                      onToggle={() => setPasswordVisible((current) => !current)}
                      placeholder={copy.confirmPassword}
                      theme={theme}
                      borderColor={borderColor}
                    />
                    <Text style={[styles.hint, { color: theme.colors.muted }]}>{authErrorMessage(new AuthApiError("AUTH_INVALID_PASSWORD"), language)}</Text>
                    {minimumAge !== null ? <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={profile.age} accessibilityState={{ checked: ageConfirmed }} onPress={() => { setAgeConfirmed(value => !value); setError(null); }} style={styles.acceptRow}>
                      <View style={[styles.checkbox, { borderColor, backgroundColor: ageConfirmed ? theme.colors.primary : "transparent" }]}>{ageConfirmed ? <Feather name="check" size={15} color="#FFFFFF" /> : null}</View>
                      <Text style={[styles.acceptText, { color: theme.colors.text, flex: 1 }]}>{profile.age}</Text>
                    </TouchableOpacity> : policyError ? <View><Text style={styles.error}>{authErrorMessage(policyError, language)}</Text><TouchableOpacity accessibilityRole="button" onPress={() => setPolicyRetry(value => value + 1)}><Text style={{ color: theme.colors.primary }}>{profile.retry}</Text></TouchableOpacity></View> : <ActivityIndicator color={theme.colors.primary} />}
                    <View style={styles.acceptRow}>
                      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: acceptedTerms }} style={[styles.checkbox, { borderColor: acceptedTerms ? theme.colors.primary : borderColor, backgroundColor: acceptedTerms ? theme.colors.primary : "transparent" }]} onPress={() => setAcceptedTerms((current) => !current)}>
                        {acceptedTerms ? <Feather name="check" size={15} color="#FFFFFF" /> : null}
                      </TouchableOpacity>
                      <View style={styles.acceptTextWrap}>
                        <Text style={[styles.acceptText, { color: theme.colors.muted }]}>{copy.acceptPrefix}</Text>
                        <View style={styles.legalLinks}>
                          <TouchableOpacity onPress={() => { Keyboard.dismiss(); onOpenLegal("terms"); }}><Text style={[styles.legalLink, { color: theme.colors.primary }]}>{copy.terms}</Text></TouchableOpacity>
                          <Text style={[styles.acceptText, { color: theme.colors.muted }]}>{copy.and}</Text>
                          <TouchableOpacity onPress={() => { Keyboard.dismiss(); onOpenLegal("privacy"); }}><Text style={[styles.legalLink, { color: theme.colors.primary }]}>{copy.privacy}</Text></TouchableOpacity>
                          <Text style={[styles.acceptText, { color: theme.colors.muted }]}>{copy.acceptSuffix}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={[styles.notice, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}>
                      <Feather name="lock" size={15} color={theme.colors.accent} />
                      <Text style={[styles.noticeText, { color: theme.colors.muted }]}>{copy.secureNotice}</Text>
                    </View>
                  </>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}
                <TouchableOpacity disabled={busy || (mode === "register" && minimumAge === null)} activeOpacity={0.88} onPress={() => void submit()}>
                  <InstagramGradient theme={theme} style={[styles.submit, busy && styles.disabled]}>
                    {busy ? <ActivityIndicator color="#FFFFFF" /> : <Feather name={mode === "login" ? "log-in" : "user-plus"} size={18} color="#FFFFFF" />}
                    <Text style={styles.submitText}>{mode === "login" ? copy.login : copy.register}</Text>
                  </InstagramGradient>
                </TouchableOpacity>
              </>
            )}
            {error && user ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </View>
    </KeyboardAvoidingView>
  );
}

function AccountInput({ inputRef, theme, borderColor, ...props }: React.ComponentProps<typeof TextInput> & { inputRef?: RefObject<TextInput | null>; theme: Theme; borderColor: string }) {
  return <TextInput ref={inputRef} {...props} autoCorrect={false} placeholderTextColor={theme.colors.muted} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.surfaceAlt, borderColor }]} />;
}

function PasswordField({
  language,
  inputRef,
  value,
  onChangeText,
  onFocus,
  onSubmitEditing,
  returnKeyType,
  visible,
  onToggle,
  placeholder,
  theme,
  borderColor
}: {
  language: Language;
  inputRef?: RefObject<TextInput | null>;
  value: string;
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  onSubmitEditing?: React.ComponentProps<typeof TextInput>["onSubmitEditing"];
  returnKeyType?: React.ComponentProps<typeof TextInput>["returnKeyType"];
  visible: boolean;
  onToggle: () => void;
  placeholder: string;
  theme: Theme;
  borderColor: string;
}) {
  return (
    <View style={[styles.passwordRow, { backgroundColor: theme.colors.surfaceAlt, borderColor }]}>
      <TextInput
        ref={inputRef}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={returnKeyType === "done"}
        onFocus={onFocus}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        secureTextEntry={!visible}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted}
        style={[styles.passwordInput, { color: theme.colors.text }]}
      />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={visible ? accountPageCopy(language).hidePassword : accountPageCopy(language).showPassword} style={styles.passwordToggle} onPress={onToggle}>
        <Feather name={visible ? "eye-off" : "eye"} size={18} color={theme.colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 20 },
  page: { flex: 1, paddingHorizontal: 18, paddingTop: 10 },
  header: { alignItems: "center", flexDirection: "row", gap: 12 },
  headerIcon: { alignItems: "center", borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  headerText: { flex: 1 },
  title: { fontSize: 17, fontWeight: "900", lineHeight: 22 },
  subtitle: { fontSize: 12, fontWeight: "700", lineHeight: 16, marginTop: 2 },
  close: { alignItems: "center", borderRadius: 13, height: 38, justifyContent: "center", width: 38 },
  scroll: { flex: 1, marginTop: 18, minHeight: 0 },
  content: { gap: 14, paddingBottom: 48, width: "100%", maxWidth: 620, alignSelf: "center" },
  contentLandscape: { maxWidth: 760 },
  modeSwitch: { borderRadius: 13, flexDirection: "row", padding: 4 },
  modeButton: { alignItems: "center", borderRadius: 10, flex: 1, justifyContent: "center", minHeight: 38, paddingHorizontal: 8 },
  modeText: { fontSize: 12, fontWeight: "900", textAlign: "center" },
  nameRow: { flexDirection: "row", gap: 10 },
  nameRowPortrait: { flexDirection: "column" },
  input: { borderRadius: 13, borderWidth: 1, flexGrow: 1, flexBasis: 0, fontSize: 14, minHeight: 48, paddingHorizontal: 12 },
  passwordRow: { alignItems: "center", borderRadius: 13, borderWidth: 1, flexDirection: "row", minHeight: 48 },
  passwordInput: { flex: 1, fontSize: 14, minHeight: 46, paddingHorizontal: 12 },
  passwordToggle: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  hint: { fontSize: 11, fontWeight: "700", lineHeight: 16 },
  acceptRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  checkbox: { alignItems: "center", borderRadius: 6, borderWidth: 1.5, height: 24, justifyContent: "center", width: 24 },
  acceptTextWrap: { flex: 1, gap: 2 },
  acceptText: { fontSize: 11, fontWeight: "700", lineHeight: 16 },
  legalLinks: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 4 },
  legalLink: { fontSize: 11, fontWeight: "900", lineHeight: 18, textDecorationLine: "underline" },
  notice: { alignItems: "flex-start", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, padding: 10 },
  noticeText: { flex: 1, fontSize: 11, fontWeight: "700", lineHeight: 16 },
  error: { color: "#EF4444", fontSize: 12, fontWeight: "800", lineHeight: 17 },
  submit: { alignItems: "center", borderRadius: 13, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
  submitText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.68 },
  signedIn: { alignItems: "center", gap: 8, paddingVertical: 6 },
  avatar: { alignItems: "center", borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  avatarText: { fontSize: 22, fontWeight: "900" },
  signedLabel: { fontSize: 11, fontWeight: "800" },
  signedName: { fontSize: 18, fontWeight: "900", width: "100%", textAlign: "center" },
  signedEmail: { fontSize: 13, fontWeight: "700", width: "100%", textAlign: "center" },
  planBadge: { alignItems: "center", borderRadius: 999, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 5 },
  planBadgeText: { fontSize: 11, fontWeight: "900" },
  benefits: { borderRadius: 16, borderWidth: 1, gap: 9, padding: 14 },
  benefitsTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  benefitsTitle: { flex: 1, fontSize: 14, fontWeight: "900" },
  benefitRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  benefitText: { flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  historyLoginPrompt: { fontSize: 11, fontWeight: "800", lineHeight: 16, marginTop: 2 },
  secondaryButton: { alignItems: "center", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 8, minHeight: 46, width: "100%" },
  secondaryButtonText: { fontSize: 13, fontWeight: "900" },
  dangerLink: { padding: 10 },
  dangerLinkText: { color: "#EF4444", fontSize: 12, fontWeight: "900" },
  deletePanel: { borderRadius: 14, borderWidth: 1, gap: 10, padding: 12, width: "100%" },
  deleteText: { fontSize: 12, fontWeight: "700", lineHeight: 17 },
  subscriptionWarning: { alignItems: "flex-start", borderRadius: 8, flexDirection: "row", gap: 8, padding: 10 },
  subscriptionWarningCopy: { flex: 1, gap: 6 },
  subscriptionLink: { fontSize: 12, fontWeight: "900" },
  deleteActions: { flexDirection: "row", gap: 8 },
  smallButton: { alignItems: "center", borderRadius: 11, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 8 },
  smallButtonText: { fontSize: 11, fontWeight: "900", textAlign: "center" },
  deleteButton: { backgroundColor: "#EF4444", borderColor: "#EF4444" }
});
