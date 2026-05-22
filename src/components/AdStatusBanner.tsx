import { StyleSheet, Text, View } from "react-native";
import { translations } from "../i18n";
import { useAdStore } from "../stores/adStore";
import { AppTheme } from "../theme";

type Props = {
  labels: typeof translations.en;
  theme: AppTheme;
};

export function AdStatusBanner({ labels, theme }: Props) {
  const { status, lastError } = useAdStore();

  if (status === "idle" || status === "closed") return null;

  const text = lastError
    ? `${labels.ad.statusFailed}: ${lastError}`
    : labels.ad.status[status] ?? labels.ad.status.loading;

  return (
    <View style={[styles.banner, { backgroundColor: theme.colors.primarySoft }]}>
      <Text style={[styles.text, { color: theme.colors.primary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  text: {
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center"
  }
});
