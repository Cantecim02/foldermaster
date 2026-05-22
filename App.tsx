import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Appearance,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { AdStatusBanner } from "./src/components/AdStatusBanner";
import { ArchiveManager } from "./src/components/ArchiveManager";
import { ConversionForm } from "./src/components/ConversionForm";
import { HistoryList } from "./src/components/HistoryList";
import { MockRewardedAdModal } from "./src/components/MockRewardedAdModal";
import { ProgressBar } from "./src/components/ProgressBar";
import { useHistory } from "./src/hooks/useHistory";
import { useRewardedAction } from "./src/hooks/useRewardedAction";
import { getInitialLanguage, translations } from "./src/i18n";
import { convertFiles } from "./src/services/conversionService";
import { getAvailableOutputs, supportedConversions } from "./src/services/conversionTypes";
import { addZippedOutput } from "./src/services/zippedOutputStore";
import { ThemeMode, getTheme } from "./src/theme";
import { AppFile, ConvertedFile, ConversionJob, FileType } from "./src/types";

const defaultInput: FileType = "pdf";
const defaultOutput: FileType = "jpg";

export default function App() {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [language, setLanguage] = useState(getInitialLanguage());
  const [files, setFiles] = useState<AppFile[]>([]);
  const [inputType, setInputType] = useState<FileType>(defaultInput);
  const [outputType, setOutputType] = useState<FileType>(defaultOutput);
  const [progress, setProgress] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [isPreparingSelection, setIsPreparingSelection] = useState(false);
  const [activeTab, setActiveTab] = useState<"convert" | "archive" | "history" | "settings">("convert");
  const [error, setError] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<ConversionJob | null>(null);
  const [adVisible, setAdVisible] = useState(false);
  const [gifTrimVisible, setGifTrimVisible] = useState(false);
  const [gifStartSeconds, setGifStartSeconds] = useState(0);
  const [gifDurationSeconds, setGifDurationSeconds] = useState(3);
  const [gifVideoDuration, setGifVideoDuration] = useState(0);
  const [gifCurrentSeconds, setGifCurrentSeconds] = useState(0);
  const [gifThumbnails, setGifThumbnails] = useState<Array<{ id: string; source: any }>>([]);
  const [isGeneratingGifThumbnails, setIsGeneratingGifThumbnails] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AppFile | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [shareConfirmJob, setShareConfirmJob] = useState<ConversionJob | null>(null);
  const gifPreviewUri = files[0]?.uri ?? null;
  const gifPlayer = useVideoPlayer(gifPreviewUri ? { uri: gifPreviewUri } : null, (player) => {
    player.loop = true;
    player.muted = true;
    player.timeUpdateEventInterval = 0.25;
  });
  const {
    history,
    trash,
    addHistory,
    clearHistory,
    deleteHistoryJob,
    restoreTrashJob,
    deleteTrashJobForever,
    emptyTrash
  } = useHistory();
  const { runAfterReward, isWaitingForAd } = useRewardedAction({
    placement: "premium_operation",
    openMockAd: () => setAdVisible(true)
  });

  const theme = useMemo(() => getTheme(themeMode, systemScheme), [themeMode, systemScheme]);
  const t = translations[language];

  useEffect(() => {
    const subscription = Appearance.addChangeListener(() => {
      if (themeMode === "system") setThemeMode("system");
    });
    return () => subscription.remove();
  }, [themeMode]);

  useEffect(() => {
    const availableOutputs = getAvailableOutputs(inputType);
    if (!availableOutputs.includes(outputType)) {
      setOutputType(availableOutputs[0]);
    }
  }, [inputType, outputType]);

  const selectFiles = async () => {
    if (Platform.OS === "web") {
      await selectDocumentFiles();
      return;
    }

    Alert.alert(t.fileSourceTitle, t.fileSourceBody, [
      { text: t.cancel, style: "cancel" },
      { text: t.chooseFiles, onPress: () => void selectDocumentFiles() },
      { text: t.chooseGallery, onPress: () => void selectGalleryMedia() }
    ]);
  };

  const selectDocumentFiles = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: "*/*"
    });

    if (result.canceled) return;

    const selected = result.assets.map((asset) => ({
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      size: asset.size ?? 0
    }));

    applyFiles(selected);
  };

  const selectGalleryMedia = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t.permissionTitle, t.permissionGallery);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images", "videos"],
      orderedSelection: true,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 1,
      selectionLimit: 0,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.High
    });

    if (result.canceled) return;

    const selected = result.assets.map((asset, index) => {
      const extension = extensionFromGalleryAsset(asset);
      return {
        name: asset.fileName ?? `gallery_${Date.now()}_${index}.${extension}`,
        uri: asset.uri,
        mimeType: asset.mimeType ?? mimeFromGalleryAsset(asset, extension),
        size: asset.fileSize ?? 0
      };
    });

    applyFiles(selected);
  };

  const applyFiles = (nextFiles: AppFile[]) => {
    setIsPreparingSelection(true);
    const detectedType = detectFileTypeFromFile(nextFiles[0]);
    const shouldLimit = shouldLimitToSingleFile(detectedType);
    const acceptedFiles = shouldLimit ? nextFiles.slice(0, 1) : nextFiles;
    setFiles(acceptedFiles);
    setError(shouldLimit && nextFiles.length > 1 ? t.singleMediaOnly : null);
    setLastJob(null);

    if (detectedType) {
      setInputType(detectedType);
      const firstOutput = getAvailableOutputs(detectedType)[0];
      if (firstOutput) setOutputType(firstOutput);
    } else if (acceptedFiles.length === 0) {
      setInputType(defaultInput);
      setOutputType(defaultOutput);
    }
    setTimeout(() => setIsPreparingSelection(false), acceptedFiles.length > 0 ? 700 : 0);
  };

  const removeFile = (uri: string) => {
    applyFiles(files.filter((file) => file.uri !== uri));
  };

  const clearFiles = () => {
    applyFiles([]);
  };

  const openRenameFile = (file: AppFile) => {
    setRenameTarget(file);
    setRenameInput(file.name);
  };

  const confirmRenameFile = () => {
    if (!renameTarget) return;
    const cleanName = buildSafeDisplayName(renameInput, renameTarget.name);
    if (cleanName.length === 0) return;

    setFiles((currentFiles) =>
      currentFiles.map((file) => (file.uri === renameTarget.uri ? { ...file, name: cleanName } : file))
    );
    setRenameTarget(null);
    setRenameInput("");
  };

  const handleConvertPress = () => {
    if (isPreparingSelection) {
      setError(t.preparingFile);
      return;
    }

    const selectedInputType = detectFileTypeFromFile(files[0]) ?? inputType;
    if (isGifSource(selectedInputType) && outputType === "gif") {
      openGifTrimModal();
      return;
    }
    void runConversion();
  };

  const openGifTrimModal = () => {
    setGifStartSeconds(0);
    setGifDurationSeconds(3);
    setGifVideoDuration(0);
    setGifCurrentSeconds(0);
    gifPlayer.currentTime = 0;
    setGifTrimVisible(true);
  };

  const confirmGifTrim = () => {
    const durationSeconds = Math.min(3, Math.max(0.5, gifDurationSeconds));
    const maxStart = Math.max(0, gifVideoDuration - durationSeconds);
    const startSeconds = Math.min(maxStart || gifStartSeconds, Math.max(0, gifStartSeconds));
    setGifTrimVisible(false);
    gifPlayer.pause();
    void runConversion(undefined, { startSeconds, durationSeconds });
  };

  const runConversion = async (
    retryJob?: ConversionJob,
    gifTrim?: { startSeconds: number; durationSeconds: number }
  ) => {
    const jobFiles = retryJob?.files ?? files;
    const jobInput = retryJob?.inputType ?? inputType;
    const jobOutput = retryJob?.outputType ?? outputType;

    setError(null);
    setProgress(0);
    setShareConfirmJob(null);

    try {
      if (jobFiles.length === 0) {
        throw new Error(t.errors.noFiles);
      }

      const detectedType = detectFileTypeFromFile(jobFiles[0]);
      if (!detectedType) {
        throw new Error(t.errors.unsupported);
      }

      if (detectedType !== jobInput) {
        setInputType(detectedType);
      }

      if (isGifSource(detectedType) && jobOutput === "gif" && !gifTrim) {
        openGifTrimModal();
        return;
      }

      const conversion = supportedConversions.find(
        (item) => item.input === detectedType && item.output === jobOutput
      );
      if (!conversion) {
        throw new Error(t.errors.unsupported);
      }

      setIsConverting(true);
      const startConversion = () =>
        convertFiles({
          files: jobFiles,
          inputType: detectedType,
          outputType: jobOutput,
          gifTrim,
          onProgress: setProgress
        });
      const result = requiresRewardedAd(detectedType, jobOutput)
        ? await runAfterReward(startConversion)
        : await startConversion();

      const completedJob: ConversionJob = {
        id: `${Date.now()}`,
        files: jobFiles,
        inputType: detectedType,
        outputType: jobOutput,
        createdAt: new Date().toISOString(),
        status: "success",
        outputs: result.outputs
      };

      setLastJob(completedJob);
      await addHistory(completedJob);
      setTimeout(() => setShareConfirmJob(completedJob), 120);
    } catch (caught) {
      const message = localizeConversionError(caught, t);
      const failedJob: ConversionJob = {
        id: `${Date.now()}`,
        files: jobFiles,
        inputType: jobInput,
        outputType: jobOutput,
        createdAt: new Date().toISOString(),
        status: "failed",
        error: message
      };
      setError(message);
      setLastJob(failedJob);
      await addHistory(failedJob);
    } finally {
      setIsConverting(false);
    }
  };

  const shareOutputs = async (job: ConversionJob | null = lastJob) => {
    if (!job?.outputs?.length) {
      Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
      return;
    }

    if (Platform.OS === "web") {
      if (job.outputs.length > 1) {
        const zipOutput = await createWebOutputZip(job.outputs);
        await addZippedOutput(zipOutput);
        const anchor = document.createElement("a");
        anchor.href = zipOutput.uri;
        anchor.download = zipOutput.name;
        anchor.click();
        return;
      }

      for (const output of job.outputs) {
        const anchor = document.createElement("a");
        anchor.href = output.uri;
        anchor.download = output.name;
        anchor.click();
      }
      return;
    }

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert(t.shareUnavailableTitle, t.shareUnavailableBody);
      return;
    }

    if (job.outputs.length > 1) {
      const zipOutput = await createNativeOutputZip(job.outputs);
      await addZippedOutput(zipOutput);
      await Sharing.shareAsync(zipOutput.uri, {
        dialogTitle: zipOutput.name,
        mimeType: "application/zip",
        UTI: "com.pkware.zip-archive"
      });
      return;
    }

    const output = job.outputs[0];
    const shareUri = await prepareShareUri(output);
    await Sharing.shareAsync(shareUri, {
      dialogTitle: output.name,
      mimeType: output.mimeType,
      UTI: output.uti
    });
  };

  const confirmShareLatestOutput = async () => {
    const job = shareConfirmJob;
    if (!job) return;

    try {
      await shareOutputs(job);
      setShareConfirmJob(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t.shareUnavailableBody;
      Alert.alert(t.shareUnavailableTitle, message);
    }
  };

  const saveMediaPermission = async () => {
    if (Platform.OS === "web") return;
    await MediaLibrary.requestPermissionsAsync();
  };

  useEffect(() => {
    saveMediaPermission();
  }, []);

  useEffect(() => {
    if (!gifTrimVisible) {
      gifPlayer.pause();
      setGifThumbnails([]);
      return;
    }

    const timer = setInterval(() => {
      const duration = Number.isFinite(gifPlayer.duration) ? gifPlayer.duration : 0;
      if (duration > 0) setGifVideoDuration(duration);
      const currentTime = Number.isFinite(gifPlayer.currentTime) ? gifPlayer.currentTime : 0;
      setGifCurrentSeconds(currentTime);
      if (currentTime > gifStartSeconds + gifDurationSeconds) {
        gifPlayer.currentTime = gifStartSeconds;
        gifPlayer.pause();
      }
    }, 300);

    return () => clearInterval(timer);
  }, [gifDurationSeconds, gifPlayer, gifStartSeconds, gifTrimVisible]);

  useEffect(() => {
    if (!gifTrimVisible || gifVideoDuration <= 0) return;

    let cancelled = false;
    const createThumbnails = async () => {
      try {
        setIsGeneratingGifThumbnails(true);
        const frameCount = 12;
        const times = Array.from({ length: frameCount }, (_, index) =>
          Math.min(Math.max(0, gifVideoDuration - 0.05), (gifVideoDuration * index) / frameCount)
        );
        const thumbnails = await gifPlayer.generateThumbnailsAsync(times, { maxWidth: 120 });
        if (cancelled) return;
        setGifThumbnails(
          thumbnails.map((thumbnail, index) => ({
            id: `${index}-${thumbnail.requestedTime}`,
            source: thumbnail
          }))
        );
      } catch {
        if (!cancelled) setGifThumbnails([]);
      } finally {
        if (!cancelled) setIsGeneratingGifThumbnails(false);
      }
    };

    void createThumbnails();

    return () => {
      cancelled = true;
    };
  }, [gifPlayer, gifTrimVisible, gifVideoDuration]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
        <StatusBar barStyle={theme.isDark ? "light-content" : "dark-content"} />
        <MockRewardedAdModal
          visible={adVisible}
          theme={theme}
          labels={t.ad}
          onComplete={() => setAdVisible(false)}
        />
        <Modal transparent animationType="fade" visible={Boolean(renameTarget)} onRequestClose={() => setRenameTarget(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.actionModal, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.actionModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name="edit-3" size={22} color={theme.colors.primary} />
              </View>
              <Text style={[styles.actionModalTitle, { color: theme.colors.text }]}>{t.renameFileTitle}</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                value={renameInput}
                onChangeText={setRenameInput}
                placeholder={t.renameFilePlaceholder}
                placeholderTextColor={theme.colors.muted}
                style={[
                  styles.renameInput,
                  {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderColor: theme.colors.border,
                    color: theme.colors.text
                  }
                ]}
              />
              <View style={styles.actionModalButtons}>
                <TouchableOpacity
                  style={[styles.actionCancelButton, { borderColor: theme.colors.border }]}
                  onPress={() => setRenameTarget(null)}
                >
                  <Text style={[styles.actionCancelText, { color: theme.colors.text }]}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionPrimaryButton, { backgroundColor: theme.colors.primary }]}
                  onPress={confirmRenameFile}
                >
                  <Text style={[styles.actionPrimaryText, { color: theme.colors.onPrimary }]}>{t.save}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal transparent animationType="fade" visible={Boolean(shareConfirmJob)} onRequestClose={() => setShareConfirmJob(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.actionModal, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.actionModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name="share-2" size={22} color={theme.colors.primary} />
              </View>
              <Text style={[styles.actionModalTitle, { color: theme.colors.text }]}>{t.shareModalTitle}</Text>
              <Text style={[styles.actionModalBody, { color: theme.colors.muted }]}>
                {shareConfirmJob?.outputs && shareConfirmJob.outputs.length > 1
                  ? `${t.shareModalBody}\n\n${t.multiOutputZipNotice}`
                  : t.shareModalBody}
              </Text>
              <View style={styles.actionModalButtons}>
                <TouchableOpacity
                  style={[styles.actionCancelButton, { borderColor: theme.colors.border }]}
                  onPress={() => setShareConfirmJob(null)}
                >
                  <Text style={[styles.actionCancelText, { color: theme.colors.text }]}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionPrimaryButton, { backgroundColor: theme.colors.success }]}
                  onPress={() => void confirmShareLatestOutput()}
                >
                  <Text style={styles.actionPrimaryText}>{t.shareLatest}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal transparent animationType="fade" visible={gifTrimVisible} onRequestClose={() => setGifTrimVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.gifModal, { backgroundColor: theme.colors.surface }]}>
              <View style={styles.gifModalHeader}>
                <View style={[styles.gifModalIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Feather name="scissors" size={20} color={theme.colors.primary} />
                </View>
                <View style={styles.gifModalTitleWrap}>
                  <Text style={[styles.gifModalTitle, { color: theme.colors.text }]}>{t.gifTrim.title}</Text>
                  <Text style={[styles.gifModalBody, { color: theme.colors.muted }]}>{t.gifTrim.body}</Text>
                </View>
              </View>

              <VideoView
                player={gifPlayer}
                fullscreenOptions={{ enable: false }}
                allowsPictureInPicture={false}
                nativeControls
                style={[styles.gifPreview, { backgroundColor: theme.colors.surfaceAlt }]}
              />

              <View style={styles.gifPreviewActions}>
                <TouchableOpacity
                  style={[styles.gifMiniButton, { backgroundColor: theme.colors.primarySoft }]}
                  onPress={() => {
                    gifPlayer.currentTime = gifStartSeconds;
                    gifPlayer.play();
                  }}
                >
                  <Feather name="play" size={15} color={theme.colors.primary} />
                  <Text style={[styles.gifMiniButtonText, { color: theme.colors.primary }]}>{t.gifTrim.preview}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.gifMiniButton, { backgroundColor: theme.colors.surfaceAlt }]}
                  onPress={() => gifPlayer.pause()}
                >
                  <Feather name="pause" size={15} color={theme.colors.text} />
                  <Text style={[styles.gifMiniButtonText, { color: theme.colors.text }]}>{t.gifTrim.pause}</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.gifTimeline, { backgroundColor: theme.isDark ? "#050a12" : "#111827" }]}>
                <View style={styles.gifTimelineSegments}>
                  {Array.from({ length: 12 }).map((_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.gifTimelineFrame,
                        {
                          borderColor: theme.isDark ? "#253650" : "#374151",
                          backgroundColor: index % 2 === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.14)"
                        }
                      ]}
                    >
                      {gifThumbnails[index] ? (
                        <Image
                          source={gifThumbnails[index].source}
                          style={styles.gifFrameImage}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={[styles.gifFrameMark, { backgroundColor: theme.colors.primary }]} />
                      )}
                    </View>
                  ))}
                </View>
                {isGeneratingGifThumbnails ? (
                  <View style={styles.gifTimelineLoading}>
                    <Feather name="image" size={14} color="#fff" />
                    <Text style={styles.gifTimelineLoadingText}>{t.gifTrim.loadingFrames}</Text>
                  </View>
                ) : null}
                <View
                  pointerEvents="none"
                  style={[
                    styles.gifTimelineSelection,
                    {
                      left: `${timelineLeftPercent(gifStartSeconds, gifVideoDuration)}%`,
                      width: `${timelineWidthPercent(gifDurationSeconds, gifVideoDuration)}%`,
                      borderColor: theme.colors.accent,
                      backgroundColor: theme.isDark ? "rgba(52, 211, 153, 0.22)" : "rgba(15, 188, 143, 0.22)"
                    }
                  ]}
                >
                  <View style={[styles.gifTrimHandle, { backgroundColor: theme.colors.accent }]} />
                  <View style={[styles.gifTrimHandle, { backgroundColor: theme.colors.accent }]} />
                </View>
                <View
                  pointerEvents="none"
                  style={[
                    styles.gifPlayhead,
                    {
                      left: `${timelineLeftPercent(gifCurrentSeconds, gifVideoDuration)}%`,
                      backgroundColor: theme.colors.primary
                    }
                  ]}
                />
              </View>

              <View style={styles.gifSliderGroup}>
                <View style={styles.gifSliderHeader}>
                  <Text style={[styles.gifInputLabel, { color: theme.colors.muted }]}>{t.gifTrim.start}</Text>
                  <Text style={[styles.gifValue, { color: theme.colors.text }]}>{formatSeconds(gifStartSeconds)}</Text>
                </View>
                <Slider
                  minimumValue={0}
                  maximumValue={Math.max(0, gifVideoDuration - gifDurationSeconds)}
                  step={0.1}
                  value={gifStartSeconds}
                  minimumTrackTintColor={theme.colors.primary}
                  maximumTrackTintColor={theme.colors.border}
                  thumbTintColor={theme.colors.primary}
                  onSlidingComplete={(value) => {
                    setGifStartSeconds(value);
                    gifPlayer.currentTime = value;
                  }}
                  onValueChange={setGifStartSeconds}
                />
              </View>

              <View style={styles.gifSliderGroup}>
                <View style={styles.gifSliderHeader}>
                  <Text style={[styles.gifInputLabel, { color: theme.colors.muted }]}>{t.gifTrim.duration}</Text>
                  <Text style={[styles.gifValue, { color: theme.colors.text }]}>{formatSeconds(gifDurationSeconds)}</Text>
                </View>
                <Slider
                  minimumValue={0.5}
                  maximumValue={3}
                  step={0.1}
                  value={gifDurationSeconds}
                  minimumTrackTintColor={theme.colors.accent}
                  maximumTrackTintColor={theme.colors.border}
                  thumbTintColor={theme.colors.accent}
                  onValueChange={(value) => {
                    const nextDuration = Math.min(3, Math.max(0.5, value));
                    setGifDurationSeconds(nextDuration);
                    setGifStartSeconds((current) => Math.min(current, Math.max(0, gifVideoDuration - nextDuration)));
                  }}
                />
              </View>

              <View style={[styles.gifHint, { backgroundColor: theme.colors.primarySoft }]}>
                <Text style={[styles.gifHintText, { color: theme.colors.text }]}>
                  {t.gifTrim.range}: {formatSeconds(gifStartSeconds)} - {formatSeconds(gifStartSeconds + gifDurationSeconds)}
                </Text>
                <Text style={[styles.gifHintText, { color: theme.colors.muted }]}>
                  {t.gifTrim.current}: {formatSeconds(gifCurrentSeconds)} / {formatSeconds(gifVideoDuration)}
                </Text>
              </View>

              <View style={styles.gifActions}>
                <TouchableOpacity
                  style={[styles.gifCancelButton, { borderColor: theme.colors.border }]}
                  onPress={() => setGifTrimVisible(false)}
                >
                  <Text style={[styles.gifCancelText, { color: theme.colors.text }]}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.gifConfirmButton, { backgroundColor: theme.colors.primary }]}
                  onPress={confirmGifTrim}
                >
                  <Text style={[styles.gifConfirmText, { color: theme.colors.onPrimary }]}>{t.gifTrim.confirm}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.kicker, { color: theme.colors.muted }]}>File Converter</Text>
            <Text style={[styles.title, { color: theme.colors.text }]}>{t.title}</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              accessibilityLabel={t.toggleLanguage}
              style={[styles.iconButton, { backgroundColor: theme.colors.surface }]}
              onPress={() => setLanguage(language === "en" ? "tr" : "en")}
            >
              <Text style={[styles.langText, { color: theme.colors.text }]}>
                {language.toUpperCase()}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={t.toggleTheme}
              style={[styles.iconButton, { backgroundColor: theme.colors.surface }]}
              onPress={() => setThemeMode(theme.isDark ? "light" : "dark")}
            >
              {theme.isDark ? (
                <Feather name="sun" size={20} color={theme.colors.text} />
              ) : (
                <Feather name="moon" size={20} color={theme.colors.text} />
              )}
            </TouchableOpacity>
          </View>
        </View>
        <AdStatusBanner labels={t} theme={theme} />

        <View style={[styles.tabs, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <TabButton
            active={activeTab === "convert"}
            icon="upload"
            label={t.convertTab}
            theme={theme}
            onPress={() => setActiveTab("convert")}
          />
          <TabButton
            active={activeTab === "archive"}
            icon="archive"
            label={t.archiveTab}
            theme={theme}
            onPress={() => setActiveTab("archive")}
          />
          <TabButton
            active={activeTab === "history"}
            icon="clock"
            label={t.historyTab}
            theme={theme}
            onPress={() => setActiveTab("history")}
          />
          <TabButton
            active={activeTab === "settings"}
            icon="settings"
            label={t.settingsTab}
            theme={theme}
            onPress={() => setActiveTab("settings")}
          />
        </View>

        {activeTab === "convert" ? (
          <View style={styles.section}>
            <ConversionForm
              files={files}
              inputType={inputType}
              outputType={outputType}
              isConverting={isConverting || isWaitingForAd || isPreparingSelection}
              theme={theme}
              labels={t}
              onSelectFiles={selectFiles}
              onRemoveFile={removeFile}
              onRenameFile={openRenameFile}
              onClearFiles={clearFiles}
              onOutputTypeChange={setOutputType}
              onConvert={handleConvertPress}
            />
            {error ? (
              <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
                <Text style={[styles.errorTitle, { color: theme.colors.danger }]}>{t.errorTitle}</Text>
                <Text style={[styles.errorText, { color: theme.colors.text }]}>{error}</Text>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: theme.colors.primary }]}
                  onPress={() => lastJob && runConversion(lastJob)}
                >
                  <Feather name="refresh-cw" size={18} color={theme.colors.primary} />
                  <Text style={[styles.secondaryButtonText, { color: theme.colors.primary }]}>
                    {t.retry}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {isPreparingSelection ? (
              <View style={[styles.prepareBox, { backgroundColor: theme.colors.primarySoft }]}>
                <Feather name="loader" size={17} color={theme.colors.primary} />
                <Text style={[styles.prepareText, { color: theme.colors.text }]}>{t.preparingFile}</Text>
              </View>
            ) : null}
            <ProgressBar progress={progress} theme={theme} label={t.progressLabel} />
          </View>
        ) : activeTab === "archive" ? (
          <ArchiveManager labels={t} theme={theme} />
        ) : activeTab === "history" ? (
          <HistoryList
            history={history}
            theme={theme}
            labels={t}
            onRetry={runConversion}
            onShare={shareOutputs}
            onClear={clearHistory}
            onDelete={deleteHistoryJob}
          />
        ) : (
          <View style={[styles.settingsCard, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.settingsTitle, { color: theme.colors.text }]}>{t.settingsTab}</Text>
            <Text style={[styles.errorText, { color: theme.colors.muted }]}>
              {t.toggleTheme}: {theme.isDark ? "Dark" : "Light"}
            </Text>
            <Text style={[styles.errorText, { color: theme.colors.muted }]}>
              {t.toggleLanguage}: {language.toUpperCase()}
            </Text>
            <View style={styles.trashHeader}>
              <View style={styles.trashTitleRow}>
                <Feather name="trash-2" size={18} color={theme.colors.danger} />
                <Text style={[styles.settingsTitle, { color: theme.colors.text }]}>{t.trashTitle}</Text>
              </View>
              {trash.length > 0 ? (
                <TouchableOpacity
                  style={[styles.trashSmallButton, { backgroundColor: theme.colors.dangerSoft }]}
                  onPress={emptyTrash}
                >
                  <Text style={[styles.trashSmallText, { color: theme.colors.danger }]}>
                    {t.emptyTrash}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {trash.length === 0 ? (
              <Text style={[styles.errorText, { color: theme.colors.muted }]}>{t.trashEmpty}</Text>
            ) : (
              trash.map((job) => (
                <View
                  key={job.id}
                  style={[styles.trashRow, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }]}
                >
                  <View style={styles.trashRowText}>
                    <Text style={[styles.trashName, { color: theme.colors.text }]}>
                      {job.inputType.toUpperCase()} {" -> "} {job.outputType.toUpperCase()}
                    </Text>
                    <Text style={[styles.errorText, { color: theme.colors.muted }]}>
                      {new Date(job.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  {job.outputs?.length ? (
                    <TouchableOpacity
                      style={[styles.trashIconButton, { backgroundColor: theme.colors.primarySoft }]}
                      onPress={() => shareOutputs(job)}
                    >
                      <Feather name="download" size={16} color={theme.colors.primary} />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.trashIconButton, { backgroundColor: theme.colors.accentSoft }]}
                    onPress={() => restoreTrashJob(job)}
                  >
                    <Feather name="rotate-ccw" size={16} color={theme.colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.trashIconButton, { backgroundColor: theme.colors.dangerSoft }]}
                    onPress={() => deleteTrashJobForever(job.id)}
                  >
                    <Feather name="x" size={16} color={theme.colors.danger} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1
  },
  scrollContent: {
    padding: 20,
    gap: 18
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  kicker: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 0,
    marginTop: 4
  },
  headerActions: {
    flexDirection: "row",
    gap: 8
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  langText: {
    fontSize: 13,
    fontWeight: "800"
  },
  tabs: {
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    padding: 6
  },
  tab: {
    alignItems: "center",
    borderRadius: 16,
    flex: 1,
    gap: 4,
    justifyContent: "center",
    minHeight: 56,
    position: "relative"
  },
  tabText: {
    fontSize: 11,
    fontWeight: "900"
  },
  tabIndicator: {
    borderRadius: 999,
    bottom: 5,
    height: 3,
    position: "absolute",
    width: 18
  },
  section: {
    gap: 16
  },
  errorBox: {
    borderRadius: 8,
    gap: 8,
    padding: 14
  },
  prepareBox: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14
  },
  prepareText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800"
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "800"
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20
  },
  secondaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "800"
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.56)",
    flex: 1,
    justifyContent: "center",
    padding: 20
  },
  actionModal: {
    alignItems: "center",
    borderRadius: 18,
    gap: 14,
    maxWidth: 420,
    padding: 18,
    width: "100%"
  },
  actionModalIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  actionModalTitle: {
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center"
  },
  actionModalBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  actionModalButtons: {
    flexDirection: "row",
    gap: 10,
    width: "100%"
  },
  actionCancelButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48
  },
  actionPrimaryButton: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    justifyContent: "center",
    minHeight: 48
  },
  actionCancelText: {
    fontSize: 14,
    fontWeight: "900"
  },
  actionPrimaryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center"
  },
  renameInput: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 12,
    width: "100%"
  },
  gifModal: {
    borderRadius: 18,
    gap: 16,
    maxWidth: 440,
    padding: 18,
    width: "100%"
  },
  gifModalHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  gifModalIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  gifModalTitleWrap: {
    flex: 1
  },
  gifModalTitle: {
    fontSize: 18,
    fontWeight: "900"
  },
  gifModalBody: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3
  },
  gifInputLabel: {
    fontSize: 12,
    fontWeight: "900"
  },
  gifPreview: {
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: "hidden",
    width: "100%"
  },
  gifPreviewActions: {
    flexDirection: "row",
    gap: 10
  },
  gifTimeline: {
    borderRadius: 12,
    height: 72,
    overflow: "hidden",
    position: "relative"
  },
  gifTimelineSegments: {
    flexDirection: "row",
    height: "100%",
    padding: 6
  },
  gifTimelineFrame: {
    alignItems: "center",
    borderRadius: 4,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    marginHorizontal: 1,
    overflow: "hidden"
  },
  gifFrameMark: {
    borderRadius: 999,
    height: 5,
    opacity: 0.9,
    width: 5
  },
  gifFrameImage: {
    height: "100%",
    width: "100%"
  },
  gifTimelineLoading: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.58)",
    bottom: 0,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  gifTimelineLoadingText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900"
  },
  gifTimelineSelection: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 2,
    bottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    minWidth: 30,
    paddingHorizontal: 2,
    position: "absolute",
    top: 4
  },
  gifTrimHandle: {
    borderRadius: 999,
    height: 34,
    width: 5
  },
  gifPlayhead: {
    bottom: 6,
    position: "absolute",
    top: 6,
    width: 2
  },
  gifMiniButton: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 42
  },
  gifMiniButtonText: {
    fontSize: 13,
    fontWeight: "900"
  },
  gifSliderGroup: {
    gap: 4
  },
  gifSliderHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  gifValue: {
    fontSize: 13,
    fontWeight: "900"
  },
  gifHint: {
    borderRadius: 12,
    padding: 12
  },
  gifHintText: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  gifActions: {
    flexDirection: "row",
    gap: 10
  },
  gifCancelButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48
  },
  gifConfirmButton: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    justifyContent: "center",
    minHeight: 48
  },
  gifCancelText: {
    fontSize: 14,
    fontWeight: "900"
  },
  gifConfirmText: {
    fontSize: 14,
    fontWeight: "900"
  },
  settingsCard: {
    borderRadius: 18,
    gap: 8,
    padding: 18
  },
  settingsTitle: {
    fontSize: 20,
    fontWeight: "900"
  },
  trashHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12
  },
  trashTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  trashSmallButton: {
    borderRadius: 8,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  trashSmallText: {
    fontSize: 12,
    fontWeight: "900"
  },
  trashRow: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 60,
    padding: 10
  },
  trashRowText: {
    flex: 1
  },
  trashName: {
    fontSize: 14,
    fontWeight: "900"
  },
  trashIconButton: {
    alignItems: "center",
    borderRadius: 10,
    height: 38,
    justifyContent: "center",
    width: 38
  }
});

