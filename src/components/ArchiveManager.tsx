import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { Alert, Animated, Platform, StyleSheet, Text, View } from "react-native";
import { translations } from "../i18n";
import { AppTheme } from "../theme";
import { AppFile, ConvertedFile } from "../types";
import {
  ExtractedArchiveFile,
  createZipArchive,
  extractArchive
} from "../services/archiveService";
import { ZippedOutput, addZippedOutput, listZippedOutputs, removeZippedOutput } from "../services/zippedOutputStore";
import { AnimatedPressable } from "./ui/AnimatedPressable";
import { AnimatedProgressBar } from "./ui/AnimatedProgressBar";

type Props = {
  labels: typeof translations.en;
  theme: AppTheme;
};

export function ArchiveManager({ labels, theme }: Props) {
  const [archive, setArchive] = useState<AppFile | null>(null);
  const [compressFiles, setCompressFiles] = useState<AppFile[]>([]);
  const [extractedFiles, setExtractedFiles] = useState<ExtractedArchiveFile[]>([]);
  const [zipOutput, setZipOutput] = useState<ConvertedFile | null>(null);
  const [zippedOutputs, setZippedOutputs] = useState<ZippedOutput[]>([]);
  const [progress, setProgress] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true
    }).start();
  }, [fade]);

  useEffect(() => {
    void refreshZippedOutputs();
  }, []);

  const refreshZippedOutputs = async () => {
    setZippedOutputs(await listZippedOutputs());
  };

  const pickArchive = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: "*/*"
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setArchive({
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      size: asset.size ?? 0
    });
    setMessage("");
    setExtractedFiles([]);
    setProgress(0);
  };

  const pickFilesForZip = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: "*/*"
    });
    if (result.canceled) return;
    setCompressFiles(
      result.assets.map((asset) => ({
        name: asset.name,
        uri: asset.uri,
        mimeType: asset.mimeType,
        size: asset.size ?? 0
      }))
    );
    setZipOutput(null);
    setProgress(0);
  };

  const runExtract = async () => {
    await extractSelectedArchive(archive);
  };

  const extractSelectedArchive = async (selectedArchive: AppFile | null) => {
    if (!selectedArchive) {
      setMessage(labels.archive.errors.noArchive);
      return;
    }

    try {
      setIsBusy(true);
      setMessage("");
      setProgress(0);
      setArchive(selectedArchive);
      const outputs = await extractArchive(selectedArchive, setProgress);
      setExtractedFiles(outputs);
      setMessage(labels.archive.extractSuccess);
    } catch (caught) {
      setMessage(localizeArchiveError(caught, labels));
    } finally {
      setIsBusy(false);
    }
  };

  const runCompress = async () => {
    try {
      setIsBusy(true);
      setMessage("");
      setProgress(0);
      const output = await createZipArchive(compressFiles, setProgress);
      setZipOutput(output);
      await addZippedOutput(output);
      await refreshZippedOutputs();
      setMessage(labels.archive.compressSuccess);
    } catch (caught) {
      setMessage(localizeArchiveError(caught, labels));
    } finally {
      setIsBusy(false);
    }
  };

  const shareFile = async (file: ConvertedFile) => {
    if (Platform.OS === "web") {
      const anchor = document.createElement("a");
      anchor.href = file.uri;
      anchor.download = file.name;
      anchor.click();
      return;
    }

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert(labels.shareUnavailableTitle, labels.shareUnavailableBody);
      return;
    }
    await Sharing.shareAsync(file.uri, { mimeType: file.mimeType, dialogTitle: file.name });
  };

  const deleteZippedOutput = async (file: ZippedOutput) => {
    await removeZippedOutput(file.uri);
    await refreshZippedOutputs();
    if (archive?.uri === file.uri) {
      setArchive(null);
      setExtractedFiles([]);
    }
  };

  return (
    <Animated.View style={[styles.container, { opacity: fade }]}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconShell, { backgroundColor: theme.colors.primarySoft }]}>
            <Feather name="archive" size={20} color={theme.colors.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.colors.text }]}>{labels.archive.title}</Text>
            <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{labels.archive.subtitle}</Text>
          </View>
        </View>

        <AnimatedPressable
          style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]}
          onPress={pickArchive}
        >
          <Feather name="file-plus" size={18} color={theme.colors.onPrimary} />
          <Text style={[styles.primaryText, { color: theme.colors.onPrimary }]}>
            {archive ? labels.archive.changeArchive : labels.archive.pickArchive}
          </Text>
        </AnimatedPressable>

        {archive ? (
          <View style={[styles.filePill, { backgroundColor: theme.colors.surfaceAlt }]}>
            <Feather name="file" size={16} color={theme.colors.primary} />
            <Text numberOfLines={1} style={[styles.fileName, { color: theme.colors.text }]}>
              {archive.name}
            </Text>
          </View>
        ) : null}

        <AnimatedPressable
          disabled={isBusy || !archive}
          style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
          onPress={runExtract}
        >
          <Feather name="folder-plus" size={18} color={theme.colors.text} />
          <Text style={[styles.secondaryText, { color: theme.colors.text }]}>
            {labels.archive.extract}
          </Text>
        </AnimatedPressable>
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconShell, { backgroundColor: theme.colors.primarySoft }]}>
            <Feather name="layers" size={20} color={theme.colors.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.colors.text }]}>{labels.archive.zippedOutputsTitle}</Text>
            <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{labels.archive.zippedOutputsSubtitle}</Text>
          </View>
        </View>

        {zippedOutputs.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
            {labels.archive.noZippedOutputs}
          </Text>
        ) : (
          zippedOutputs.map((file) => (
            <ArchiveZipRow
              key={`${file.uri}-${file.createdAt}`}
              file={file}
              labels={labels}
              theme={theme}
              onExtract={(selected) => extractSelectedArchive({ ...selected, size: 0 })}
              onShare={shareFile}
              onDelete={deleteZippedOutput}
            />
          ))
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconShell, { backgroundColor: theme.colors.accentSoft }]}>
            <Feather name="package" size={20} color={theme.colors.accent} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.colors.text }]}>{labels.archive.zipTitle}</Text>
            <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{labels.archive.zipSubtitle}</Text>
          </View>
        </View>

        <AnimatedPressable
          style={[styles.secondaryButton, { borderColor: theme.colors.border }]}
          onPress={pickFilesForZip}
        >
          <Feather name="copy" size={18} color={theme.colors.text} />
          <Text style={[styles.secondaryText, { color: theme.colors.text }]}>
            {labels.archive.pickFiles} ({compressFiles.length})
          </Text>
        </AnimatedPressable>

        <AnimatedPressable
          disabled={isBusy || compressFiles.length === 0}
          style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]}
          onPress={runCompress}
        >
          <Feather name="box" size={18} color={theme.colors.onPrimary} />
          <Text style={[styles.primaryText, { color: theme.colors.onPrimary }]}>
            {labels.archive.compress}
          </Text>
        </AnimatedPressable>
      </View>

      <AnimatedProgressBar progress={progress} label={labels.archive.progress} theme={theme} />

      {message ? (
        <Text style={[styles.message, { color: message.includes("başar") || message.includes("ready") ? theme.colors.success : theme.colors.danger }]}>
          {message}
        </Text>
      ) : null}

      {zipOutput ? (
        <View style={styles.list}>
          <View style={[styles.infoBox, { backgroundColor: theme.colors.primarySoft }]}>
            <Feather name="info" size={16} color={theme.colors.primary} />
            <Text style={[styles.infoText, { color: theme.colors.text }]}>
              {labels.archive.createdZipHint}
            </Text>
          </View>
          <ArchiveFileRow file={{ ...zipOutput, size: 0 }} labels={labels} theme={theme} onShare={shareFile} />
        </View>
      ) : null}

      {extractedFiles.length > 0 ? (
        <View style={styles.list}>
          <Text style={[styles.listTitle, { color: theme.colors.text }]}>
            {labels.archive.extractedFiles}
          </Text>
          {extractedFiles.map((file) => (
            <ArchiveFileRow key={file.uri} file={file} labels={labels} theme={theme} onShare={shareFile} />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

function ArchiveZipRow({
  file,
  labels,
  theme,
  onExtract,
  onShare,
  onDelete
}: {
  file: ZippedOutput;
  labels: typeof translations.en;
  theme: AppTheme;
  onExtract: (file: ZippedOutput) => void;
  onShare: (file: ZippedOutput) => void;
  onDelete: (file: ZippedOutput) => void;
}) {
  return (
    <View style={[styles.row, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
      <View style={[styles.smallIcon, { backgroundColor: theme.colors.surface }]}>
        <Feather name="archive" size={16} color={theme.colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowName, { color: theme.colors.text }]}>
          {file.name}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.colors.muted }]}>
          {labels.archive.zippedOutputMeta}
        </Text>
      </View>
      <AnimatedPressable
        style={[styles.iconButton, { backgroundColor: theme.colors.primarySoft }]}
        onPress={() => onExtract(file)}
      >
        <Feather name="folder-plus" size={16} color={theme.colors.primary} />
      </AnimatedPressable>
      <AnimatedPressable
        style={[styles.iconButton, { backgroundColor: theme.colors.primarySoft }]}
        onPress={() => onShare(file)}
      >
        <Feather name="share-2" size={16} color={theme.colors.primary} />
      </AnimatedPressable>
      <AnimatedPressable
        style={[styles.iconButton, { backgroundColor: theme.colors.dangerSoft }]}
        onPress={() => onDelete(file)}
      >
        <Feather name="trash-2" size={16} color={theme.colors.danger} />
      </AnimatedPressable>
    </View>
  );
}

function ArchiveFileRow({
  file,
  labels,
  theme,
  onShare
}: {
  file: ExtractedArchiveFile;
  labels: typeof translations.en;
  theme: AppTheme;
  onShare: (file: ExtractedArchiveFile) => void;
}) {
  return (
    <View style={[styles.row, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={[styles.smallIcon, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Feather name="file-text" size={16} color={theme.colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowName, { color: theme.colors.text }]}>
          {file.name}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.colors.muted }]}>
          {file.size ? `${Math.ceil(file.size / 1024)} KB` : labels.archive.zipReady}
        </Text>
      </View>
      <AnimatedPressable
        style={[styles.iconButton, { backgroundColor: theme.colors.primarySoft }]}
        onPress={() => onShare(file)}
      >
        <Feather name="share-2" size={16} color={theme.colors.primary} />
      </AnimatedPressable>
    </View>
  );
}

function localizeArchiveError(caught: unknown, labels: typeof translations.en) {
  const message = caught instanceof Error ? caught.message : "";
  if (message.includes("ERR_ARCHIVE_NATIVE_REQUIRED")) return labels.archive.errors.nativeRequired;
  if (message.includes("ERR_ARCHIVE_EMPTY")) return labels.archive.errors.empty;
  if (message.includes("ERR_ARCHIVE_PASSWORD_REQUIRED")) return labels.archive.errors.passwordRequired;
  if (message.includes("ERR_ARCHIVE_INVALID_ZIP")) return labels.archive.errors.invalidZip;
  if (message.includes("ERR_ARCHIVE_ZIP64")) return labels.archive.errors.zip64;
  if (message.includes("ERR_ARCHIVE_NO_FILES")) return labels.archive.errors.noFiles;
  if (message.includes("ERR_FILE_READ_FAILED")) return labels.archive.errors.readFailed;
  return labels.archive.errors.failed;
}

const styles = StyleSheet.create({
  container: {
    gap: 16
  },
  card: {
    borderRadius: 18,
    gap: 14,
    padding: 16
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  iconShell: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44
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
    lineHeight: 18
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 14
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 14
  },
  primaryText: {
    fontSize: 15,
    fontWeight: "900"
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: "900"
  },
  filePill: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12
  },
  fileName: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800"
  },
  message: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20
  },
  infoBox: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    padding: 12
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18
  },
  list: {
    gap: 10
  },
  listTitle: {
    fontSize: 16,
    fontWeight: "900"
  },
  row: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 64,
    padding: 10
  },
  smallIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  rowText: {
    flex: 1
  },
  rowName: {
    fontSize: 14,
    fontWeight: "900"
  },
  rowMeta: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40
  }
});
