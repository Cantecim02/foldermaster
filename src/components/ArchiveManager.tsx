import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  InteractionManager,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { translations } from "../i18n";
import { AppTheme } from "../theme";
import { AppFile, ConvertedFile } from "../types";
import {
  ExtractedArchiveFile,
  createZipArchive,
  extractArchive
} from "../services/archiveService";
import { recordBreadcrumb, recordInternalError } from "../services/errorMonitor";
import {
  archivePickerMimeTypes,
  canExtractArchive,
  createFileRouteLogMetadata,
  routeFileForOperation,
  type FileRoute
} from "../services/fileRouter";
import { ZippedOutput, addZippedOutput, listZippedOutputs, removeZippedOutput } from "../services/zippedOutputStore";
import { ConversionLoader } from "./ConversionLoader";
import { AnimatedPressable } from "./ui/AnimatedPressable";

type Props = {
  labels: typeof translations.en;
  theme: AppTheme;
  quickIntent?: ArchiveQuickIntent | null;
  onQuickIntentConsumed?: (id: number) => void;
};

export type ArchiveQuickIntent = {
  id: number;
  mode: "extract" | "compress";
  files: AppFile[];
  autoRun?: boolean;
};

export function ArchiveManager({ labels, theme, quickIntent, onQuickIntentConsumed }: Props) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [archive, setArchive] = useState<AppFile | null>(null);
  const [compressFiles, setCompressFiles] = useState<AppFile[]>([]);
  const [extractedResultFiles, setExtractedResultFiles] = useState<ExtractedArchiveFile[]>([]);
  const [extractResultVisible, setExtractResultVisible] = useState(false);
  const [zipResultOutput, setZipResultOutput] = useState<ConvertedFile | null>(null);
  const [zipResultVisible, setZipResultVisible] = useState(false);
  const [zippedOutputs, setZippedOutputs] = useState<ZippedOutput[]>([]);
  const [progress, setProgress] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [busyMode, setBusyMode] = useState<"extract" | "compress" | null>(null);
  const [archiveErrorCode, setArchiveErrorCode] = useState<keyof typeof translations.en.archive.errors | null>(null);
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
      type: archivePickerMimeTypes
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const selectedArchive = {
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      size: asset.size ?? 0
    };
    const route = routeFileForOperation(selectedArchive, "archive.extract");
    void recordBreadcrumb("Archive file route", createFileRouteLogMetadata(route, selectedArchive));
    setArchive(selectedArchive);
    setArchiveErrorCode(getArchiveSelectionErrorFromRoute(route));
    setExtractedResultFiles([]);
    setExtractResultVisible(false);
    setZipResultVisible(false);
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
    setZipResultOutput(null);
    setZipResultVisible(false);
    setProgress(0);
  };

  const runExtract = async () => {
    await extractSelectedArchive(archive);
  };

  const extractSelectedArchive = async (selectedArchive: AppFile | null) => {
    if (!selectedArchive) {
      setArchiveErrorCode("noArchive");
      return;
    }

    const route = routeFileForOperation(selectedArchive, "archive.extract");
    void recordBreadcrumb("Archive file route", createFileRouteLogMetadata(route, selectedArchive));
    const selectionError = getArchiveSelectionErrorFromRoute(route);
    if (selectionError) {
      setArchive(selectedArchive);
      setArchiveErrorCode(selectionError);
      setProgress(0);
      return;
    }

    let extractedOutputs: ExtractedArchiveFile[] | null = null;
    try {
      setIsBusy(true);
      setBusyMode("extract");
      setArchiveErrorCode(null);
      setProgress(0);
      setArchive(selectedArchive);
      const outputs = await extractArchive(selectedArchive, setProgress);
      extractedOutputs = outputs;
      setExtractedResultFiles(outputs);
    } catch (caught) {
      const errorCode = getArchiveErrorCode(caught);
      if (errorCode !== "unsupported") {
        void recordInternalError(
          "error",
          [caught, { feature: "archive", operation: "extract", file: selectedArchive.name }],
          "archive.extract",
        );
      }
      setArchiveErrorCode(errorCode);
    } finally {
      setIsBusy(false);
      setBusyMode(null);
      if (extractedOutputs?.length) {
        setTimeout(() => setExtractResultVisible(true), 120);
      }
    }
  };

  useEffect(() => {
    if (!quickIntent?.files.length) return;
    let quickTimer: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;
    setArchiveErrorCode(null);
    setProgress(0);

    if (quickIntent.mode === "compress") {
      setCompressFiles(quickIntent.autoRun ? [] : quickIntent.files);
      setZipResultOutput(null);
      setZipResultVisible(false);
      setExtractedResultFiles([]);
      setExtractResultVisible(false);
      if (quickIntent.autoRun) {
        const interaction = InteractionManager.runAfterInteractions(() => {
          quickTimer = setTimeout(() => {
            if (!isCancelled) {
              void compressSelectedFiles(quickIntent.files, { clearSelection: true });
              onQuickIntentConsumed?.(quickIntent.id);
            }
          }, 360);
        });
        return () => {
          isCancelled = true;
          interaction.cancel();
          if (quickTimer) clearTimeout(quickTimer);
        };
      }
      onQuickIntentConsumed?.(quickIntent.id);
      return;
    }

    const selectedArchive = quickIntent.files[0];
    setArchive(selectedArchive);
    setExtractedResultFiles([]);
    setExtractResultVisible(false);
    quickTimer = setTimeout(() => {
      if (!isCancelled) {
        void extractSelectedArchive(selectedArchive);
        onQuickIntentConsumed?.(quickIntent.id);
      }
    }, 120);
    return () => {
      isCancelled = true;
      if (quickTimer) clearTimeout(quickTimer);
    };
  }, [quickIntent?.id, onQuickIntentConsumed]);

  const compressSelectedFiles = async (selectedFiles: AppFile[], options?: { clearSelection?: boolean }) => {
    let createdOutput: ConvertedFile | null = null;
    try {
      setIsBusy(true);
      setBusyMode("compress");
      setArchiveErrorCode(null);
      setZipResultVisible(false);
      setProgress(0);
      await waitForUiFrame();
      const output = await createZipArchive(selectedFiles, setProgress);
      createdOutput = output;
      setZipResultOutput(output);
      await addZippedOutput(output);
      await refreshZippedOutputs();
      if (options?.clearSelection) {
        setCompressFiles([]);
      }
    } catch (caught) {
      void recordInternalError(
        "error",
        [caught, { feature: "archive", operation: "compress", files: selectedFiles.map((file) => file.name) }],
        "archive.compress",
      );
      setArchiveErrorCode(getArchiveErrorCode(caught));
    } finally {
      setIsBusy(false);
      setBusyMode(null);
      if (createdOutput) {
        setTimeout(() => setZipResultVisible(true), 120);
      }
    }
  };

  const runCompress = async () => {
    await compressSelectedFiles(compressFiles, { clearSelection: true });
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
      setExtractedResultFiles([]);
      setExtractResultVisible(false);
    }
  };

  const clearSelectedArchive = () => {
    setArchive(null);
    setExtractedResultFiles([]);
    setExtractResultVisible(false);
    setZipResultVisible(false);
    setProgress(0);
  };

  const removeCompressFile = (uri: string) => {
    setCompressFiles((current) => current.filter((file) => file.uri !== uri));
    setZipResultOutput(null);
    setZipResultVisible(false);
    setProgress(0);
  };

  const openExtractResultModal = () => {
    if (!extractedResultFiles.length) return;
    setExtractResultVisible(false);
    setTimeout(() => setExtractResultVisible(true), 0);
  };

  const archiveCanExtract = canExtractArchive(archive);

  return (
    <Animated.View style={[styles.container, { opacity: fade }]}>
      <Modal
        transparent
        animationType="none"
        visible={isBusy}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
      >
        <View style={[styles.loaderOverlay, isLandscape && styles.loaderOverlayLandscape]}>
          <View style={[styles.loaderWrap, isLandscape && styles.loaderWrapLandscape]}>
            <ConversionLoader
              progress={progress}
              theme={theme}
              label={busyMode === "compress" ? labels.archive.compress : labels.archive.extract}
              letterText={labels.generating}
              subtitle={labels.preparingOutput}
            />
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={Boolean(archiveErrorCode)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => setArchiveErrorCode(null)}
      >
        <View style={[styles.resultOverlay, isLandscape && styles.resultOverlayLandscape]}>
          <View style={[styles.resultModal, isLandscape && styles.resultModalLandscape, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={[styles.resultIcon, { backgroundColor: theme.colors.dangerSoft }]}>
              <Feather name="alert-triangle" size={22} color={theme.colors.danger} />
            </View>
            <Text style={[styles.resultTitle, { color: theme.colors.text }]}>{labels.errorTitle}</Text>
            <Text style={[styles.resultBody, { color: theme.colors.muted }]}>
              {archiveErrorCode ? labels.archive.errors[archiveErrorCode] : ""}
            </Text>
            <AnimatedPressable
              style={[styles.resultSoloButton, { backgroundColor: theme.colors.primary }]}
              onPress={() => setArchiveErrorCode(null)}
            >
              <Text style={[styles.resultPrimaryText, { color: theme.colors.onPrimary }]}>{labels.ok}</Text>
            </AnimatedPressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={zipResultVisible && Boolean(zipResultOutput)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => setZipResultVisible(false)}
      >
        <View style={[styles.resultOverlay, isLandscape && styles.resultOverlayLandscape]}>
          <View style={[styles.resultModal, styles.zipResultModal, isLandscape && styles.zipResultModalLandscape, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={[styles.resultIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Feather name="share-2" size={22} color={theme.colors.primary} />
            </View>
            <Text style={[styles.resultTitle, { color: theme.colors.text }]}>{labels.archive.compressSuccess}</Text>
            <Text style={[styles.resultBody, { color: theme.colors.muted }]}>
              {labels.archive.createdZipHint}
            </Text>
            {zipResultOutput ? (
              <ArchiveResultFileSummary file={{ ...zipResultOutput, size: 0 }} labels={labels} theme={theme} />
            ) : null}
            <View style={styles.resultActions}>
              <AnimatedPressable
                containerStyle={styles.resultActionSlot}
                style={[styles.resultSecondaryButton, { borderColor: theme.colors.border }]}
                onPress={() => setZipResultVisible(false)}
              >
                <Text style={[styles.resultSecondaryText, { color: theme.colors.text }]}>{labels.cancel}</Text>
              </AnimatedPressable>
              {zipResultOutput ? (
                <AnimatedPressable
                  containerStyle={styles.resultActionSlot}
                  style={[styles.resultPrimaryButton, { backgroundColor: theme.colors.primary }]}
                  onPress={() => void shareFile(zipResultOutput)}
                >
                  <Feather name="share-2" size={16} color={theme.colors.onPrimary} />
                  <Text style={[styles.resultPrimaryText, { color: theme.colors.onPrimary }]}>{labels.share}</Text>
                </AnimatedPressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={extractResultVisible && extractedResultFiles.length > 0}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => setExtractResultVisible(false)}
      >
        <View style={[styles.resultOverlay, isLandscape && styles.resultOverlayLandscape]}>
          <View style={[styles.resultModal, styles.extractResultModal, isLandscape && styles.extractResultModalLandscape, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={[styles.resultIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Feather name="folder-plus" size={22} color={theme.colors.primary} />
            </View>
            <Text style={[styles.resultTitle, { color: theme.colors.text }]}>{labels.archive.extractSuccess}</Text>
            <Text style={[styles.resultBody, { color: theme.colors.muted }]}>{labels.archive.extractedFiles}</Text>
            <ScrollView style={styles.resultListScroll} contentContainerStyle={styles.resultList} showsVerticalScrollIndicator={false}>
              {extractedResultFiles.map((file) => (
                <ArchiveFileRow key={file.uri} file={file} labels={labels} theme={theme} onShare={shareFile} />
              ))}
            </ScrollView>
            <AnimatedPressable
              style={[styles.resultSoloButton, { backgroundColor: theme.colors.primary }]}
              onPress={() => setExtractResultVisible(false)}
            >
              <Text style={[styles.resultPrimaryText, { color: theme.colors.onPrimary }]}>{labels.ok}</Text>
            </AnimatedPressable>
          </View>
        </View>
      </Modal>
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
            <AnimatedPressable
              style={[styles.pillRemoveButton, { backgroundColor: theme.colors.dangerSoft }]}
              onPress={clearSelectedArchive}
            >
              <Feather name="x" size={14} color={theme.colors.danger} />
            </AnimatedPressable>
          </View>
        ) : null}

        <AnimatedPressable
          disabled={isBusy || !archiveCanExtract}
          style={[styles.secondaryButton, { borderColor: theme.colors.border, opacity: archiveCanExtract ? 1 : 0.52 }]}
          onPress={runExtract}
        >
          <Feather name="folder-plus" size={18} color={theme.colors.text} />
          <Text style={[styles.secondaryText, { color: theme.colors.text }]}>
            {labels.archive.extract}
          </Text>
        </AnimatedPressable>
      </View>

      {extractedResultFiles.length > 0 ? (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconShell, { backgroundColor: theme.colors.primarySoft }]}>
              <Feather name="folder-plus" size={20} color={theme.colors.primary} />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: theme.colors.text }]}>{labels.archive.extractedFiles}</Text>
              <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{labels.archive.extractSuccess}</Text>
            </View>
            <AnimatedPressable
              style={[styles.iconButton, { backgroundColor: theme.colors.primarySoft }]}
              onPress={openExtractResultModal}
            >
              <Feather name="maximize-2" size={16} color={theme.colors.primary} />
            </AnimatedPressable>
          </View>
          <View style={styles.resultList}>
            {extractedResultFiles.map((file) => (
              <ArchiveFileRow key={file.uri} file={file} labels={labels} theme={theme} onShare={shareFile} />
            ))}
          </View>
        </View>
      ) : null}

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

        {compressFiles.length > 0 ? (
          <View style={styles.selectedZipFiles}>
            {compressFiles.map((file) => (
              <View key={file.uri} style={[styles.filePill, { backgroundColor: theme.colors.surfaceAlt }]}>
                <Feather name="file" size={16} color={theme.colors.accent} />
                <Text numberOfLines={1} style={[styles.fileName, { color: theme.colors.text }]}>
                  {file.name}
                </Text>
                <AnimatedPressable
                  style={[styles.pillRemoveButton, { backgroundColor: theme.colors.dangerSoft }]}
                  onPress={() => removeCompressFile(file.uri)}
                >
                  <Feather name="x" size={14} color={theme.colors.danger} />
                </AnimatedPressable>
              </View>
            ))}
          </View>
        ) : null}

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

function ArchiveResultFileSummary({
  file,
  labels,
  theme
}: {
  file: ExtractedArchiveFile;
  labels: typeof translations.en;
  theme: AppTheme;
}) {
  return (
    <View style={[styles.resultFileSummary, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
      <View style={[styles.smallIcon, { backgroundColor: theme.colors.surface }]}>
        <Feather name="archive" size={16} color={theme.colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowName, { color: theme.colors.text }]}>
          {file.name}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.colors.muted }]}>
          {labels.archive.zipReady}
        </Text>
      </View>
    </View>
  );
}

function getArchiveErrorCode(caught: unknown): keyof typeof translations.en.archive.errors {
  const message = caught instanceof Error ? caught.message : "";
  if (message.includes("ERR_ARCHIVE_NATIVE_REQUIRED")) return "nativeRequired";
  if (message.includes("ERR_ARCHIVE_FORMAT_UNSUPPORTED")) return "unsupported";
  if (message.includes("ERR_ARCHIVE_EMPTY")) return "empty";
  if (message.includes("ERR_ARCHIVE_PASSWORD_REQUIRED")) return "passwordRequired";
  if (message.includes("ERR_ARCHIVE_INVALID_ZIP")) return "invalidZip";
  if (message.includes("ERR_ARCHIVE_ZIP64")) return "zip64";
  if (message.includes("ERR_ARCHIVE_NO_FILES")) return "noFiles";
  if (message.includes("ERR_ARCHIVE_TOO_LARGE")) return "tooLarge";
  if (message.includes("ERR_ARCHIVE_UNSUPPORTED")) return "unsupported";
  if (message.includes("ERR_FILE_READ_FAILED")) return "readFailed";
  return "failed";
}

function getArchiveSelectionErrorFromRoute(route: FileRoute): keyof typeof translations.en.archive.errors | null {
  if (!route.canStart && route.reason === "native-required") return "nativeRequired";
  if (!route.canStart) return "unsupported";
  return null;
}

function waitForUiFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

const styles = StyleSheet.create({
  container: {
    gap: 16
  },
  loaderOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(18, 18, 18, 0.74)",
    flex: 1,
    justifyContent: "center",
    padding: 22
  },
  loaderOverlayLandscape: {
    paddingHorizontal: 44,
    paddingVertical: 14
  },
  loaderWrap: {
    maxWidth: 360,
    width: "100%"
  },
  loaderWrapLandscape: {
    maxWidth: 330
  },
  resultOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(18, 18, 18, 0.58)",
    flex: 1,
    justifyContent: "center",
    padding: 20
  },
  resultOverlayLandscape: {
    paddingHorizontal: 44,
    paddingVertical: 14
  },
  resultModal: {
    alignItems: "center",
    borderRadius: 28,
    borderWidth: 1,
    gap: 14,
    maxHeight: "86%",
    maxWidth: 430,
    padding: 18,
    width: "100%"
  },
  resultModalLandscape: {
    maxHeight: "92%",
    maxWidth: 500,
    padding: 16
  },
  zipResultModal: {
    gap: 12,
    paddingBottom: 20
  },
  zipResultModalLandscape: {
    gap: 10,
    maxWidth: 520,
    paddingBottom: 16
  },
  extractResultModal: {
    maxHeight: "82%"
  },
  extractResultModalLandscape: {
    maxHeight: "90%",
    maxWidth: 560
  },
  resultIcon: {
    alignItems: "center",
    borderRadius: 20,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center"
  },
  resultBody: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center"
  },
  resultActions: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 10,
    width: "100%"
  },
  resultActionSlot: {
    flex: 1,
    minWidth: 0
  },
  resultPrimaryButton: {
    alignItems: "center",
    borderRadius: 16,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    width: "100%"
  },
  resultSoloButton: {
    alignItems: "center",
    alignSelf: "stretch",
    borderRadius: 16,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14
  },
  resultSecondaryButton: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    width: "100%"
  },
  resultPrimaryText: {
    fontSize: 14,
    fontWeight: "900"
  },
  resultSecondaryText: {
    fontSize: 14,
    fontWeight: "900"
  },
  resultListScroll: {
    maxHeight: 320,
    width: "100%"
  },
  resultList: {
    gap: 10,
    paddingBottom: 2
  },
  resultFileSummary: {
    alignItems: "center",
    alignSelf: "stretch",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    padding: 10
  },
  card: {
    borderRadius: 24,
    gap: 14,
    padding: 16,
    shadowColor: "#DD2A7B",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 22
  },
  cardHeader: {
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
    lineHeight: 18
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 22,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 58,
    paddingHorizontal: 14
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 56,
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
    borderRadius: 18,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12
  },
  pillRemoveButton: {
    alignItems: "center",
    borderRadius: 12,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  selectedZipFiles: {
    gap: 8
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
    borderRadius: 18,
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
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 64,
    padding: 10
  },
  smallIcon: {
    alignItems: "center",
    borderRadius: 16,
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
    borderRadius: 16,
    height: 40,
    justifyContent: "center",
    width: 40
  }
});
