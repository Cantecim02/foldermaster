import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { ProductSubscription, SubscriptionOffer } from "expo-iap";
import { useEffect, useState } from "react";
import type { Language } from "../i18n";
import { monetizationConfig, type EditioPlan, planForProductId } from "../config/monetization";
import type { BillingNotice, useEditioBilling } from "../hooks/useEditioBilling";
import type { AppTheme } from "../theme";
import { InstagramGradient } from "./ui/InstagramGradient";
import { MotionModal } from "./ui/MotionModal";

type BillingController = ReturnType<typeof useEditioBilling>;

type Props = {
  visible: boolean;
  language: Language;
  theme: AppTheme;
  isLandscape: boolean;
  billing: BillingController;
  onClose: () => void;
};

const en = {
  title: "Editio Pro",
  exhausted: "You’ve used your {limit} free conversions. Upgrade to Editio Pro to continue creating new conversions.",
  active: "Your Editio Pro access is active. Review your plan or manage it with Apple.",
  available: "Choose a monthly or yearly plan when you are ready to continue with Editio Pro.",
  monthly: "Monthly",
  yearly: "Yearly",
  recommended: "Recommended",
  billedMonthly: "Renews monthly",
  billedYearly: "Renews yearly",
  currentPlan: "Current plan",
  purchase: "Continue with {plan}",
  loadingProducts: "Loading App Store options…",
  unavailable: "Price unavailable",
  retry: "Try again",
  restore: "Restore Purchases",
  manage: "Manage Subscription",
  privacy: "Privacy Policy",
  terms: "Terms of Use",
  appleNote: "Payment is charged to your Apple Account. Subscriptions renew automatically unless cancelled through Apple at least 24 hours before the end of the current period.",
  close: "Close"
};

const tr: typeof en = {
  title: "Editio Pro",
  exhausted: "{limit} ücretsiz dönüşüm hakkını tamamladın. Yeni dönüşümlere devam etmek için Editio Pro’ya geç.",
  active: "Editio Pro erişimin aktif. Planını inceleyebilir veya Apple üzerinden yönetebilirsin.",
  available: "Hazır olduğunda Editio Pro için aylık veya yıllık plan seçebilirsin.",
  monthly: "Aylık",
  yearly: "Yıllık",
  recommended: "Önerilen",
  billedMonthly: "Her ay yenilenir",
  billedYearly: "Her yıl yenilenir",
  currentPlan: "Mevcut plan",
  purchase: "{plan} planla devam et",
  loadingProducts: "App Store seçenekleri yükleniyor…",
  unavailable: "Fiyat alınamadı",
  retry: "Tekrar dene",
  restore: "Satın Alımları Geri Yükle",
  manage: "Aboneliği Yönet",
  privacy: "Gizlilik Politikası",
  terms: "Kullanım Koşulları",
  appleNote: "Ödeme Apple Hesabınızdan alınır. Abonelik, mevcut dönemin bitiminden en az 24 saat önce Apple üzerinden iptal edilmezse otomatik yenilenir.",
  close: "Kapat"
};

