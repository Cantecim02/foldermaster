import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { translations } from "../i18n";
import { AppTheme } from "../theme";
import { AnimatedPressable } from "./ui/AnimatedPressable";
import { InstagramGradient } from "./ui/InstagramGradient";

type Props = {
  labels: typeof translations.en;
  theme: AppTheme;
  onOpen: () => void;
};

export function DocumentEditorCard({ labels, theme, onOpen }: Props) {
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.iconShell, { backgroundColor: theme.colors.primarySoft }]}>
          <Feather name="edit-3" size={20} color={theme.colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.colors.text }]}>{labels.documentEditor.cardTitle}</Text>
          <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{labels.documentEditor.cardSubtitle}</Text>
        </View>
      </View>
      <AnimatedPressable style={styles.buttonClip} onPress={onOpen}>
        <InstagramGradient theme={theme} style={styles.button}>
          <Feather name="file-plus" size={19} color="#fff" />
          <Text style={styles.buttonText}>{labels.documentEditor.openEditor}</Text>
        </InstagramGradient>
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 16,
    shadowColor: "#DD2A7B",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 24
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  iconShell: {
    alignItems: "center",
    borderRadius: 18,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  headerText: {
    flex: 1
  },
  title: {
    fontSize: 18,
    fontWeight: "900"
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3
  },
  buttonClip: {
    borderRadius: 20,
    overflow: "hidden"
  },
  button: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 14
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900"
  }
});