function TabButton({
  active,
  icon,
  label,
  theme,
  onPress
}: {
  active: boolean;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  theme: ReturnType<typeof getTheme>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tab, active && { backgroundColor: theme.colors.primarySoft }]}
      onPress={onPress}
    >
      <Feather name={icon} size={18} color={active ? theme.colors.primary : theme.colors.muted} />
      <Text style={[styles.tabText, { color: active ? theme.colors.primary : theme.colors.muted }]}>
        {label}
      </Text>
      {active ? <View style={[styles.tabIndicator, { backgroundColor: theme.colors.primary }]} /> : null}
    </TouchableOpacity>
  );
}

function detectFileType(fileName?: string): FileType | null {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  const supported: FileType[] = [
    "pdf",
    "udf",
    "docx",
    "doc",
    "txt",
    "rtf",
    "odt",
    "xlsx",
    "xls",
    "csv",
    "ods",
    "jpg",
    "png",
    "gif",
    "bmp",
    "webp",
    "mp4",
    "avi",
    "mov",
    "mkv",
    "webm",
    "mp3",
    "wav",
    "ogg",
    "flac",
    "m4a",
    "zip",
    "rar",
    "7z",
    "tar"
  ];
  if (extension === "jpeg") return "jpg";
  return supported.includes(extension as FileType) ? (extension as FileType) : null;
}

