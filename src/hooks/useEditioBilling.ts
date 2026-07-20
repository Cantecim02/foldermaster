import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deepLinkToSubscriptions,
  finishTransaction,
  getAvailablePurchases,
  isEligibleForIntroOfferIOS,
  type ProductSubscription,
  type Purchase,
  type SubscriptionOffer,
  useIAP
} from "expo-iap";
import * as Crypto from "expo-crypto";
import type { Language } from "../i18n";
import { monetizationConfig, type EditioPlan } from "../config/monetization";
import type { AccountUser } from "../services/authService";
import {
  authorizeConversion,
  BillingApiError,
  completeConversionAuthorization,
  getBillingSnapshot,
  releaseConversionAuthorization,
  type BillingRequestContext,
  type BillingSnapshot,
  verifyAppleTransaction
} from "../services/billingApi";
import { getBillingIdentity } from "../services/billingIdentity";

export type BillingNotice = {
  tone: "error" | "info" | "success";
  text: string;
};

const disabledSnapshot: BillingSnapshot = {
  monetizationEnabled: false,
  active: false,
  status: "disabled",
  productId: null,
  expiresAt: null,
  autoRenewStatus: null,
  freeLimit: 3,
  usedFreeConversions: 0,
  reservedFreeConversions: 0,
  remainingFreeConversions: 3,
  canConvert: true,
  appAccountToken: ""
};

const copy = {
  tr: {
    storeUnavailable: "App Store'a şu anda ulaşılamıyor. Lütfen yeniden deneyin.",
    productUnavailable: "Abonelik seçenekleri yüklenemedi. Lütfen yeniden deneyin.",
    cancelled: "Satın alma iptal edildi.",
    pending: "Satın alma işleminiz Apple tarafından işleniyor.",
    verified: "Editio Pro etkinleştirildi.",
    verificationFailed: "Satın alma Apple ile doğrulanamadı. Satın alımları geri yüklemeyi deneyin.",
    restored: "Satın alımınız geri yüklendi.",
    nothingToRestore: "Geri yüklenecek aktif bir Editio Pro aboneliği bulunamadı.",
    restoreFailed: "Satın alımlar geri yüklenemedi. Lütfen yeniden deneyin.",
    manageFailed: "Apple abonelik ayarları açılamadı.",
    internetRequired: "Ücretsiz kullanım hakkınızı doğrulamak için internet bağlantısı gerekiyor."
  },
  en: {
    storeUnavailable: "The App Store is currently unavailable. Please try again.",
    productUnavailable: "Subscription options could not be loaded. Please try again.",
    cancelled: "Purchase cancelled.",
    pending: "Your purchase is being processed by Apple.",
    verified: "Editio Pro is now active.",
    verificationFailed: "Apple could not verify this purchase. Try restoring your purchases.",
    restored: "Your purchase has been restored.",
    nothingToRestore: "No active Editio Pro subscription was found to restore.",
    restoreFailed: "Purchases could not be restored. Please try again.",
    manageFailed: "Apple subscription settings could not be opened.",
    internetRequired: "An internet connection is required to verify your free usage allowance."
  }
};

