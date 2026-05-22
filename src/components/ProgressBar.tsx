import { StyleSheet, Text, View } from "react-native";
import { AppTheme } from "../theme";

type Props = {
  progress: number;
  label: string;
  theme: AppTheme;
};

export function ProgressBar({ progress, label, theme }: Props) {
  const percent = Math.round(progress * 100);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: theme.colors.muted }]}>{label}</Text>
        <Text style={[styles.percent, { color: theme.colors.text }]}>{percent}%</Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.colors.surfaceAlt }]}>
        <View
          style={[
            styles.fill,
            { backgroundColor: theme.colors.primary, width: `${Math.max(4, percent)}%` }
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  label: {
    fontSize: 13,
    fontWeight: "800"
  },
  percent: {
    fontSize: 13,
    fontWeight: "800"
  },
  track: {
    borderRadius: 8,
    height: 10,
    overflow: "hidden"
  },
  fill: {
    borderRadius: 8,
    height: "100%"
  }
});