function isGifSource(type: FileType | null) {
  return type === "mp4" || type === "mov";
}

function buildSafeDisplayName(nextName: string, originalName: string) {
  const cleanName = nextName.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!cleanName) return "";

  const originalExtension = originalName.includes(".") ? originalName.split(".").pop() : "";
  const nextExtension = cleanName.includes(".") ? cleanName.split(".").pop() : "";
  if (originalExtension && !nextExtension) {
    return `${cleanName}.${originalExtension}`;
  }
  return cleanName;
}

function shouldLimitToSingleFile(type: FileType | null) {
  return (
    type === "mp4" ||
    type === "mov" ||
    type === "avi" ||
    type === "mkv" ||
    type === "webm" ||
    type === "gif" ||
    type === "mp3" ||
    type === "wav" ||
    type === "ogg" ||
    type === "flac" ||
    type === "m4a"
  );
}

function formatSeconds(seconds: number) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${tenths}`;
}

function timelineLeftPercent(seconds: number, duration: number) {
  if (!duration || duration <= 0) return 0;
  return Math.max(0, Math.min(100, (seconds / duration) * 100));
}

function timelineWidthPercent(seconds: number, duration: number) {
  if (!duration || duration <= 0) return 100;
  return Math.max(8, Math.min(100, (seconds / duration) * 100));
}

function detectFileTypeFromFile(file?: AppFile): FileType | null {
  const byName = detectFileType(file?.name);
  if (byName) return byName;

  const mimeType = file?.mimeType?.toLowerCase() ?? "";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return "wav";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}

function localizeConversionError(caught: unknown, labels: typeof translations.en) {
  const message = caught instanceof Error ? caught.message : "";
  if (message.includes("ERR_AD_NOT_REWARDED")) return labels.errors.adNotRewarded;
  if (message.includes("ERR_AD_FAILED")) return labels.errors.adFailed;
  if (message.includes("ERR_FILE_TOO_LARGE")) return labels.errors.fileTooLarge;
  if (message.includes("ERR_TYPE_MISMATCH")) return labels.errors.typeMismatch;
  if (message.includes("ERR_UNSUPPORTED_CONVERSION")) return labels.errors.unsupported;
  if (message.includes("ERR_NATIVE_BUILD_REQUIRED")) return labels.errors.nativeRequired;
  if (message.includes("ERR_FILE_READ_FAILED")) return labels.errors.fileReadFailed;
  if (message.includes("ERR_CONVERSION_FAILED")) return labels.errors.conversionFailed;
  if (message.includes("Network Error") || message.includes("status code 404")) return labels.errors.backendUnavailable;
  if (message.includes("status code 500")) return labels.errors.conversionFailed;
  return message || labels.errors.unknown;
}

function requiresRewardedAd(inputType: FileType, outputType: FileType) {
  const isPdfPremium = inputType === "pdf" && (outputType === "jpg" || outputType === "png" || outputType === "udf");
  const isVideoPremium =
    outputType === "mp3" &&
    (inputType === "mp4" || inputType === "avi" || inputType === "mov" || inputType === "mkv" || inputType === "webm");
  const isGifPremium = isGifSource(inputType) && outputType === "gif";
  return isPdfPremium || isVideoPremium || isGifPremium;
}

function extensionFromGalleryAsset(asset: ImagePicker.ImagePickerAsset) {
  const filenameExtension = asset.fileName?.split(".").pop()?.toLowerCase();
  if (filenameExtension) return filenameExtension === "jpeg" ? "jpg" : filenameExtension;

  const uriExtension = asset.uri.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (uriExtension && uriExtension.length <= 5) return uriExtension === "jpeg" ? "jpg" : uriExtension;

  if (asset.mimeType?.includes("png")) return "png";
  if (asset.mimeType?.includes("webp")) return "webp";
  if (asset.mimeType?.includes("gif")) return "gif";
  if (asset.mimeType?.includes("quicktime")) return "mov";
  if (asset.type === "video") return "mp4";
  return "jpg";
}

function mimeFromGalleryAsset(asset: ImagePicker.ImagePickerAsset, extension: string) {
  if (asset.mimeType) return asset.mimeType;
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "mov") return "video/quicktime";
  if (extension === "mp4") return "video/mp4";
  return asset.type === "video" ? "video/mp4" : "image/jpeg";
}

async function prepareShareUri(output: ConvertedFile) {
  if (!output.uri.startsWith("http://") && !output.uri.startsWith("https://")) {
    return output.uri;
  }

  const shareDirectory = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}shared/`;
  const info = await FileSystem.getInfoAsync(shareDirectory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(shareDirectory, { intermediates: true });
  }

  const safeName = output.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localUri = `${shareDirectory}${safeName}`;
  const existing = await FileSystem.getInfoAsync(localUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
  }
  await FileSystem.downloadAsync(output.uri, localUri);
  return localUri;
}