export function useEditioBilling(user: AccountUser | null, language: Language) {
  const localized = language === "tr" ? copy.tr : copy.en;
  const userRef = useRef(user);
  const processedTransactions = useRef(new Set<string>());
  const serverMonetizationEnabledRef = useRef<boolean | null>(
    monetizationConfig.enabled ? null : false
  );
  const [snapshot, setSnapshot] = useState<BillingSnapshot>(disabledSnapshot);
  const [serverMonetizationEnabled, setServerMonetizationEnabled] = useState<boolean | null>(
    monetizationConfig.enabled ? null : false
  );
  const [notice, setNotice] = useState<BillingNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [introOffers, setIntroOffers] = useState<Record<EditioPlan, SubscriptionOffer | null>>({
    monthly: null,
    yearly: null
  });

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const updateSnapshot = useCallback((next: BillingSnapshot) => {
    serverMonetizationEnabledRef.current = next.monetizationEnabled;
    setServerMonetizationEnabled(next.monetizationEnabled);
    setSnapshot(next);
    return next;
  }, []);

  const enabled = monetizationConfig.enabled && serverMonetizationEnabled === true;

  const handlePurchase = useCallback(async (purchase: Purchase) => {
    if (!monetizationConfig.enabled) return;
    if (purchase.purchaseState === "pending") {
      setNotice({ tone: "info", text: localized.pending });
      setBusy(false);
      return;
    }
    if (purchase.purchaseState !== "purchased" || !purchase.purchaseToken) {
      setNotice({ tone: "error", text: localized.verificationFailed });
      setBusy(false);
      return;
    }
    const transactionKey = purchase.transactionId || purchase.id;
    if (processedTransactions.current.has(transactionKey)) return;
    processedTransactions.current.add(transactionKey);

    try {
      const entitlement = await verifyAppleTransaction(userRef.current, {
        signedTransactionInfo: purchase.purchaseToken,
        environment: "environmentIOS" in purchase ? purchase.environmentIOS : undefined
      });
      updateSnapshot(entitlement);
      if (!entitlement.monetizationEnabled) {
        throw new Error("MONETIZATION_NOT_LIVE");
      }
      if (!entitlement.active) throw new Error("ENTITLEMENT_NOT_ACTIVE");
      await finishTransaction({ purchase, isConsumable: false });
      setNotice({ tone: "success", text: localized.verified });
    } catch {
      processedTransactions.current.delete(transactionKey);
      setNotice({ tone: "error", text: localized.verificationFailed });
    } finally {
      setBusy(false);
    }
  }, [localized.pending, localized.verificationFailed, localized.verified, updateSnapshot]);

  const {
    connected,
    subscriptions,
    fetchProducts,
    requestPurchase,
    restorePurchases
  } = useIAP({
    onPurchaseSuccess: (purchase) => {
      void handlePurchase(purchase);
    },
    onPurchaseError: (error) => {
      setBusy(false);
      setNotice({
        tone: error.code === "user-cancelled" ? "info" : "error",
        text: error.code === "user-cancelled" ? localized.cancelled : localized.storeUnavailable
      });
    },
    onError: () => {
      if (monetizationConfig.enabled) {
        setNotice({ tone: "error", text: localized.storeUnavailable });
      }
    }
  });

  const refreshEntitlement = useCallback(async (showError = false) => {
    if (!monetizationConfig.enabled) {
      return updateSnapshot(disabledSnapshot);
    }
    try {
      const next = await getBillingSnapshot(userRef.current);
      return updateSnapshot(next);
    } catch (error) {
      if (showError) {
        setNotice({
          tone: "error",
          text: error instanceof BillingApiError && error.code === "NETWORK_ERROR"
            ? localized.internetRequired
            : localized.storeUnavailable
        });
      }
      throw error;
    }
  }, [localized.internetRequired, localized.storeUnavailable, updateSnapshot]);

  const loadProducts = useCallback(async () => {
    if (!enabled || !connected) return;
    setLoadingProducts(true);
    try {
      await fetchProducts({ skus: [...monetizationConfig.products.all], type: "subs" });
    } catch {
      setNotice({ tone: "error", text: localized.productUnavailable });
    } finally {
      setLoadingProducts(false);
    }
  }, [connected, enabled, fetchProducts, localized.productUnavailable]);

  useEffect(() => {
    if (!monetizationConfig.enabled) return;
    void refreshEntitlement(false).catch(() => undefined);
  }, [user, refreshEntitlement]);

  useEffect(() => {
    if (!enabled || !connected) return;
    void loadProducts();
  }, [connected, enabled, loadProducts]);

  const productByPlan = useMemo<Record<EditioPlan, ProductSubscription | undefined>>(() => ({
    monthly: subscriptions.find((item) => item.id === monetizationConfig.products.monthly),
    yearly: subscriptions.find((item) => item.id === monetizationConfig.products.yearly)
  }), [subscriptions]);

  useEffect(() => {
    if (!enabled || !connected) {
      setIntroOffers({ monthly: null, yearly: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<EditioPlan, SubscriptionOffer | null> = { monthly: null, yearly: null };
      for (const plan of ["monthly", "yearly"] as const) {
        const product = productByPlan[plan];
        if (product?.platform !== "ios" || !product.subscriptionGroupIdIOS) continue;
        try {
          const eligible = await isEligibleForIntroOfferIOS(product.subscriptionGroupIdIOS);
          if (eligible) {
            next[plan] = product.subscriptionOffers?.find((offer) => offer.type === "introductory") ?? null;
          }
        } catch {
          // Offer eligibility is optional. A failed query must never create a trial claim.
          next[plan] = null;
        }
      }
      if (!cancelled) setIntroOffers(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, enabled, productByPlan]);

  const purchase = useCallback(async (plan: EditioPlan) => {
    if (!enabled) return;
    const product = productByPlan[plan];
    if (!connected) {
      setNotice({ tone: "error", text: localized.storeUnavailable });
      return;
    }
    if (!product) {
      setNotice({ tone: "error", text: localized.productUnavailable });
      await loadProducts();
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const identity = await getBillingIdentity(userRef.current);
      await requestPurchase({
        request: { apple: { sku: product.id, appAccountToken: identity.appAccountToken } },
        type: "subs"
      });
    } catch (error) {
      setBusy(false);
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      setNotice({
        tone: code === "user-cancelled" ? "info" : "error",
        text: code === "user-cancelled" ? localized.cancelled : localized.storeUnavailable
      });
    }
  }, [connected, enabled, loadProducts, localized.cancelled, localized.productUnavailable, localized.storeUnavailable, productByPlan, requestPurchase]);

  const restore = useCallback(async () => {
    if (!enabled || restoring) return;
    setRestoring(true);
    setNotice(null);
    try {
      await restorePurchases({ onlyIncludeActiveItemsIOS: true });
      const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
      const eligible = purchases.filter((purchase) =>
        monetizationConfig.products.all.includes(purchase.productId) &&
        purchase.purchaseState === "purchased" &&
        Boolean(purchase.purchaseToken)
      );
      if (eligible.length === 0) {
        setNotice({ tone: "info", text: localized.nothingToRestore });
        return;
      }
      let restoredSnapshot: BillingSnapshot | null = null;
      for (const restoredPurchase of eligible) {
        restoredSnapshot = await verifyAppleTransaction(userRef.current, {
          signedTransactionInfo: restoredPurchase.purchaseToken!,
          environment: "environmentIOS" in restoredPurchase ? restoredPurchase.environmentIOS : undefined,
          restore: true
        });
      }
      if (restoredSnapshot?.active) {
        updateSnapshot(restoredSnapshot);
        setNotice({ tone: "success", text: localized.restored });
      } else {
        setNotice({ tone: "info", text: localized.nothingToRestore });
      }
    } catch {
      setNotice({ tone: "error", text: localized.restoreFailed });
    } finally {
      setRestoring(false);
    }
  }, [enabled, localized.nothingToRestore, localized.restoreFailed, localized.restored, restorePurchases, restoring, updateSnapshot]);

  const manageSubscription = useCallback(async () => {
    try {
      await deepLinkToSubscriptions(undefined);
    } catch {
      setNotice({ tone: "error", text: localized.manageFailed });
    }
  }, [localized.manageFailed]);

  const beginConversion = useCallback(async (conversionType: string) => {
    if (!monetizationConfig.enabled) {
      return {
        operationId: Crypto.randomUUID(),
        context: null as BillingRequestContext | null
      };
    }
    let backendEnabled = serverMonetizationEnabledRef.current;
    if (backendEnabled === null) {
      backendEnabled = (await refreshEntitlement(true)).monetizationEnabled;
    }
    if (!backendEnabled) {
      return {
        operationId: Crypto.randomUUID(),
        context: null as BillingRequestContext | null
      };
    }
    const operationId = Crypto.randomUUID();
    const result = await authorizeConversion(userRef.current, { operationId, conversionType });
    updateSnapshot(result.authorization.entitlement);
    return { operationId, context: result.context as BillingRequestContext | null };
  }, [refreshEntitlement, updateSnapshot]);

  const completeConversion = useCallback(async (context: BillingRequestContext | null) => {
    if (!context?.authorizationId) return;
    const next = await completeConversionAuthorization(userRef.current, context.authorizationId);
    updateSnapshot(next);
  }, [updateSnapshot]);

  const releaseConversion = useCallback(async (context: BillingRequestContext | null) => {
    if (!context?.authorizationId) return;
    const next = await releaseConversionAuthorization(userRef.current, context.authorizationId);
    updateSnapshot(next);
  }, [updateSnapshot]);

  return {
    enabled,
    connected,
    snapshot,
    products: productByPlan,
    introOffers,
    notice,
    busy,
    restoring,
    loadingProducts,
    clearNotice: () => setNotice(null),
    refreshEntitlement,
    reloadProducts: loadProducts,
    purchase,
    restore,
    manageSubscription,
    beginConversion,
    completeConversion,
    releaseConversion
  };
}
