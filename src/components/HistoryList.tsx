import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Language, translations } from "../i18n";
import { AccountUser, ConversionHistoryItem, listConversionHistory } from "../services/authService";
import { AppTheme } from "../theme";
import { ConversionJob } from "../types";

type Props = {
  history: ConversionJob[];
  trash: ConversionJob[];
  labels: typeof translations.en;
  language: Language;
  theme: AppTheme;
  user: AccountUser | null;
  onOpenAccount: () => void;
  onRetry: (job: ConversionJob) => void;
  onShare: (job: ConversionJob) => void;
  onClear: () => void;
  onDelete: (job: ConversionJob) => void;
};

type HistoryCopy = {
  accountTitle: string;
  accountSubtitle: string;
  accountEmpty: string;
  accountUnavailable: string;
  signInTitle: string;
  signInBody: string;
  signIn: string;
  refresh: string;
  deviceClear: string;
  accountRecord: string;
};

const english: HistoryCopy = {
  accountTitle: "Account history",
  accountSubtitle: "Your conversion records are synchronized with this account.",
  accountEmpty: "Your signed-in conversions will appear here.",
  accountUnavailable: "Account history is temporarily unavailable.",
  signInTitle: "Keep your history",
  signInBody: "Sign in to view conversion records saved to your Editio account.",
  signIn: "Sign in",
  refresh: "Refresh account history",
  deviceClear: "Clear device history",
  accountRecord: "Account record"
};

const copies: Record<Language, HistoryCopy> = {
  en: english,
  tr: {
    accountTitle: "Hesap geçmişi",
    accountSubtitle: "Dönüşüm kayıtlarınız bu hesapla eşitlenir.",
    accountEmpty: "Giriş yaptıktan sonraki dönüşümleriniz burada görünecek.",
    accountUnavailable: "Hesap geçmişine şu anda ulaşılamıyor.",
    signInTitle: "Geçmişinizi koruyun",
    signInBody: "Editio hesabınıza kaydedilen dönüşümleri görmek için giriş yapın.",
    signIn: "Oturum aç",
    refresh: "Hesap geçmişini yenile",
    deviceClear: "Cihaz geçmişini temizle",
    accountRecord: "Hesap kaydı"
  },
  zh: {
    accountTitle: "帐户历史记录",
    accountSubtitle: "转换记录会与此帐户同步。",
    accountEmpty: "登录后的转换将显示在这里。",
    accountUnavailable: "帐户历史记录暂时不可用。",
    signInTitle: "保留您的历史记录",
    signInBody: "登录以查看保存到 Editio 帐户的转换记录。",
    signIn: "登录",
    refresh: "刷新帐户历史记录",
    deviceClear: "清除设备历史记录",
    accountRecord: "帐户记录"
  },
  fr: {
    accountTitle: "Historique du compte",
    accountSubtitle: "Vos conversions sont synchronisées avec ce compte.",
    accountEmpty: "Vos conversions après connexion apparaîtront ici.",
    accountUnavailable: "L'historique du compte est temporairement indisponible.",
    signInTitle: "Conservez votre historique",
    signInBody: "Connectez-vous pour voir les conversions enregistrées dans votre compte Editio.",
    signIn: "Connexion",
    refresh: "Actualiser l'historique du compte",
    deviceClear: "Effacer l'historique de l'appareil",
    accountRecord: "Enregistrement du compte"
  },
  ru: {
    accountTitle: "История аккаунта",
    accountSubtitle: "Записи конвертаций синхронизируются с этим аккаунтом.",
    accountEmpty: "Конвертации после входа появятся здесь.",
    accountUnavailable: "История аккаунта временно недоступна.",
    signInTitle: "Сохраните историю",
    signInBody: "Войдите, чтобы видеть конвертации, сохраненные в аккаунте Editio.",
    signIn: "Войти",
    refresh: "Обновить историю аккаунта",
    deviceClear: "Очистить историю устройства",
    accountRecord: "Запись аккаунта"
  },
  de: {
    accountTitle: "Kontoverlauf",
    accountSubtitle: "Ihre Konvertierungen werden mit diesem Konto synchronisiert.",
    accountEmpty: "Konvertierungen nach der Anmeldung erscheinen hier.",
    accountUnavailable: "Der Kontoverlauf ist vorübergehend nicht verfügbar.",
    signInTitle: "Verlauf behalten",
    signInBody: "Melden Sie sich an, um im Editio-Konto gespeicherte Konvertierungen zu sehen.",
    signIn: "Anmelden",
    refresh: "Kontoverlauf aktualisieren",
    deviceClear: "Geräteverlauf löschen",
    accountRecord: "Kontoeintrag"
  },
  es: {
    accountTitle: "Historial de la cuenta",
    accountSubtitle: "Tus conversiones se sincronizan con esta cuenta.",
    accountEmpty: "Las conversiones realizadas tras iniciar sesión aparecerán aquí.",
    accountUnavailable: "El historial de la cuenta no está disponible temporalmente.",
    signInTitle: "Conserva tu historial",
    signInBody: "Inicia sesión para ver las conversiones guardadas en tu cuenta de Editio.",
    signIn: "Iniciar sesión",
    refresh: "Actualizar el historial de la cuenta",
    deviceClear: "Borrar historial del dispositivo",
    accountRecord: "Registro de la cuenta"
  }
};

