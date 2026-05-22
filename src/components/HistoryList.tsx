import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { translations } from "../i18n";
import { AppTheme } from "../theme";
import { ConversionJob } from "../types";

type Props = {
  history: ConversionJob[];
  labels: typeof translations.en;
  theme: AppTheme;
  onRetry: (job: ConversionJob) => void;
  onShare: (job: ConversionJob) => void;
  onClear: () => void;
  onDelete: (job: ConversionJob) => void;
};

export function HistoryList({ history, labels, theme, onRetry, onShare, onClear, onDelete }: Props) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.clearButton, { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft }]}
        onPress={onClear}
      >
        <Feather name="trash-2" size={18} color={theme.colors.danger} />
        <Text style={[styles.clearText, { color: theme.colors.danger }]}>{labels.clearHistory}</Text>
      </TouchableOpacity>

      {history.length === 0 ? (
        <Text style={[styles.empty, { color: theme.colors.muted }]}>{labels.noHistory}</Text>
      ) : (
        history.map((job) => (
          <View key={job.id} style={[styles.item, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.itemHeader}>
              <Text style={[styles.itemTitle, { color: theme.colors.text }]}>
                {job.inputType.toUpperCase()}
                {" -> "}
                {job.outputType.toUpperCase()}
              </Text>
              <Text
                style={[
                  styles.status,
                  { color: job.status === "success" ? theme.colors.success : theme.colors.danger }
                ]}
              >
                {job.status}
              </Text>
            </View>
            <Text style={[styles.meta, { color: theme.colors.muted }]}>
              {new Date(job.createdAt).toLocaleString()} | {job.files.length} file(s)
            </Text>
            {job.error ? (
              <Text style={[styles.error, { color: theme.colors.danger }]}>{job.error}</Text>
            ) : null}
            <View style={styles.actions}>
              {job.status === "success" ? (
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: theme.colors.primary }]}
                  onPress={() => onRetry(job)}
                >
                  <Feather name="refresh-cw" size={16} color={theme.colors.primary} />
                  <Text style={[styles.actionText, { color: theme.colors.primary }]}>
                    {labels.retry}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {job.status === "success" ? (
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: theme.colors.primary }]}
                  onPress={() => onShare(job)}
                >
                  <Feather name="share-2" size={16} color={theme.colors.primary} />
                  <Text style={[styles.actionText, { color: theme.colors.primary }]}>
                    {labels.share}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.iconOnlyButton, { backgroundColor: theme.colors.dangerSoft }]}
                onPress={() => onDelete(job)}
              >
                <Feather name="trash-2" size={16} color={theme.colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12
  },
  clearButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12
  },
  clearText: {
    fontSize: 14,
    fontWeight: "800"
  },
  empty: {
    fontSize: 15
  },
  item: {
    borderRadius: 8,
    gap: 8,
    padding: 14
  },
  itemHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "900"
  },
  status: {
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  meta: {
    fontSize: 13
  },
  error: {
    fontSize: 13,
    lineHeight: 18
  },
  actions: {
    flexDirection: "row",
    gap: 8
  },
  actionButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 10
  },
  actionText: {
    fontSize: 13,
    fontWeight: "800"
  },
  iconOnlyButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38
  }
});