async function createNativeOutputZip(outputs: ConvertedFile[]): Promise<ConvertedFile> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const output of outputs) {
    const localUri = await prepareShareUri(output);
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64
    });
    zip.file(output.name, base64, { base64: true });
  }

  const zipBase64 = await zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    type: "base64"
  });
  const shareDirectory = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}shared/`;
  const info = await FileSystem.getInfoAsync(shareDirectory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(shareDirectory, { intermediates: true });
  }
  const zipUri = `${shareDirectory}${createShareZipName(outputs)}`;
  await FileSystem.writeAsStringAsync(zipUri, zipBase64, {
    encoding: FileSystem.EncodingType.Base64
  });
  return {
    name: zipUri.split("/").pop() ?? "converted_files.zip",
    uri: zipUri,
    mimeType: "application/zip"
  };
}

async function createWebOutputZip(outputs: ConvertedFile[]): Promise<ConvertedFile> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const output of outputs) {
    const response = await fetch(output.uri);
    if (!response.ok) throw new Error("ERR_FILE_READ_FAILED");
    zip.file(output.name, await response.blob());
  }

  const blob = await zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    type: "blob"
  });
  return {
    name: createShareZipName(outputs),
    uri: URL.createObjectURL(blob),
    mimeType: "application/zip"
  };
}

function createShareZipName(outputs: ConvertedFile[]) {
  const firstName = outputs[0]?.name ?? "converted_files";
  const baseName = firstName
    .replace(/\.[^.]+$/, "")
    .replace(/_page_\d+.*$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+$/, "");
  return `${baseName || "converted_files"}_outputs_${Date.now()}.zip`;
}
