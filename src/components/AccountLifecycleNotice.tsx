import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Language } from "../i18n";
import { AppTheme } from "../theme";
import type { AccountLifecycleEvent } from "./AccountModal";
import { InstagramGradient } from "./ui/InstagramGradient";

type Props = {
  event: AccountLifecycleEvent | null;
  isLandscape: boolean;
  language: Language;
  theme: AppTheme;
  onDismiss: () => void;
};

type NoticeCopy = {
  createdLoading: string;
  createdTitle: string;
  createdBody: string;
  deletedLoading: string;
  deletedTitle: string;
  deletedBody: string;
};

const english: NoticeCopy = {
  createdLoading: "Preparing your account",
  createdTitle: "Congratulations!",
  createdBody: "Your Editio account is ready.",
  deletedLoading: "Securely removing your account",
  deletedTitle: "Account deleted",
  deletedBody: "Your account information and active sessions were removed."
};

const copies: Record<Language, NoticeCopy> = {
  en: english,
  tr: {
    createdLoading: "Hesabınız hazırlanıyor",
    createdTitle: "Tebrikler!",
    createdBody: "Editio hesabınız başarıyla oluşturuldu.",
    deletedLoading: "Hesabınız güvenle kaldırılıyor",
    deletedTitle: "Hesabınız silindi",
    deletedBody: "Hesap bilgileriniz ve aktif oturumlarınız kaldırıldı."
  },
  zh: {
    createdLoading: "正在准备您的帐户",
    createdTitle: "恭喜！",
    createdBody: "您的 Editio 帐户已创建。",
    deletedLoading: "正在安全删除您的帐户",
    deletedTitle: "帐户已删除",
    deletedBody: "您的帐户信息和活动会话已删除。"
  },
  fr: {
    createdLoading: "Préparation de votre compte",
    createdTitle: "Félicitations !",
    createdBody: "Votre compte Editio est prêt.",
    deletedLoading: "Suppression sécurisée de votre compte",
    deletedTitle: "Compte supprimé",
    deletedBody: "Vos informations et sessions actives ont été supprimées."
  },
  ru: {
    createdLoading: "Подготовка аккаунта",
    createdTitle: "Поздравляем!",
    createdBody: "Ваш аккаунт Editio создан.",
    deletedLoading: "Безопасное удаление аккаунта",
    deletedTitle: "Аккаунт удален",
    deletedBody: "Данные аккаунта и активные сеансы удалены."
  },
  de: {
    createdLoading: "Ihr Konto wird vorbereitet",
    createdTitle: "Herzlichen Glückwunsch!",
    createdBody: "Ihr Editio-Konto ist bereit.",
    deletedLoading: "Ihr Konto wird sicher entfernt",
    deletedTitle: "Konto gelöscht",
    deletedBody: "Ihre Kontodaten und aktiven Sitzungen wurden entfernt."
  },
  es: {
    createdLoading: "Preparando tu cuenta",
    createdTitle: "¡Enhorabuena!",
    createdBody: "Tu cuenta de Editio está lista.",
    deletedLoading: "Eliminando tu cuenta de forma segura",
    deletedTitle: "Cuenta eliminada",
    deletedBody: "Se eliminaron los datos de tu cuenta y las sesiones activas."
  }
};

export function AccountLifecycleNotice({ event, isLandscape, language, theme, onDismiss }: Props) {
  const [complete, setComplete] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.84)).current;
  const copy = copies[language] ?? english;

  useEffect(() => {
    if (!event) return undefined;

    setComplete(false);
    opacity.setValue(0);
    scale.setValue(0.92);
    progress.setValue(0);
    rotation.setValue(0);
    iconScale.setValue(0.84);

    Animated.parallel([
      Animated.timing(opacity, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true
      }),
      Animated.spring(scale, {
        damping: 17,
        mass: 0.7,
        stiffness: 210,
        toValue: 1,
        useNativeDriver: true
      }),
      Animated.timing(rotation, {
        duration: 720,
        easing: Easing.inOut(Easing.cubic),
        toValue: 1,
        useNativeDriver: true
      }),
      Animated.timing(progress, {
        duration: 720,
        easing: Easing.inOut(Easing.cubic),
        toValue: 1,
        useNativeDriver: false
      })
    ]).start();

    const completeTimer = setTimeout(() => {
      setComplete(true);
      iconScale.setValue(0.72);
      Animated.spring(iconScale, {
        damping: 11,
        stiffness: 240,
        toValue: 1,
        useNativeDriver: true
      }).start();
    }, 740);

    const dismissTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { duration: 220, toValue: 0, useNativeDriver: true }),
        Animated.timing(scale, { duration: 220, toValue: 0.97, useNativeDriver: true })
      ]).start(onDismiss);
    }, 2250);

    return () => {
      clearTimeout(completeTimer);
      clearTimeout(dismissTimer);
      opacity.stopAnimation();
      scale.stopAnimation();
      progress.stopAnimation();
      rotation.stopAnimation();
      iconScale.stopAnimation();
    };
  }, [event, iconScale, onDismiss, opacity, progress, rotation, scale]);

  if (!event) return null;

  const title = complete
    ? event === "created" ? copy.createdTitle : copy.deletedTitle
    : event === "created" ? copy.createdLoading : copy.deletedLoading;
  const body = event === "created" ? copy.createdBody : copy.deletedBody;
  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "540deg"] });
  const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["4%", "100%"] });

  return (
    <Modal
      animationType="none"
      transparent
      visible
      statusBarTranslucent
      supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
    >
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Animated.View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[
            styles.notice,
            isLandscape && styles.noticeLandscape,
            { backgroundColor: theme.colors.surface, borderColor: theme.isDark ? theme.colors.border : "#C7C9D1", transform: [{ scale }] }
          ]}
        >
          <Animated.View style={[styles.iconMotion, { transform: [{ scale: iconScale }, { rotate: complete ? "0deg" : rotate }] }]}>
            <InstagramGradient theme={theme} style={styles.icon}>
              <Feather name={complete ? "check" : "refresh-cw"} size={24} color="#FFFFFF" />
            </InstagramGradient>
          </Animated.View>
          <View style={styles.textColumn}>
            <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
            {complete ? <Text style={[styles.body, { color: theme.colors.muted }]}>{body}</Text> : null}
          </View>
          <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceAlt }]}>
            <Animated.View style={[styles.progressFillClip, { width: progressWidth }]}>
              <InstagramGradient theme={theme} style={StyleSheet.absoluteFill} />
            </Animated.View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.34)",
    flex: 1,
    justifyContent: "center",
    padding: 22
  },
  notice: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    maxWidth: 380,
    minHeight: 188,
    padding: 22,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    width: "100%"
  },
  noticeLandscape: { maxWidth: 520, minHeight: 170, width: "48%" },
  iconMotion: { alignItems: "center", justifyContent: "center" },
  icon: { alignItems: "center", borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  textColumn: { alignItems: "center", gap: 5, minHeight: 48 },
  title: { fontSize: 18, fontWeight: "900", letterSpacing: 0, textAlign: "center" },
  body: { fontSize: 12, fontWeight: "700", lineHeight: 17, textAlign: "center" },
  progressTrack: { borderRadius: 999, height: 5, marginTop: 2, overflow: "hidden", width: "100%" },
  progressFillClip: { borderRadius: 999, height: "100%", overflow: "hidden" }
});