type UnifiedHistoryItem =
  | { kind: "local"; createdAt: string; job: ConversionJob }
  | { kind: "account"; createdAt: string; item: ConversionHistoryItem };

export function HistoryList({ history, trash, labels, language, theme, user, onOpenAccount, onRetry, onShare, onClear, onDelete }: Props) {
  const copy = copies[language] ?? english;
  const [accountHistory, setAccountHistory] = useState<ConversionHistoryItem[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState(false);
  const requestId = useRef(0);

  const refreshAccountHistory = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!user) {
      setAccountHistory([]);
      setAccountError(false);
      setAccountLoading(false);
      return;
    }

    setAccountLoading(true);
    setAccountError(false);
    try {
      const items = await listConversionHistory(100);
      if (requestId.current === currentRequest) setAccountHistory(items);
    } catch {
      if (requestId.current === currentRequest) setAccountError(true);
    } finally {
      if (requestId.current === currentRequest) setAccountLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refreshAccountHistory();
    return () => {
      requestId.current += 1;
    };
  }, [refreshAccountHistory]);

  const unifiedHistory = useMemo<UnifiedHistoryItem[]>(() => {
    const localItems: UnifiedHistoryItem[] = history.map((job) => ({ kind: "local", createdAt: job.createdAt, job }));
    const accountOnlyItems: UnifiedHistoryItem[] = accountHistory
      .filter((item) => !history.some((job) => isSameConversion(job, item)) && !trash.some((job) => isSameConversion(job, item)))
      .map((item) => ({ kind: "account", createdAt: item.createdAt, item }));

    return [...localItems, ...accountOnlyItems].sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt));
  }, [accountHistory, history, trash]);

  return (
    <View style={styles.container}>
      {user ? (
        <View style={[styles.accountSummary, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={[styles.accountIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Feather name="cloud" size={18} color={theme.colors.primary} />
          </View>
          <View style={styles.accountText}>
            <Text style={[styles.accountTitle, { color: theme.colors.text }]}>{copy.accountTitle}</Text>
            <Text numberOfLines={2} style={[styles.accountSubtitle, { color: theme.colors.muted }]}>{copy.accountSubtitle}</Text>
          </View>
          <TouchableOpacity accessibilityLabel={copy.refresh} disabled={accountLoading} style={[styles.refreshButton, { backgroundColor: theme.colors.surfaceAlt }]} onPress={() => void refreshAccountHistory()}>
            {accountLoading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Feather name="refresh-cw" size={17} color={theme.colors.primary} />}
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity activeOpacity={0.86} style={[styles.signInCard, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]} onPress={onOpenAccount}>
          <View style={[styles.accountIcon, { backgroundColor: theme.colors.surface }]}>
            <Feather name="user" size={18} color={theme.colors.primary} />
          </View>
          <View style={styles.accountText}>
            <Text style={[styles.accountTitle, { color: theme.colors.text }]}>{copy.signInTitle}</Text>
            <Text style={[styles.accountSubtitle, { color: theme.colors.muted }]}>{copy.signInBody}</Text>
          </View>
          <View style={[styles.signInButton, { backgroundColor: theme.colors.primary }]}>
            <Text style={styles.signInText}>{copy.signIn}</Text>
          </View>
        </TouchableOpacity>
      )}

      {accountError ? (
        <TouchableOpacity style={[styles.stateNotice, { backgroundColor: theme.colors.dangerSoft }]} onPress={() => void refreshAccountHistory()}>
          <Feather name="alert-circle" size={16} color={theme.colors.danger} />
          <Text style={[styles.stateText, { color: theme.colors.danger }]}>{copy.accountUnavailable}</Text>
        </TouchableOpacity>
      ) : null}

      {history.length > 0 ? (
        <TouchableOpacity
          style={[styles.clearButton, { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft }]}
          onPress={onClear}
        >
          <Feather name="trash-2" size={18} color={theme.colors.danger} />
          <Text style={[styles.clearText, { color: theme.colors.danger }]}>{user ? copy.deviceClear : labels.clearHistory}</Text>
        </TouchableOpacity>
      ) : null}

      {!accountLoading && unifiedHistory.length === 0 ? (
        <Text style={[styles.empty, { color: theme.colors.muted }]}>{user ? copy.accountEmpty : labels.noHistory}</Text>
      ) : null}

      {unifiedHistory.map((entry) => entry.kind === "local" ? (
        <LocalHistoryRow
          key={`local-${entry.job.id}`}
          job={entry.job}
          labels={labels}
          language={language}
          theme={theme}
          canUseFileActions={Boolean(user)}
          onRetry={onRetry}
          onShare={onShare}
          onDelete={onDelete}
        />
      ) : (
        <AccountHistoryRow key={`account-${entry.item.id}`} item={entry.item} copy={copy} labels={labels} language={language} theme={theme} />
      ))}
    </View>
  );
}

function LocalHistoryRow({ job, labels, language, theme, canUseFileActions, onRetry, onShare, onDelete }: {
  job: ConversionJob;
  labels: typeof translations.en;
  language: Language;
  theme: AppTheme;
  canUseFileActions: boolean;
  onRetry: (job: ConversionJob) => void;
  onShare: (job: ConversionJob) => void;
  onDelete: (job: ConversionJob) => void;
}) {
  return (
    <View style={[styles.item, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.itemHeader}>
        <View style={styles.titleCluster}>
          <View style={[styles.fileIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Feather name="file-text" size={16} color={theme.colors.primary} />
          </View>
          <View style={styles.itemText}>
            <Text numberOfLines={1} style={[styles.itemTitle, { color: theme.colors.text }]}>{localFileName(job)}</Text>
            <Text style={[styles.meta, { color: theme.colors.muted }]}>{job.inputType.toUpperCase()} → {job.outputType.toUpperCase()} · {formatDate(job.createdAt, language)}</Text>
          </View>
        </View>
        <StatusBadge status={job.status === "success" ? "completed" : "failed"} labels={labels} theme={theme} />
      </View>
      <Text style={[styles.meta, { color: theme.colors.muted }]}>{job.files.length} {labels.fileCountSuffix}</Text>
      {job.error ? <Text style={[styles.error, { color: theme.colors.danger }]}>{job.error}</Text> : null}
      <View style={styles.actions}>
        {job.status === "success" && canUseFileActions ? (
          <TouchableOpacity style={[styles.actionButton, { borderColor: theme.colors.primary }]} onPress={() => onRetry(job)}>
            <Feather name="refresh-cw" size={16} color={theme.colors.primary} />
            <Text style={[styles.actionText, { color: theme.colors.primary }]}>{labels.retry}</Text>
          </TouchableOpacity>
        ) : null}
        {job.status === "success" && canUseFileActions ? (
          <TouchableOpacity style={[styles.actionButton, { borderColor: theme.colors.primary }]} onPress={() => onShare(job)}>
            <Feather name="share-2" size={16} color={theme.colors.primary} />
            <Text style={[styles.actionText, { color: theme.colors.primary }]}>{labels.share}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.iconOnlyButton, { backgroundColor: theme.colors.dangerSoft }]} onPress={() => onDelete(job)}>
          <Feather name="trash-2" size={16} color={theme.colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AccountHistoryRow({ item, copy, labels, language, theme }: {
  item: ConversionHistoryItem;
  copy: HistoryCopy;
  labels: typeof translations.en;
  language: Language;
  theme: AppTheme;
}) {
  return (
    <View style={[styles.item, styles.accountItem, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.itemHeader}>
        <View style={styles.titleCluster}>
          <View style={[styles.fileIcon, { backgroundColor: theme.colors.accentSoft }]}>
            <Feather name="cloud" size={16} color={theme.colors.accent} />
          </View>
          <View style={styles.itemText}>
            <Text numberOfLines={1} style={[styles.itemTitle, { color: theme.colors.text }]}>{item.fileName}</Text>
            <Text style={[styles.meta, { color: theme.colors.muted }]}>{item.from} → {item.to} · {formatDate(item.createdAt, language)}</Text>
          </View>
        </View>
        <StatusBadge status={item.status} labels={labels} theme={theme} />
      </View>
      <View style={styles.accountRecordLabel}>
        <Feather name="lock" size={12} color={theme.colors.muted} />
        <Text style={[styles.accountRecordText, { color: theme.colors.muted }]}>{copy.accountRecord}</Text>
      </View>
    </View>
  );
}

function StatusBadge({ status, labels, theme }: { status: "completed" | "failed"; labels: typeof translations.en; theme: AppTheme }) {
  const successful = status === "completed";
  return (
    <Text style={[styles.status, { color: successful ? theme.colors.success : theme.colors.danger, backgroundColor: successful ? theme.colors.successSoft : theme.colors.dangerSoft }]}>
      {successful ? labels.statusSuccess : labels.statusFailed}
    </Text>
  );
}

function isSameConversion(job: ConversionJob, item: ConversionHistoryItem) {
  const sameStatus = (job.status === "success" ? "completed" : "failed") === item.status;
  const sameFormats = job.inputType.toUpperCase() === item.from && job.outputType.toUpperCase() === item.to;
  const sameName = accountFileName(job) === item.fileName;
  const timeDifference = Math.abs(dateValue(job.createdAt) - dateValue(item.createdAt));
  return sameStatus && sameFormats && sameName && timeDifference <= 120_000;
}

function localFileName(job: ConversionJob) {
  return job.files[0]?.name?.trim() || `${job.inputType.toUpperCase()} → ${job.outputType.toUpperCase()}`;
}

function accountFileName(job: ConversionJob) {
  const firstName = localFileName(job);
  return job.files.length > 1 ? `${firstName} +${job.files.length - 1}`.slice(0, 255) : firstName.slice(0, 255);
}

function dateValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatDate(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locales: Record<Language, string> = { en: "en-US", tr: "tr-TR", zh: "zh-CN", fr: "fr-FR", ru: "ru-RU", de: "de-DE", es: "es-ES" };
  return new Intl.DateTimeFormat(locales[language] ?? "en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  accountSummary: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, padding: 12 },
  signInCard: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 11, padding: 12 },
  accountIcon: { alignItems: "center", borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  accountText: { flex: 1, minWidth: 0 },
  accountTitle: { fontSize: 14, fontWeight: "900" },
  accountSubtitle: { fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 2 },
  refreshButton: { alignItems: "center", borderRadius: 12, height: 38, justifyContent: "center", width: 38 },
  signInButton: { alignItems: "center", borderRadius: 11, justifyContent: "center", minHeight: 38, paddingHorizontal: 12 },
  signInText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  stateNotice: { alignItems: "center", borderRadius: 13, flexDirection: "row", gap: 8, padding: 11 },
  stateText: { flex: 1, fontSize: 12, fontWeight: "800", lineHeight: 17 },
  clearButton: { alignItems: "center", alignSelf: "flex-start", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: 42, paddingHorizontal: 12 },
  clearText: { fontSize: 13, fontWeight: "800" },
  empty: { fontSize: 14, fontWeight: "700", lineHeight: 20, paddingVertical: 8 },
  item: { borderRadius: 18, borderWidth: 1, gap: 8, padding: 14, shadowColor: "#DD2A7B", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 18 },
  accountItem: { minHeight: 84 },
  itemHeader: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  titleCluster: { alignItems: "center", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 },
  fileIcon: { alignItems: "center", borderRadius: 12, height: 36, justifyContent: "center", width: 36 },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 14, fontWeight: "900" },
  status: { borderRadius: 999, fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, textTransform: "uppercase" },
  meta: { fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 2 },
  error: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 8 },
  actionButton: { alignItems: "center", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 6, minHeight: 38, paddingHorizontal: 10 },
  actionText: { fontSize: 12, fontWeight: "800" },
  iconOnlyButton: { alignItems: "center", borderRadius: 12, height: 38, justifyContent: "center", width: 38 },
  accountRecordLabel: { alignItems: "center", flexDirection: "row", gap: 5, marginLeft: 46 },
  accountRecordText: { fontSize: 10, fontWeight: "800" }
});
