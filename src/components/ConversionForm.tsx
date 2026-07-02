import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { translations } from "../i18n";
import { AppTheme } from "../theme";
import { AppFile, FileType } from "../types";
import { AnimatedPressable } from "./ui/AnimatedPressable";
import { InstagramGradient } from "./ui/InstagramGradient";

type Props = {
  files: AppFile[];
  inputType: FileType;
  theme: AppTheme;
  labels: typeof translations.en;
  onSelectFiles: () => void;
  onRemoveFile: (uri: string) => void;
  onRenameFile: (file: AppFile) => void;
  onClearFiles: () => void;
};

export function ConversionForm(props: Props) {
  const {
    files,
    inputType,
    theme,
    labels,
    onSelectFiles,
    onRemoveFile,
    onRenameFile,
    onClearFiles
  } = props;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.introRow}>
        <View style={[styles.introIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Feather name="upload-cloud" size={22} color={theme.colors.primary} />
        </View>
        <View style={styles.introText}>
          <Text style={[styles.introTitle, { color: theme.colors.text }]}>{labels.filePickerTitle}</Text>
          <Text style={[styles.introSubtitle, { color: theme.colors.muted }]}>{labels.filePickerSubtitle}</Text>
        </View>
      </View>

      <View style={styles.hintGrid}>
        <View style={styles.hintItem}>
          <Feather name="check-circle" size={15} color={theme.colors.primary} />
          <Text style={[styles.hintText, { color: theme.colors.muted }]}>{labels.filePickerFormatHint}</Text>
        </View>
        <View style={styles.hintItem}>
          <Feather name="zap" size={15} color={theme.colors.accent} />
          <Text style={[styles.hintText, { color: theme.colors.muted }]}>{labels.filePickerFlowHint}</Text>
        </View>
      </View>

      <AnimatedPressable
        style={styles.gradientButtonClip}
        onPress={onSelectFiles}
      >
        <InstagramGradient theme={theme} style={styles.fileButton}>
          <View style={[styles.plusBubble, { backgroundColor: theme.colors.onPrimary }]}>
            <Feather name="plus" size={24} color={theme.colors.primary} />
          </View>
          <Text style={styles.fileButtonText}>
            {files.length > 0 ? labels.changeFiles : labels.selectFiles}
          </Text>
        </InstagramGradient>
      </AnimatedPressable>

      <View style={styles.fileList}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.label, { color: theme.colors.muted }]}>
            {labels.selectedFiles} ({files.length})
          </Text>
          {files.length > 0 ? (
            <Text style={[styles.sectionMeta, { color: theme.colors.primary }]}>
              {inputType.toUpperCase()}
            </Text>
          ) : null}
        </View>
        {files.length === 0 ? (
          <View style={[styles.emptyState, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }]}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.surface }]}>
              <Feather name="file-plus" size={18} color={theme.colors.primary} />
            </View>
            <View style={styles.emptyCopy}>
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{labels.filePickerEmptyTitle}</Text>
              <Text style={[styles.emptyBody, { color: theme.colors.muted }]}>{labels.filePickerEmptyBody}</Text>
            </View>
          </View>
        ) : (
          files.slice(0, 5).map((file) => (
            <View key={file.uri} style={[styles.fileRow, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }]}>
              <View style={[styles.fileIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name={iconForFile(inputType)} size={16} color={theme.colors.primary} />
              </View>
              <Text
                numberOfLines={1}
                style={[styles.fileName, { color: theme.colors.text }]}
              >
                {file.name}
              </Text>
              <TouchableOpacity
                accessibilityLabel={labels.renameFile}
                style={[styles.editButton, { backgroundColor: theme.colors.surfaceAlt }]}
                onPress={() => onRenameFile(file)}
              >
                <Feather name="edit-3" size={15} color={theme.colors.muted} />
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel={labels.removeFile}
                style={[styles.removeButton, { backgroundColor: theme.colors.dangerSoft }]}
                onPress={() => onRemoveFile(file.uri)}
              >
                <Feather name="x" size={16} color={theme.colors.danger} />
              </TouchableOpacity>
            </View>
          ))
        )}
        {files.length > 0 ? (
          <TouchableOpacity
            style={[styles.clearButton, { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft }]}
            onPress={onClearFiles}
          >
            <Feather name="trash-2" size={15} color={theme.colors.danger} />
            <Text style={[styles.clearText, { color: theme.colors.danger }]}>
              {labels.clearSelectedFiles}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.pickerGroup}>
        <Text style={[styles.label, { color: theme.colors.muted }]}>{labels.detectedType}</Text>
        <View style={[styles.detectedBox, { borderColor: theme.colors.border }]}>
          <Text style={[styles.detectedText, { color: theme.colors.text }]}>
            {files.length > 0 ? inputType.toUpperCase() : labels.waitingForFile}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 16,
    padding: 16,
    shadowColor: "#DD2A7B",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 28
  },
  introRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  introIcon: {
    alignItems: "center",
    borderRadius: 18,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  introText: {
    flex: 1,
    gap: 3
  },
  introTitle: {
    fontSize: 18,
    fontWeight: "900"
  },
  introSubtitle: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  hintGrid: {
    gap: 8
  },
  hintItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  gradientButtonClip: {
    borderRadius: 24,
    overflow: "hidden"
  },
  fileButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    minHeight: 68,
    paddingHorizontal: 16
  },
  fileButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800"
  },
  plusBubble: {
    alignItems: "center",
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  fileList: {
    gap: 8
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  label: {
    fontSize: 13,
    fontWeight: "800"
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: "900"
  },
  fileName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800"
  },
  fileRow: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 56,
    paddingLeft: 8,
    paddingRight: 8
  },
  emptyState: {
    alignItems: "center",
    borderRadius: 20,
    borderStyle: "dashed",
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    padding: 12
  },
  emptyIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  emptyCopy: {
    flex: 1,
    gap: 3
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "900"
  },
  emptyBody: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  fileIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  removeButton: {
    alignItems: "center",
    borderRadius: 12,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  editButton: {
    alignItems: "center",
    borderRadius: 12,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  clearButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 10
  },
  clearText: {
    fontSize: 13,
    fontWeight: "800"
  },
  pickerGroup: {
    gap: 6
  },
  detectedBox: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50
  },
  detectedText: {
    fontSize: 15,
    fontWeight: "900"
  }
});

function iconForFile(type: FileType): keyof typeof Feather.glyphMap {
  if (type === "pdf" || type === "udf" || type === "doc" || type === "docx" || type === "txt") return "file-text";
  if (type === "jpg" || type === "png" || type === "gif" || type === "webp" || type === "bmp") return "image";
  if (type === "mp4" || type === "mov" || type === "avi" || type === "mkv" || type === "webm") return "video";
  if (type === "mp3" || type === "wav" || type === "ogg" || type === "flac" || type === "m4a") return "music";
  if (type === "zip" || type === "rar" || type === "7z" || type === "tar") return "archive";
  return "file";
}
