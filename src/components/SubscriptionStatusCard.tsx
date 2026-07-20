import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { Language } from "../i18n";
import { planForProductId } from "../config/monetization";
import type { BillingSnapshot } from "../services/billingApi";
import type { AppTheme } from "../theme";

type Props = {
  enabled: boolean;
  compact?: boolean;
  language: Language;
  snapshot: BillingSnapshot;
  theme: AppTheme;
  busy?: boolean;
  onOpen: () => void;
  onRestore?: () => void;
  onManage?: () => void;
};

const en = {
  title: "Editio Pro",
  active: "Pro is active",
  activeBody: "Supported new conversions are available with your current Apple subscription.",
  monthly: "Monthly plan",
  yearly: "Yearly plan",
  expires: "Access through {date}",
  ended: "Subscription ended",
  endedBody: "Restore an eligible purchase or choose a plan to continue with new conversions.",
  billingRetry: "Payment issue",
  billingRetryBody: "Apple is retrying the payment. Review your subscription settings to avoid an interruption.",
  remaining: "{remaining} of {limit} free conversions remaining",
  remainingBody: "A completed conversion uses one lifetime free credit. Failed jobs do not count.",
  exhausted: "Free conversions used",
  exhaustedBody: "Choose Editio Pro to continue creating new conversions.",
  view: "View Pro",
  manage: "Manage",
  restore: "Restore"
};

const tr: typeof en = {
  title: "Editio Pro",
  active: "Pro etkin",
  activeBody: "Mevcut Apple aboneliğinle desteklenen yeni dönüşümlere devam edebilirsin.",
  monthly: "Aylık plan",
  yearly: "Yıllık plan",
  expires: "{date} tarihine kadar erişim",
  ended: "Abonelik sona erdi",
  endedBody: "Uygun satın alımı geri yükle veya yeni dönüşümlere devam etmek için bir plan seç.",
  billingRetry: "Ödeme sorunu",
  billingRetryBody: "Apple ödemeyi yeniden deniyor. Kesinti yaşamamak için abonelik ayarlarını kontrol et.",
  remaining: "{limit} ücretsiz dönüşümden {remaining} kaldı",
  remainingBody: "Yalnızca tamamlanan işlem bir hak kullanır. Başarısız işlemler sayılmaz.",
  exhausted: "Ücretsiz dönüşümler tamamlandı",
  exhaustedBody: "Yeni dönüşümler oluşturmak için Editio Pro planını incele.",
  view: "Pro'yu incele",
  manage: "Yönet",
  restore: "Geri yükle"
};

export function SubscriptionStatusCard({
  enabled,
  compact = false,
  language,
  snapshot,
  theme,
  busy = false,
  onOpen,
  onRestore,
  onManage
}: Props) {
  if (!enabled) return null;

  const copy = language === "tr" ? tr : en;
  const isActive = snapshot.active;
  const normalizedStatus = snapshot.status.toLowerCase();
  const isBillingRetry = !isActive && normalizedStatus === "billing_retry";
  const hasEnded = !isActive && ["expired", "revoked", "refunded"].includes(normalizedStatus);
  const exhausted = !isActive && snapshot.remainingFreeConversions <= 0;
  const activePlan = planForProductId(snapshot.productId);
  const planLabel = activePlan === "monthly" ? copy.monthly : activePlan === "yearly" ? copy.yearly : null;
  const formattedExpiry = formatExpiry(snapshot.expiresAt, language);
  const title = isActive
    ? [copy.active, planLabel].filter(Boolean).join(" · ")
    : isBillingRetry
      ? copy.billingRetry
      : hasEnded
        ? copy.ended
        : exhausted
      ? copy.exhausted
      : copy.remaining
          .replace("{remaining}", String(snapshot.remainingFreeConversions))
          .replace("{limit}", String(snapshot.freeLimit));
  const body = isActive
    ? formattedExpiry
      ? `${copy.activeBody} ${copy.expires.replace("{date}", formattedExpiry)}`
      : copy.activeBody
    : isBillingRetry
      ? copy.billingRetryBody
      : hasEnded
        ? copy.endedBody
        : exhausted
          ? copy.exhaustedBody
          : copy.remainingBody;
  const accent = isActive ? theme.colors.success : exhausted ? theme.colors.accent : theme.colors.primary;

  return (
    <View
      style={[
        styles.card,
        compact && styles.compactCard,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: isActive ? theme.colors.success : theme.colors.border
        }
      ]}
    >
      <View style={[styles.icon, compact && styles.compactIcon, { backgroundColor: isActive ? theme.colors.successSoft : theme.colors.accentSoft }]}>
        <Feather name={isActive ? "check" : "star"} size={compact ? 17 : 20} color={accent} />
      </View>
      <View style={styles.copy}>
        {!compact ? <Text style={[styles.eyebrow, { color: accent }]}>{copy.title}</Text> : null}
        <Text style={[styles.title, compact && styles.compactTitle, { color: theme.colors.text }]}>{title}</Text>
        {!compact ? <Text style={[styles.body, { color: theme.colors.muted }]}>{body}</Text> : null}
      </View>
      <View style={[styles.actions, compact && styles.compactActions]}>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          style={[styles.primaryAction, { backgroundColor: accent }, busy && styles.disabled]}
          onPress={isActive && onManage ? onManage : onOpen}
        >
          {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text style={styles.primaryActionText}>{isActive ? copy.manage : copy.view}</Text>
        </TouchableOpacity>
        {!compact && !isActive && onRestore ? (
          <TouchableOpacity accessibilityRole="button" disabled={busy} style={styles.linkAction} onPress={onRestore}>
            <Text style={[styles.linkText, { color: theme.colors.primary }]}>{copy.restore}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function formatExpiry(value: string | null, language: Language) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginTop: 14,
    padding: 14,
    width: "100%"
  },
  compactCard: { marginTop: 10, padding: 10 },
  icon: { alignItems: "center", borderRadius: 8, height: 42, justifyContent: "center", width: 42 },
  compactIcon: { height: 34, width: 34 },
  copy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 11, fontWeight: "800", marginBottom: 2 },
  title: { fontSize: 15, fontWeight: "900", lineHeight: 19 },
  compactTitle: { fontSize: 13, lineHeight: 17 },
  body: { fontSize: 12, fontWeight: "600", lineHeight: 17, marginTop: 3 },
  actions: { alignItems: "center", gap: 5 },
  compactActions: { minWidth: 92 },
  primaryAction: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 12
  },
  primaryActionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  linkAction: { paddingHorizontal: 8, paddingVertical: 4 },
  linkText: { fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.55 }
});