export function PaywallModal({ visible, language, theme, isLandscape, billing, onClose }: Props) {
  const text = language === "tr" ? tr : en;
  const [selectedPlan, setSelectedPlan] = useState<EditioPlan>("yearly");
  const activePlan = planForProductId(billing.snapshot.productId);

  useEffect(() => {
    if (visible && activePlan) setSelectedPlan(activePlan);
  }, [activePlan, visible]);

  const subtitle = billing.snapshot.active
    ? text.active
    : billing.snapshot.remainingFreeConversions <= 0
      ? text.exhausted.replace("{limit}", String(billing.snapshot.freeLimit))
      : text.available;
  const selectedProduct = billing.products[selectedPlan];
  const purchaseDisabled = billing.busy || billing.restoring || !selectedProduct;

  return (
    <MotionModal
      transparent
      variant="sheet"
      visible={visible}
      supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, isLandscape && styles.overlayLandscape]}>
        <View
          style={[
            styles.panel,
            isLandscape && styles.panelLandscape,
            { backgroundColor: theme.colors.surface, borderColor: theme.isDark ? theme.colors.border : "#C9CAD1" }
          ]}
        >
          <View style={styles.header}>
            <View style={[styles.crown, { backgroundColor: theme.colors.accentSoft }]}>
              <Feather name="star" size={22} color={theme.colors.accent} />
            </View>
            <View style={styles.headerText}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.text }]}>{text.title}</Text>
              <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{subtitle}</Text>
            </View>
            <TouchableOpacity
              accessibilityLabel={text.close}
              style={[styles.close, { backgroundColor: theme.colors.surfaceAlt }]}
              onPress={onClose}
            >
              <Feather name="x" size={19} color={theme.colors.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, isLandscape && styles.contentLandscape]}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.planGrid, isLandscape && styles.planGridLandscape]}>
              <PlanCard
                product={billing.products.monthly}
                selected={selectedPlan === "monthly"}
                active={activePlan === "monthly" && billing.snapshot.active}
                title={text.monthly}
                detail={text.billedMonthly}
                introOffer={billing.introOffers.monthly}
                language={language}
                currentPlanLabel={text.currentPlan}
                unavailableLabel={text.unavailable}
                theme={theme}
                onPress={() => setSelectedPlan("monthly")}
              />
              <PlanCard
                product={billing.products.yearly}
                selected={selectedPlan === "yearly"}
                active={activePlan === "yearly" && billing.snapshot.active}
                title={text.yearly}
                detail={text.billedYearly}
                introOffer={billing.introOffers.yearly}
                language={language}
                badge={text.recommended}
                currentPlanLabel={text.currentPlan}
                unavailableLabel={text.unavailable}
                theme={theme}
                onPress={() => setSelectedPlan("yearly")}
              />
            </View>

            {billing.loadingProducts ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text style={[styles.loadingText, { color: theme.colors.muted }]}>{text.loadingProducts}</Text>
              </View>
            ) : !billing.products.monthly && !billing.products.yearly ? (
              <TouchableOpacity style={styles.retryRow} onPress={() => void billing.reloadProducts()}>
                <Feather name="refresh-cw" size={16} color={theme.colors.primary} />
                <Text style={[styles.linkText, { color: theme.colors.primary }]}>{text.retry}</Text>
              </TouchableOpacity>
            ) : null}

            {billing.notice ? <Notice notice={billing.notice} theme={theme} /> : null}

            {!billing.snapshot.active ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={text.purchase.replace("{plan}", selectedPlan === "yearly" ? text.yearly : text.monthly)}
                disabled={purchaseDisabled}
                activeOpacity={0.88}
                onPress={() => void billing.purchase(selectedPlan)}
              >
                <InstagramGradient theme={theme} style={[styles.purchaseButton, purchaseDisabled && styles.disabled]}>
                  {billing.busy ? <ActivityIndicator color="#FFFFFF" /> : <Feather name="arrow-right" size={19} color="#FFFFFF" />}
                  <Text style={styles.purchaseText}>
                    {text.purchase.replace("{plan}", selectedPlan === "yearly" ? text.yearly : text.monthly)}
                  </Text>
                </InstagramGradient>
              </TouchableOpacity>
            ) : null}

            <View style={[styles.secondaryActions, isLandscape && styles.secondaryActionsLandscape]}>
              <TouchableOpacity
                disabled={billing.restoring || billing.busy}
                style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
                onPress={() => void billing.restore()}
              >
                {billing.restoring ? <ActivityIndicator color={theme.colors.primary} /> : <Feather name="rotate-ccw" size={17} color={theme.colors.text} />}
                <Text style={[styles.secondaryText, { color: theme.colors.text }]}>{text.restore}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
                onPress={() => void billing.manageSubscription()}
              >
                <Feather name="external-link" size={17} color={theme.colors.text} />
                <Text style={[styles.secondaryText, { color: theme.colors.text }]}>{text.manage}</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.appleNote, { color: theme.colors.muted }]}>{text.appleNote}</Text>
            <View style={styles.legalRow}>
              <TouchableOpacity onPress={() => void Linking.openURL(monetizationUrl("privacy"))}>
                <Text style={[styles.legalText, { color: theme.colors.primary }]}>{text.privacy}</Text>
              </TouchableOpacity>
              <Text style={[styles.legalSeparator, { color: theme.colors.muted }]}>•</Text>
              <TouchableOpacity onPress={() => void Linking.openURL(monetizationUrl("terms"))}>
                <Text style={[styles.legalText, { color: theme.colors.primary }]}>{text.terms}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </MotionModal>
  );
}

function PlanCard({ product, selected, active, title, detail, introOffer, language, badge, currentPlanLabel, unavailableLabel, theme, onPress }: {
  product?: ProductSubscription;
  selected: boolean;
  active: boolean;
  title: string;
  detail: string;
  introOffer?: SubscriptionOffer | null;
  language: Language;
  badge?: string;
  currentPlanLabel: string;
  unavailableLabel: string;
  theme: AppTheme;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      activeOpacity={0.86}
      style={[
        styles.planCard,
        {
          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceAlt,
          borderColor: selected ? theme.colors.primary : theme.colors.border
        }
      ]}
      onPress={onPress}
    >
      <View style={styles.planHeading}>
        <View style={[styles.radio, { borderColor: selected ? theme.colors.primary : theme.colors.muted }]}>
          {selected ? <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} /> : null}
        </View>
        <Text style={[styles.planTitle, { color: theme.colors.text }]}>{title}</Text>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: theme.colors.accentSoft }]}>
            <Text style={[styles.badgeText, { color: theme.colors.accent }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.price, { color: product ? theme.colors.text : theme.colors.muted }]}>
        {product?.displayPrice || unavailableLabel}
      </Text>
      <Text style={[styles.planDetail, { color: theme.colors.muted }]}>{formatProductPeriod(product, detail, language)}</Text>
      {introOffer ? (
        <Text style={[styles.introOffer, { color: theme.colors.primary }]}>{formatIntroOffer(introOffer, language)}</Text>
      ) : null}
      {active ? <Text style={[styles.currentPlan, { color: theme.colors.success }]}>{currentPlanLabel}</Text> : null}
    </TouchableOpacity>
  );
}

function formatProductPeriod(product: ProductSubscription | undefined, fallback: string, language: Language) {
  if (product?.platform !== "ios" || !product.subscriptionPeriodUnitIOS) return fallback;
  const count = Number(product.subscriptionPeriodNumberIOS || 1);
  if (!Number.isFinite(count) || count <= 0) return fallback;
  return language === "tr"
    ? `Her ${localizedPeriod(count, product.subscriptionPeriodUnitIOS, language)}`
    : `Renews every ${localizedPeriod(count, product.subscriptionPeriodUnitIOS, language)}`;
}

function formatIntroOffer(offer: SubscriptionOffer, language: Language) {
  const periodCount = Math.max(1, (offer.period?.value ?? 1) * (offer.periodCount ?? 1));
  const unit = offer.period?.unit ?? "unknown";
  const period = localizedPeriod(periodCount, unit, language);
  if (offer.paymentMode === "free-trial" || offer.price === 0) {
    return language === "tr" ? `Uygun ücretsiz deneme: ${period}` : `Eligible free trial: ${period}`;
  }
  return language === "tr"
    ? `Uygun tanıtım teklifi: ${offer.displayPrice} · ${period}`
    : `Eligible introductory offer: ${offer.displayPrice} · ${period}`;
}

function localizedPeriod(count: number, unit: string, language: Language) {
  if (language === "tr") {
    const units: Record<string, string> = { day: "gün", week: "hafta", month: "ay", year: "yıl" };
    return `${count} ${units[unit] ?? "dönem"}`;
  }
  const units: Record<string, [string, string]> = {
    day: ["day", "days"],
    week: ["week", "weeks"],
    month: ["month", "months"],
    year: ["year", "years"]
  };
  const labels = units[unit] ?? ["period", "periods"];
  return `${count} ${count === 1 ? labels[0] : labels[1]}`;
}

function Notice({ notice, theme }: { notice: BillingNotice; theme: AppTheme }) {
  const color = notice.tone === "error" ? theme.colors.danger : notice.tone === "success" ? theme.colors.success : theme.colors.primary;
  const backgroundColor = notice.tone === "error" ? theme.colors.dangerSoft : notice.tone === "success" ? theme.colors.successSoft : theme.colors.primarySoft;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor, borderColor: color }]}>
      <Feather name={notice.tone === "error" ? "alert-circle" : notice.tone === "success" ? "check-circle" : "info"} size={16} color={color} />
      <Text style={[styles.noticeText, { color: theme.colors.text }]}>{notice.text}</Text>
    </View>
  );
}

function monetizationUrl(key: "privacy" | "terms") {
  return monetizationConfig.urls[key];
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.48)" },
  overlayLandscape: { justifyContent: "center", alignItems: "center", padding: 18 },
  panel: { maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingTop: 8 },
  panelLandscape: { width: "92%", maxWidth: 880, maxHeight: "94%", borderRadius: 20 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  crown: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 25, lineHeight: 31, fontWeight: "800", letterSpacing: 0 },
  subtitle: { marginTop: 4, fontSize: 14, lineHeight: 20, fontWeight: "500", letterSpacing: 0 },
  close: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 14 },
  contentLandscape: { paddingBottom: 18 },
  planGrid: { gap: 12 },
  planGridLandscape: { flexDirection: "row" },
  planCard: { flex: 1, minHeight: 126, borderWidth: 1.5, borderRadius: 16, padding: 15 },
  planHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  planTitle: { flexShrink: 1, fontSize: 17, lineHeight: 22, fontWeight: "800", letterSpacing: 0 },
  badge: { marginLeft: "auto", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4 },
  badgeText: { fontSize: 10, lineHeight: 13, fontWeight: "800", letterSpacing: 0 },
  price: { marginTop: 15, fontSize: 22, lineHeight: 27, fontWeight: "800", letterSpacing: 0 },
  planDetail: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: "600", letterSpacing: 0 },
  introOffer: { marginTop: 6, fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 0 },
  currentPlan: { marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 0 },
  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, minHeight: 34 },
  loadingText: { fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0 },
  retryRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 34 },
  linkText: { fontSize: 14, fontWeight: "800", letterSpacing: 0 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderWidth: 1, borderRadius: 12, padding: 12 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0 },
  purchaseButton: { minHeight: 56, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 16 },
  purchaseText: { color: "#FFFFFF", fontSize: 16, lineHeight: 21, fontWeight: "800", letterSpacing: 0, textAlign: "center" },
  disabled: { opacity: 0.48 },
  secondaryActions: { gap: 10 },
  secondaryActionsLandscape: { flexDirection: "row" },
  secondaryButton: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12 },
  secondaryText: { fontSize: 13, lineHeight: 18, fontWeight: "800", letterSpacing: 0, textAlign: "center" },
  appleNote: { fontSize: 11, lineHeight: 16, fontWeight: "500", letterSpacing: 0, textAlign: "center" },
  legalRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 9 },
  legalText: { fontSize: 12, lineHeight: 17, fontWeight: "700", letterSpacing: 0 },
  legalSeparator: { fontSize: 12 }
});
