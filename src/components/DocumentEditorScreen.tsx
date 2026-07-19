import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Pdf from "react-native-pdf";
import Svg, { Path } from "react-native-svg";
import { WebView } from "react-native-webview";
import { translations } from "../i18n";
import { motionDuration, motionEasing } from "../motion";
import { DocumentEditLayer, DocumentPreviewSource } from "../services/documentEditorService";
import { AppTheme } from "../theme";
import { AppFile, ConvertedFile } from "../types";
import { AnimatedPressable } from "./ui/AnimatedPressable";
import { InstagramGradient } from "./ui/InstagramGradient";
import { MotionModal } from "./ui/MotionModal";

export type EditorTool = "select" | "pen" | "highlight" | "eraser";

const strokePalette = ["#111827", "#DD2A7B", "#F58529", "#8134AF", "#1E90FF", "#22C55E", "#FFEB3B", "#EF4444", "#A855F7", "#14B8A6"];
const colorFamilies = [
  ["#111827", "#374151", "#6B7280", "#D1D5DB", "#FFFFFF"],
  ["#FDE047", "#FACC15", "#F59E0B", "#F97316", "#EF4444"],
  ["#F9A8D4", "#F472B6", "#DD2A7B", "#BE185D", "#881337"],
  ["#C4B5FD", "#A855F7", "#8134AF", "#6D28D9", "#4C1D95"],
  ["#93C5FD", "#38BDF8", "#1E90FF", "#2563EB", "#1E3A8A"],
  ["#99F6E4", "#14B8A6", "#22C55E", "#16A34A", "#14532D"]
];
const minDocumentZoom = 0.5;
const maxDocumentZoom = 2.6;
const textFontFamilies: Array<{ label: string; value: NonNullable<DocumentEditLayer["fontFamily"]>; family?: string }> = [
  { label: "Sans", value: "sans" },
  { label: "Serif", value: "serif", family: "Times New Roman" },
  { label: "Mono", value: "mono", family: "Menlo" },
  { label: "İmza", value: "script", family: "Snell Roundhand" }
];
type EditorPoint = { x: number; y: number; move?: boolean };

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toUpperCase() : null;
}

function readableColor(hex: string) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return "#111827";
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150 ? "#111827" : "#FFFFFF";
}

type Props = {
  file: AppFile | null;
  previewSource: DocumentPreviewSource | null;
  output: ConvertedFile | null;
  labels: typeof translations.en;
  theme: AppTheme;
  pageCount: number;
  pageNumber: number;
  sourcePageNumber: number | null;
  isBlankPage: boolean;
  blankPageCount: number;
  layers: DocumentEditLayer[];
  selectedLayerId: string | null;
  activeTool: EditorTool;
  strokeColor: string;
  strokeWidth: number;
  savedDrawnSignatures: Array<{ id: string; points: EditorPoint[] }>;
  canUndo: boolean;
  canRedo: boolean;
  isBusy: boolean;
  isReading: boolean;
  speechRate: number;
  speechLanguageLabel: string;
  message: string | null;
  onBack: () => void;
  onPickFile: () => void;
  onPageNumberChange: (value: number) => void;
  onAddBlankPage: () => void;
  onDeletePage: () => void;
  onToolChange: (tool: EditorTool) => void;
  onStrokeColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  onAddText: () => void;
  onAddDrawnSignature: (points: EditorPoint[]) => void;
  onUseSavedDrawnSignature: (points: EditorPoint[]) => void;
  onDeleteSavedDrawnSignature: (id: string) => void;
  onAddImageSignature: () => void;
  onAddQrSignature: () => void;
  onCommitStroke: (points: EditorPoint[], tool: EditorTool) => void;
  onSelectLayer: (id: string) => void;
  onMoveLayer: (id: string, x: number, y: number) => void;
  onResizeLayer: (id: string, width: number, height: number) => void;
  onRotateLayer: (id: string, rotation: number) => void;
  onLayerStyleChange: (
    id: string,
    patch: Partial<Pick<DocumentEditLayer, "backgroundColor" | "fontSize" | "textAlign" | "fontStyle" | "fontWeight" | "fontFamily" | "textDecorationLine">>
  ) => void;
  onDeleteLayer: (id?: string) => void;
  onLayerTextChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReadAloud: () => void;
  onSpeechRateChange: (rate: number) => void;
  onApply: () => void;
  onShare: () => void;
};

export function DocumentEditorScreen(props: Props) {
  const {
    file,
    previewSource,
    output,
    labels,
    theme,
    pageCount,
    pageNumber,
    sourcePageNumber,
    isBlankPage,
    blankPageCount,
    layers,
    selectedLayerId,
    activeTool,
    strokeColor,
    strokeWidth,
    savedDrawnSignatures,
    canUndo,
    canRedo,
    isBusy,
    isReading,
    speechRate,
    speechLanguageLabel,
    message,
    onBack,
    onPickFile,
    onPageNumberChange,
    onAddBlankPage,
    onDeletePage,
    onToolChange,
    onStrokeColorChange,
    onStrokeWidthChange,
    onAddText,
    onAddDrawnSignature,
    onUseSavedDrawnSignature,
    onDeleteSavedDrawnSignature,
    onAddImageSignature,
    onAddQrSignature,
    onCommitStroke,
    onSelectLayer,
    onMoveLayer,
    onResizeLayer,
    onRotateLayer,
    onLayerStyleChange,
    onDeleteLayer,
    onLayerTextChange,
    onUndo,
    onRedo,
    onReadAloud,
    onSpeechRateChange,
    onApply,
    onShare
  } = props;
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 });
  const [draftPoints, setDraftPoints] = useState<EditorPoint[]>([]);
  const [showSignatureMenu, setShowSignatureMenu] = useState(false);
  const [showPageActionMenu, setShowPageActionMenu] = useState(false);
  const [deletePageConfirmVisible, setDeletePageConfirmVisible] = useState(false);
  const [signaturePadVisible, setSignaturePadVisible] = useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);
  const [toolsPanelTab, setToolsPanelTab] = useState<"draw" | "text">("draw");
  const [bottomPanelMode, setBottomPanelMode] = useState<"actions" | "speech">("actions");
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [draftHexColor, setDraftHexColor] = useState(strokeColor);
  const [signaturePadSize, setSignaturePadSize] = useState({ width: 1, height: 1 });
  const [signaturePoints, setSignaturePoints] = useState<EditorPoint[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const screenReveal = useRef(new Animated.Value(0)).current;
  const draftPointsRef = useRef<EditorPoint[]>([]);
  const signaturePointsRef = useRef<EditorPoint[]>([]);
  const startPanRef = useRef({ x: 0, y: 0 });
  const pageRailRef = useRef<ScrollView>(null);
  const activeToolRef = useRef(activeTool);
  const panRef = useRef(pan);
  const surfaceSizeRef = useRef(surfaceSize);
  const zoomRef = useRef(zoom);
  const onCommitStrokeRef = useRef(onCommitStroke);
  const onPageNumberChangeRef = useRef(onPageNumberChange);
  const pageNumberRef = useRef(pageNumber);
  const pageCountRef = useRef(pageCount);
  activeToolRef.current = activeTool;
  panRef.current = pan;
  surfaceSizeRef.current = surfaceSize;
  zoomRef.current = zoom;
  onCommitStrokeRef.current = onCommitStroke;
  onPageNumberChangeRef.current = onPageNumberChange;
  pageNumberRef.current = pageNumber;
  pageCountRef.current = pageCount;
  const { height, width } = useWindowDimensions();
  const isLandscape = width > height;
  const pageRailHeight = Math.min(
    Math.max(1, pageCount) * 33 + 10,
    isLandscape ? Math.max(118, height - 220) : Math.max(190, Math.min(430, height * 0.56))
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const visibleLayers = useMemo(
    () => layers.filter((layer) => layer.page === pageNumber).sort((left, right) => documentLayerVisualWeight(left) - documentLayerVisualWeight(right)),
    [layers, pageNumber]
  );
  const shouldUseNativePdf = Boolean(file && previewSource?.uri && isPdfFile(file));
  const zoomPercent = Math.round(zoom * 100);
  const previewLayoutKey = `${isLandscape ? "landscape" : "portrait"}:${Math.round(surfaceSize.width)}x${Math.round(surfaceSize.height)}`;

  useEffect(() => {
    const animation = Animated.timing(screenReveal, {
      duration: motionDuration.reveal,
      easing: motionEasing.enter,
      toValue: 1,
      useNativeDriver: true
    });
    animation.start();
    return () => animation.stop();
  }, [screenReveal]);

  useEffect(() => {
    if (isLandscape) setToolsPanelOpen(true);
  }, [isLandscape]);

  useEffect(() => {
    if (selectedLayer && isTextLayer(selectedLayer)) setToolsPanelTab("text");
  }, [selectedLayer?.id]);

  useEffect(() => {
    if (
      activeTool !== "select" ||
      toolsPanelOpen ||
      showSignatureMenu ||
      showPageActionMenu ||
      deletePageConfirmVisible ||
      signaturePadVisible ||
      colorModalVisible
    ) {
      setBottomPanelMode("actions");
    }
  }, [activeTool, colorModalVisible, deletePageConfirmVisible, showPageActionMenu, showSignatureMenu, signaturePadVisible, toolsPanelOpen]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [isLandscape, pageNumber, previewSource?.uri]);

  useEffect(() => {
    const timer = setTimeout(() => {
      pageRailRef.current?.scrollTo({
        animated: true,
        y: Math.max(0, (pageNumber - 1) * 33 - 33)
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [isLandscape, pageCount, pageNumber]);

  const documentPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => activeToolRef.current === "select",
        onMoveShouldSetPanResponder: () => activeToolRef.current === "select",
        onPanResponderGrant: () => {
          startPanRef.current = panRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          if (zoomRef.current <= 1.05 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35) return;
          setPan(clampPan(
            { x: startPanRef.current.x + gesture.dx, y: startPanRef.current.y + gesture.dy },
            surfaceSizeRef.current,
            zoomRef.current
          ));
        },
        onPanResponderRelease: (_, gesture) => {
          if (zoomRef.current > 1.05 || Math.abs(gesture.dy) < 42 || Math.abs(gesture.dy) < Math.abs(gesture.dx) * 1.2) return;
          const nextPage = gesture.dy < 0
            ? Math.min(pageCountRef.current, pageNumberRef.current + 1)
            : Math.max(1, pageNumberRef.current - 1);
          if (nextPage !== pageNumberRef.current) onPageNumberChangeRef.current(nextPage);
        },
        onShouldBlockNativeResponder: () => true
      }),
    []
  );

  const drawResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => activeToolRef.current === "pen" || activeToolRef.current === "highlight" || activeToolRef.current === "eraser",
        onMoveShouldSetPanResponder: () => activeToolRef.current === "pen" || activeToolRef.current === "highlight" || activeToolRef.current === "eraser",
        onPanResponderGrant: (event) => {
          const point = normalizePoint(event.nativeEvent.locationX, event.nativeEvent.locationY, surfaceSizeRef.current, panRef.current, zoomRef.current);
          draftPointsRef.current = [point];
          setDraftPoints([point]);
        },
        onPanResponderMove: (event) => {
          const point = normalizePoint(event.nativeEvent.locationX, event.nativeEvent.locationY, surfaceSizeRef.current, panRef.current, zoomRef.current);
          draftPointsRef.current = [...draftPointsRef.current, point];
          setDraftPoints(draftPointsRef.current);
        },
        onPanResponderRelease: () => {
          if (activeToolRef.current === "select") return;
          const points = draftPointsRef.current;
          draftPointsRef.current = [];
          setDraftPoints([]);
          if (points.length > 1) onCommitStrokeRef.current(points, activeToolRef.current);
        },
        onShouldBlockNativeResponder: () => true
      }),
    []
  );

  const signaturePadResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const point = { ...normalizePadPoint(event.nativeEvent.locationX, event.nativeEvent.locationY, signaturePadSize), move: true };
          signaturePointsRef.current = [...signaturePointsRef.current, point];
          setSignaturePoints(signaturePointsRef.current);
        },
        onPanResponderMove: (event) => {
          const point = normalizePadPoint(event.nativeEvent.locationX, event.nativeEvent.locationY, signaturePadSize);
          signaturePointsRef.current = [...signaturePointsRef.current, point];
          setSignaturePoints(signaturePointsRef.current);
        },
        onShouldBlockNativeResponder: () => true
      }),
    [signaturePadSize]
  );

  const closeSignaturePad = () => {
    signaturePointsRef.current = [];
    setSignaturePoints([]);
    setSignaturePadVisible(false);
  };

  const saveSignaturePad = () => {
    const points = signaturePointsRef.current;
    if (points.length < 2) return;
    onAddDrawnSignature(points);
    closeSignaturePad();
  };

  const setZoomLevel = (nextZoom: number) => {
    const safeZoom = Math.max(minDocumentZoom, Math.min(maxDocumentZoom, nextZoom));
    setZoom(safeZoom);
    setPan((current) => clampPan(current, surfaceSize, safeZoom));
  };

  const applyStrokeColor = (color: string) => {
    onStrokeColorChange(color);
    setDraftHexColor(color);
  };

  const applyDraftHexColor = () => {
    const normalized = normalizeHexColor(draftHexColor);
    if (!normalized) return;
    applyStrokeColor(normalized);
    setColorModalVisible(false);
  };

  const selectedTextTools = selectedLayer && isTextLayer(selectedLayer) ? (
    <View style={styles.panelTextTools}>
      <TextInput
        value={selectedLayer.text}
        onChangeText={onLayerTextChange}
        placeholder={labels.documentEditor.layerTextPlaceholder}
        placeholderTextColor={theme.colors.muted}
        multiline
        style={[styles.input, isLandscape && styles.inputLandscape, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }]}
      />
      <View style={styles.textTools}>
        {(["left", "center", "right"] as const).map((align) => (
          <TouchableOpacity
            key={align}
            style={[
              styles.formatButton,
              {
                borderColor: selectedLayer.textAlign === align ? theme.colors.accent : theme.colors.border,
                backgroundColor: selectedLayer.textAlign === align ? theme.colors.accentSoft : theme.colors.surfaceAlt
              }
            ]}
            onPress={() => onLayerStyleChange(selectedLayer.id, { textAlign: align })}
          >
            <Feather name={`align-${align}` as keyof typeof Feather.glyphMap} size={15} color={theme.colors.text} />
          </TouchableOpacity>
        ))}
        {["transparent", "#FFEB3B", "#DD2A7B", "#1E90FF"].map((background) => (
          <TouchableOpacity
            key={background}
            style={[
              styles.backgroundSwatch,
              {
                backgroundColor: background === "transparent" ? theme.colors.surfaceAlt : background,
                borderColor: selectedLayer.backgroundColor === background ? theme.colors.accent : theme.colors.border
              }
            ]}
            onPress={() => onLayerStyleChange(selectedLayer.id, { backgroundColor: background })}
          />
        ))}
        <TouchableOpacity
          style={[
            styles.formatButton,
            {
              borderColor: selectedLayer.fontWeight === "900" || selectedLayer.fontWeight === "700" ? theme.colors.accent : theme.colors.border,
              backgroundColor: selectedLayer.fontWeight === "900" || selectedLayer.fontWeight === "700" ? theme.colors.accentSoft : theme.colors.surfaceAlt
            }
          ]}
          onPress={() => onLayerStyleChange(selectedLayer.id, { fontWeight: selectedLayer.fontWeight === "900" ? "400" : "900" })}
        >
          <Text style={[styles.formatLetter, { color: theme.colors.text, fontWeight: "900" }]}>B</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.formatButton,
            {
              borderColor: selectedLayer.fontStyle === "italic" ? theme.colors.accent : theme.colors.border,
              backgroundColor: selectedLayer.fontStyle === "italic" ? theme.colors.accentSoft : theme.colors.surfaceAlt
            }
          ]}
          onPress={() => onLayerStyleChange(selectedLayer.id, { fontStyle: selectedLayer.fontStyle === "italic" ? "normal" : "italic" })}
        >
          <Text style={[styles.formatLetter, { color: theme.colors.text, fontStyle: "italic" }]}>I</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.formatButton,
            {
              borderColor: selectedLayer.textDecorationLine === "underline" ? theme.colors.accent : theme.colors.border,
              backgroundColor: selectedLayer.textDecorationLine === "underline" ? theme.colors.accentSoft : theme.colors.surfaceAlt
            }
          ]}
          onPress={() => onLayerStyleChange(selectedLayer.id, { textDecorationLine: selectedLayer.textDecorationLine === "underline" ? "none" : "underline" })}
        >
          <Text style={[styles.formatLetter, styles.underlineLetter, { color: theme.colors.text }]}>U</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.formatButton,
            {
              borderColor: selectedLayer.textDecorationLine === "line-through" ? theme.colors.accent : theme.colors.border,
              backgroundColor: selectedLayer.textDecorationLine === "line-through" ? theme.colors.accentSoft : theme.colors.surfaceAlt
            }
          ]}
          onPress={() => onLayerStyleChange(selectedLayer.id, { textDecorationLine: selectedLayer.textDecorationLine === "line-through" ? "none" : "line-through" })}
        >
          <Text style={[styles.formatLetter, styles.strikeLetter, { color: theme.colors.text }]}>S</Text>
        </TouchableOpacity>
        {textFontFamilies.map((font) => (
          <TouchableOpacity
            key={font.value}
            style={[
              styles.fontChip,
              {
                borderColor: selectedLayer.fontFamily === font.value ? theme.colors.accent : theme.colors.border,
                backgroundColor: selectedLayer.fontFamily === font.value ? theme.colors.accentSoft : theme.colors.surfaceAlt
              }
            ]}
            onPress={() => onLayerStyleChange(selectedLayer.id, { fontFamily: font.value })}
          >
            <Text style={[styles.fontChipText, { color: theme.colors.text, fontFamily: font.family }]}>{font.value === "script" ? labels.documentEditor.addSignature : font.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.fontSliderWrap}>
          <Text style={[styles.fontLabel, { color: theme.colors.muted }]}>
            {Math.round(((selectedLayer.fontSize ?? 13) / 13) * 100)}%
          </Text>
          <Slider
            minimumValue={7}
            maximumValue={34}
            step={1}
            value={selectedLayer.fontSize ?? 13}
            minimumTrackTintColor={theme.colors.accent}
            maximumTrackTintColor={theme.colors.border}
            thumbTintColor={theme.colors.accent}
            style={styles.fontSlider}
            onValueChange={(value) => onLayerStyleChange(selectedLayer.id, { fontSize: value })}
          />
        </View>
      </View>
    </View>
  ) : null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background,
          opacity: screenReveal,
          transform: [
            { translateY: screenReveal.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            { scale: screenReveal.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1] }) }
          ]
        }
      ]}
    >
      <View style={[styles.topBar, isLandscape && styles.topBarLandscape, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <TouchableOpacity style={[styles.iconButton, { backgroundColor: theme.colors.surfaceAlt }]} onPress={onBack}>
          <Feather name="x" size={20} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: theme.colors.text }]}>{labels.documentEditor.title}</Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: theme.colors.muted }]}>{file?.name ?? labels.documentEditor.noFile}</Text>
        </View>
        {isLandscape ? (
          <View style={styles.landscapeActionDock}>
            <AnimatedPressable disabled={isBusy || !file} style={styles.landscapeSaveClip} onPress={onApply}>
              <InstagramGradient theme={theme} style={styles.landscapeSaveButton}>
                <Feather name={isBusy ? "loader" : "save"} size={15} color="#fff" />
                <Text style={styles.landscapeSaveText}>{isBusy ? labels.documentEditor.processing : labels.documentEditor.apply}</Text>
              </InstagramGradient>
            </AnimatedPressable>
          </View>
        ) : null}
        <TouchableOpacity
          disabled={pageCount <= 1}
          style={[styles.iconButton, isLandscape && styles.iconButtonLandscape, { backgroundColor: theme.colors.dangerSoft, opacity: pageCount <= 1 ? 0.45 : 1 }]}
          onPress={() => setDeletePageConfirmVisible(true)}
        >
          <Feather name="trash-2" size={18} color={theme.colors.danger} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.iconButton, isLandscape && styles.iconButtonLandscape, { backgroundColor: theme.colors.primarySoft }]} onPress={() => setShowPageActionMenu(true)}>
          <Feather name="file-plus" size={18} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      {showPageActionMenu ? (
        <>
          <TouchableOpacity style={styles.signatureMenuBackdrop} activeOpacity={1} onPress={() => setShowPageActionMenu(false)} />
          <View style={[styles.pageActionMenu, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <TouchableOpacity
              style={[styles.pageActionButton, { backgroundColor: theme.colors.primarySoft }]}
              onPress={() => {
                setShowPageActionMenu(false);
                onPickFile();
              }}
            >
              <Feather name="file-plus" size={16} color={theme.colors.primary} />
              <View style={styles.pageActionTextWrap}>
                <Text style={[styles.pageActionTitle, { color: theme.colors.text }]}>{labels.documentEditor.addFileFromDevice}</Text>
                <Text style={[styles.pageActionSubtitle, { color: theme.colors.muted }]}>{labels.documentEditor.chooseNewDocument}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={pageCount >= 10}
              style={[styles.pageActionButton, { backgroundColor: theme.colors.accentSoft, opacity: pageCount >= 10 ? 0.45 : 1 }]}
              onPress={() => {
                setShowPageActionMenu(false);
                onAddBlankPage();
              }}
            >
              <Feather name="plus-square" size={16} color={theme.colors.accent} />
              <View style={styles.pageActionTextWrap}>
                <Text style={[styles.pageActionTitle, { color: theme.colors.text }]}>{labels.documentEditor.addBlankPage}</Text>
                <Text style={[styles.pageActionSubtitle, { color: theme.colors.muted }]}>{pageCount}/10 {labels.documentEditor.totalPages}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      <View style={[styles.toolBar, isLandscape && styles.toolBarLandscape, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <ToolButton compact={isLandscape} active={activeTool === "select"} icon="mouse-pointer" label={labels.documentEditor.selectTool} theme={theme} onPress={() => onToolChange("select")} />
        <ToolButton
          compact={isLandscape}
          active={activeTool === "pen" || activeTool === "highlight" || activeTool === "eraser"}
          icon="edit-3"
          label={labels.documentEditor.penTool}
          theme={theme}
          onPress={() => {
            onToolChange(activeTool === "highlight" || activeTool === "eraser" ? activeTool : "pen");
            setToolsPanelOpen(true);
            setToolsPanelTab("draw");
          }}
        />
        <TouchableOpacity
          style={[styles.compactButton, { backgroundColor: theme.colors.primarySoft }]}
          onPress={() => {
            onAddText();
            setToolsPanelOpen(true);
            setToolsPanelTab("text");
          }}
        >
          <Text style={[styles.compactText, { color: theme.colors.primary }]}>T</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.compactButton, { backgroundColor: theme.colors.accentSoft }]} onPress={() => setShowSignatureMenu((current) => !current)}>
          <Text style={[styles.compactText, { color: theme.colors.accent }]}>{labels.documentEditor.signatureShort}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.compactButton, { backgroundColor: toolsPanelOpen ? theme.colors.accentSoft : theme.colors.surfaceAlt }]} onPress={() => setToolsPanelOpen((current) => !current)}>
          <Feather name="sliders" size={16} color={toolsPanelOpen ? theme.colors.accent : theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!canUndo}
          style={[styles.compactButton, styles.historyButton, { backgroundColor: theme.colors.surfaceAlt, opacity: canUndo ? 1 : 0.35 }]}
          onPress={onUndo}
        >
          <Feather name="rotate-ccw" size={16} color={theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!canRedo}
          style={[styles.compactButton, styles.historyButton, { backgroundColor: theme.colors.surfaceAlt, opacity: canRedo ? 1 : 0.35 }]}
          onPress={onRedo}
        >
          <Feather name="rotate-cw" size={16} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      {showSignatureMenu ? (
        <>
          <TouchableOpacity style={styles.signatureMenuBackdrop} activeOpacity={1} onPress={() => setShowSignatureMenu(false)} />
          <View style={[styles.signatureMenu, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <TouchableOpacity
              style={[styles.signatureMenuButton, { backgroundColor: theme.colors.primarySoft }]}
              onPress={() => {
                setShowSignatureMenu(false);
                setSignaturePadVisible(true);
              }}
            >
              <Feather name="edit-3" size={15} color={theme.colors.primary} />
              <Text style={[styles.signatureMenuText, { color: theme.colors.text }]}>{labels.documentEditor.writtenSignature}</Text>
            </TouchableOpacity>
            {savedDrawnSignatures.length > 0 ? (
              <View style={styles.savedSignatureBlock}>
                <Text style={[styles.savedSignatureTitle, { color: theme.colors.muted }]}>{labels.documentEditor.savedSignatures}</Text>
                <View style={styles.savedSignatureRow}>
                  {savedDrawnSignatures.map((signature, index) => (
                    <TouchableOpacity
                      key={signature.id}
                      style={[styles.savedSignatureThumb, { backgroundColor: "#fff", borderColor: theme.colors.border }]}
                      onPress={() => {
                        setShowSignatureMenu(false);
                        onUseSavedDrawnSignature(signature.points);
                      }}
                    >
                      <StrokeView points={signature.points} color="#111827" width={3} opacity={1} />
                      <Text style={styles.savedSignatureIndex}>{index + 1}</Text>
                      <TouchableOpacity
                        style={[styles.savedSignatureDelete, { backgroundColor: theme.colors.dangerSoft }]}
                        onPress={() => onDeleteSavedDrawnSignature(signature.id)}
                      >
                        <Feather name="x" size={10} color={theme.colors.danger} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.signatureMenuButton, { backgroundColor: theme.colors.accentSoft }]}
              onPress={() => {
                setShowSignatureMenu(false);
                onAddImageSignature();
              }}
            >
              <Feather name="image" size={15} color={theme.colors.accent} />
              <Text style={[styles.signatureMenuText, { color: theme.colors.text }]}>{labels.documentEditor.chooseFromDevice}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.signatureMenuButton, { backgroundColor: theme.colors.surfaceAlt }]}
              onPress={() => {
                setShowSignatureMenu(false);
                onAddQrSignature();
              }}
            >
              <Feather name="grid" size={15} color={theme.colors.text} />
              <Text style={[styles.signatureMenuText, { color: theme.colors.text }]}>{labels.documentEditor.chooseQrImage}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      <View style={styles.viewerArea}>
        {message ? (
          <View style={[styles.editorToast, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text numberOfLines={1} style={[styles.editorToastText, { color: theme.colors.muted }]}>{message}</Text>
          </View>
        ) : null}
        <ScrollView
          ref={pageRailRef}
          nestedScrollEnabled
          style={[
            styles.pageRail,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, height: pageRailHeight }
          ]}
          contentContainerStyle={styles.pageRailContent}
          showsVerticalScrollIndicator={pageCount > 6}
          persistentScrollbar={pageCount > 6}
        >
          {Array.from({ length: Math.max(1, pageCount) }, (_, index) => {
            const value = index + 1;
            const active = value === pageNumber;
            return (
              <TouchableOpacity
                key={value}
                style={[styles.pageRailItem, { backgroundColor: active ? theme.colors.accentSoft : theme.colors.surfaceAlt }]}
                onPress={() => onPageNumberChange(value)}
              >
                <Text style={[styles.pageRailText, { color: active ? theme.colors.accent : theme.colors.muted }]}>{value}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={[styles.zoomDock, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <TouchableOpacity style={styles.zoomButton} onPress={() => setZoomLevel(zoom - 0.15)}>
            <Feather name="minus" size={15} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomPercentButton} onPress={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}>
            <Text style={[styles.zoomPercent, { color: theme.colors.text }]}>{zoomPercent}%</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomButton} onPress={() => setZoomLevel(zoom + 0.15)}>
            <Feather name="plus" size={15} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
        <View
          style={[styles.previewSurface, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
          onLayout={(event) => setSurfaceSize(event.nativeEvent.layout)}
          {...drawResponder.panHandlers}
        >
          <View style={[styles.previewContent, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: zoom }] }]}>
            {isBlankPage ? (
              <View pointerEvents="none" style={styles.blankPagePreview}>
                <Text style={[styles.blankPageText, { color: theme.colors.muted }]}>{labels.documentEditor.blankPage}</Text>
              </View>
            ) : shouldUseNativePdf && previewSource?.uri ? (
              <View pointerEvents="none" style={styles.nativePreviewShell}>
                <Pdf
                  key={`${previewSource.uri}:${sourcePageNumber ?? pageNumber}:${previewLayoutKey}`}
                  source={{ uri: previewSource.uri }}
                  page={sourcePageNumber ?? pageNumber}
                  singlePage
                  scrollEnabled={false}
                  enablePaging={false}
                  fitPolicy={2}
                  spacing={0}
                  trustAllCerts={false}
                  enableAnnotationRendering
                  style={styles.nativePdfPreview}
                  onError={(error) => {
                    console.warn("Native PDF preview failed", error);
                  }}
                />
              </View>
            ) : file ? (
              <WebView
                key={`${file.uri}:${previewSource?.html ? "html" : "uri"}:${previewLayoutKey}`}
                originWhitelist={["*"]}
                source={previewSource?.html ? { html: previewSource.html, baseUrl: "" } : { uri: previewSource?.uri ?? file.uri }}
                style={styles.webPreview}
                startInLoadingState
                javaScriptEnabled
                scrollEnabled={false}
                pointerEvents="none"
                allowFileAccess
                allowFileAccessFromFileURLs
                allowingReadAccessToURL={previewSource?.allowingReadAccessToURL}
                allowUniversalAccessFromFileURLs
              />
            ) : null}
            {activeTool === "select" ? <View style={styles.panOverlay} {...documentPanResponder.panHandlers} /> : null}
            <View pointerEvents="box-none" style={styles.layerCanvas}>
              {visibleLayers.map((layer) => (
                <LayerView
                  key={layer.id}
                  layer={layer}
                  selected={layer.id === selectedLayerId}
                  theme={theme}
                  surfaceSize={surfaceSize}
                  zoom={zoom}
                  onSelect={() => onSelectLayer(layer.id)}
                  onMove={(x, y) => onMoveLayer(layer.id, x, y)}
                  onResize={(layerWidth, layerHeight) => onResizeLayer(layer.id, layerWidth, layerHeight)}
                  onRotate={(rotation) => onRotateLayer(layer.id, rotation)}
                  onEditText={() => {
                    onSelectLayer(layer.id);
                    setToolsPanelOpen(true);
                    setToolsPanelTab("text");
                  }}
                  onDelete={() => onDeleteLayer(layer.id)}
                />
              ))}
              <StrokeView
                points={draftPoints}
                color={activeTool === "eraser" ? theme.colors.danger : strokeColor}
                width={activeTool === "highlight" ? 14 : activeTool === "eraser" ? Math.max(8, strokeWidth * 2) : strokeWidth}
                opacity={activeTool === "highlight" ? 0.38 : activeTool === "eraser" ? 0.42 : 1}
              />
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.bottomPanel, isLandscape && styles.bottomPanelLandscape, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        {bottomPanelMode === "speech" ? (
          <View style={styles.speechPanel}>
            <View style={styles.speechPanelHeader}>
              <View style={styles.speechPanelTitleWrap}>
                <Feather name={isReading ? "volume-x" : "volume-2"} size={16} color={isReading ? theme.colors.primary : theme.colors.text} />
                <Text style={[styles.speechPanelTitle, { color: theme.colors.text }]}>{isReading ? labels.documentEditor.speechReading : labels.documentEditor.speechTitle}</Text>
              </View>
              <TouchableOpacity style={[styles.speechPanelClose, { backgroundColor: theme.colors.surfaceAlt }]} onPress={() => setBottomPanelMode("actions")}>
                <Feather name="x" size={14} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.speechRateRow}>
              <Text style={[styles.speechRateLabel, { color: theme.colors.muted }]}>{labels.documentEditor.speechRate}</Text>
              <Slider
                minimumValue={0.55}
                maximumValue={2}
                step={0.05}
                value={speechRate}
                minimumTrackTintColor={theme.colors.accent}
                maximumTrackTintColor={theme.colors.border}
                thumbTintColor={theme.colors.accent}
                style={styles.speechRateSlider}
                onValueChange={onSpeechRateChange}
              />
              <Text style={[styles.speechRateValue, { color: theme.colors.text }]}>{speechRate.toFixed(2)}x</Text>
            </View>
            <TouchableOpacity
              style={[styles.speechMainButton, { backgroundColor: isReading ? theme.colors.dangerSoft : theme.colors.primarySoft, borderColor: isReading ? theme.colors.danger : theme.colors.primary }]}
              onPress={onReadAloud}
            >
              <Feather name={isReading ? "square" : "play"} size={15} color={isReading ? theme.colors.danger : theme.colors.primary} />
              <Text style={[styles.speechMainText, { color: isReading ? theme.colors.danger : theme.colors.primary }]}>{isReading ? labels.documentEditor.speechStop : labels.documentEditor.speechRead}</Text>
            </TouchableOpacity>
            <Text style={[styles.speechLanguageText, { color: theme.colors.muted }]}>
              {labels.documentEditor.speechLanguage}: {speechLanguageLabel}
            </Text>
          </View>
        ) : null}
        <View style={styles.bottomActionBar}>
          <View style={styles.bottomActionSpacer} />
          <AnimatedPressable disabled={isBusy || !file} style={styles.saveButtonClip} onPress={onApply}>
            <InstagramGradient theme={theme} style={styles.saveButton}>
              <Feather name={isBusy ? "loader" : "save"} size={17} color="#fff" />
              <Text style={styles.saveText}>{isBusy ? labels.documentEditor.processing : labels.documentEditor.apply}</Text>
            </InstagramGradient>
          </AnimatedPressable>
          <TouchableOpacity
            style={[styles.voiceActionButton, isReading && { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]}
            onPress={() => {
              if (isReading) {
                onReadAloud();
                setBottomPanelMode("actions");
                return;
              }
              setBottomPanelMode("speech");
              onReadAloud();
            }}
          >
            <Feather name={isReading ? "volume-x" : "volume-2"} size={18} color={isReading ? theme.colors.primary : theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>
      {toolsPanelOpen ? (
        <>
          <TouchableOpacity style={styles.toolsPanelBackdrop} activeOpacity={1} onPress={() => setToolsPanelOpen(false)} />
          <View
            style={[
              styles.toolsPanel,
              isLandscape ? styles.toolsPanelLandscape : styles.toolsPanelPortrait,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }
            ]}
          >
            <View style={styles.toolsPanelHeader}>
              <Text style={[styles.toolsPanelTitle, { color: theme.colors.text }]}>{labels.documentEditor.tools}</Text>
              <TouchableOpacity style={[styles.toolsPanelClose, { backgroundColor: theme.colors.surfaceAlt }]} onPress={() => setToolsPanelOpen(false)}>
                <Feather name="x" size={15} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            <View style={[styles.toolsPanelTabs, { backgroundColor: theme.colors.surfaceAlt }]}>
              <TouchableOpacity
                style={[styles.toolsPanelTab, toolsPanelTab === "draw" && { backgroundColor: theme.colors.accentSoft }]}
                onPress={() => {
                  setToolsPanelTab("draw");
                  onToolChange("pen");
                }}
              >
                <Feather name="edit-3" size={14} color={toolsPanelTab === "draw" ? theme.colors.accent : theme.colors.muted} />
                <Text style={[styles.toolsPanelTabText, { color: toolsPanelTab === "draw" ? theme.colors.accent : theme.colors.muted }]}>{labels.documentEditor.draw}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolsPanelTab, toolsPanelTab === "text" && { backgroundColor: theme.colors.accentSoft }]}
                onPress={() => setToolsPanelTab("text")}
              >
                <Feather name="type" size={14} color={toolsPanelTab === "text" ? theme.colors.accent : theme.colors.muted} />
                <Text style={[styles.toolsPanelTabText, { color: toolsPanelTab === "text" ? theme.colors.accent : theme.colors.muted }]}>{labels.documentEditor.text}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.toolsPanelScroll}>
              {toolsPanelTab === "draw" ? <View style={styles.toolsSection}>
                <Text style={[styles.toolsSectionTitle, { color: theme.colors.muted }]}>{activeTool === "eraser" ? labels.documentEditor.eraser : labels.documentEditor.draw}</Text>
                <View style={[styles.drawModeRow, { backgroundColor: theme.colors.surfaceAlt }]}>
                  {([
                    { tool: "pen", icon: "edit-3", label: labels.documentEditor.penTool },
                    { tool: "highlight", icon: "edit", label: labels.documentEditor.highlight },
                    { tool: "eraser", icon: "eraser", label: labels.documentEditor.eraser }
                  ] as Array<{ tool: EditorTool; icon: keyof typeof Feather.glyphMap | "eraser"; label: string }>).map((item) => (
                    <TouchableOpacity
                      key={item.tool}
                      style={[styles.drawModeButton, activeTool === item.tool && { backgroundColor: theme.colors.accentSoft }]}
                      onPress={() => onToolChange(item.tool)}
                    >
                      {item.tool === "eraser" ? (
                        <MaterialCommunityIcons name="eraser" size={16} color={activeTool === item.tool ? theme.colors.accent : theme.colors.muted} />
                      ) : (
                        <Feather name={item.icon as keyof typeof Feather.glyphMap} size={14} color={activeTool === item.tool ? theme.colors.accent : theme.colors.muted} />
                      )}
                      <Text style={[styles.drawModeText, { color: activeTool === item.tool ? theme.colors.accent : theme.colors.muted }]}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {activeTool !== "eraser" ? (
                  <TouchableOpacity
                    style={[styles.colorPickerButton, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
                    onPress={() => {
                      setDraftHexColor(strokeColor);
                      setColorModalVisible(true);
                    }}
                  >
                    <View style={[styles.colorPickerPreview, { backgroundColor: strokeColor, borderColor: theme.colors.border }]} />
                    <View style={styles.colorPickerTextWrap}>
                      <Text style={[styles.colorPickerTitle, { color: theme.colors.text }]}>{activeTool === "highlight" ? labels.documentEditor.highlightColor : labels.documentEditor.penColor}</Text>
                      <Text style={[styles.colorPickerValue, { color: theme.colors.muted }]}>{strokeColor.toUpperCase()}</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={theme.colors.muted} />
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.eraserNotice, { backgroundColor: theme.colors.surfaceAlt }]}>
                    <MaterialCommunityIcons name="eraser" size={17} color={theme.colors.danger} />
                    <Text style={[styles.eraserNoticeText, { color: theme.colors.muted }]}>{labels.documentEditor.eraserNotice}</Text>
                  </View>
                )}
                <View style={styles.widthSliderWrap}>
                  <View style={[
                    styles.widthPreview,
                    activeTool === "eraser" && styles.eraserWidthPreview,
                    {
                      height: activeTool === "eraser" ? Math.max(8, strokeWidth * 2) : strokeWidth,
                      backgroundColor: activeTool === "eraser" ? theme.colors.danger : strokeColor,
                      borderColor: theme.colors.border
                    }
                  ]} />
                  <Slider
                    minimumValue={1}
                    maximumValue={18}
                    step={1}
                    value={strokeWidth}
                    minimumTrackTintColor={theme.colors.accent}
                    maximumTrackTintColor={theme.colors.border}
                    thumbTintColor={theme.colors.accent}
                    style={styles.widthSlider}
                    onValueChange={onStrokeWidthChange}
                  />
                </View>
              </View> : null}
              {toolsPanelTab === "text" && selectedTextTools ? (
                <View style={styles.toolsSection}>
                  <Text style={[styles.toolsSectionTitle, { color: theme.colors.muted }]}>{labels.documentEditor.textSignature}</Text>
                  {selectedTextTools}
                </View>
              ) : null}
              {toolsPanelTab === "text" && !selectedTextTools ? (
                <View style={[styles.emptyToolState, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <Feather name="mouse-pointer" size={16} color={theme.colors.muted} />
                  <Text style={[styles.emptyToolText, { color: theme.colors.muted }]}>{labels.documentEditor.emptyTextTools}</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </>
      ) : null}
      <MotionModal
        visible={signaturePadVisible}
        transparent={false}
        variant="fullscreen"
        supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={closeSignaturePad}
      >
        <View style={[styles.signaturePadScreen, isLandscape && styles.signaturePadScreenLandscape, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.signaturePadHeader, isLandscape && styles.signaturePadHeaderLandscape, { borderColor: theme.colors.border }]}>
            <TouchableOpacity style={[styles.iconButton, { backgroundColor: theme.colors.surfaceAlt }]} onPress={closeSignaturePad}>
              <Feather name="x" size={20} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={styles.titleWrap}>
              <Text style={[styles.title, { color: theme.colors.text }]}>{labels.documentEditor.createSignature}</Text>
              <Text style={[styles.subtitle, { color: theme.colors.muted }]}>{labels.documentEditor.signatureDrawHint}</Text>
            </View>
            <TouchableOpacity style={[styles.redrawButton, { backgroundColor: theme.colors.dangerSoft }]} onPress={() => {
              signaturePointsRef.current = [];
              setSignaturePoints([]);
            }}>
              <Feather name="trash-2" size={18} color={theme.colors.danger} />
              <Text style={[styles.redrawText, { color: theme.colors.danger }]}>{labels.documentEditor.redraw}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.signaturePadBody, isLandscape && styles.signaturePadBodyLandscape]}>
            <View
              style={[styles.signaturePad, isLandscape && styles.signaturePadLandscape, { backgroundColor: "#fff", borderColor: theme.colors.border }]}
              onLayout={(event) => setSignaturePadSize(event.nativeEvent.layout)}
              {...signaturePadResponder.panHandlers}
            >
              <StrokeView points={signaturePoints} color="#111827" width={4} opacity={1} />
            </View>
            <AnimatedPressable disabled={signaturePoints.length < 2} style={[styles.signatureSaveClip, isLandscape && styles.signatureSaveClipLandscape, { opacity: signaturePoints.length > 1 ? 1 : 0.45 }]} onPress={saveSignaturePad}>
              <InstagramGradient theme={theme} style={styles.signatureSaveButton}>
                <Feather name="check" size={18} color="#fff" />
                <Text style={styles.saveText}>{labels.documentEditor.addSignatureToPdf}</Text>
              </InstagramGradient>
            </AnimatedPressable>
          </View>
        </View>
      </MotionModal>
      <MotionModal
        transparent
        variant="dialog"
        visible={deletePageConfirmVisible}
        supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => setDeletePageConfirmVisible(false)}
      >
        <View style={styles.colorModalOverlay}>
          <View style={[styles.confirmModal, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={[styles.confirmIcon, { backgroundColor: theme.colors.dangerSoft }]}>
              <Feather name="trash-2" size={21} color={theme.colors.danger} />
            </View>
            <Text style={[styles.confirmTitle, { color: theme.colors.text }]}>{labels.documentEditor.deletePageTitle}</Text>
            <Text style={[styles.confirmBody, { color: theme.colors.muted }]}>
              {labels.documentEditor.deletePageBody.replace("{page}", String(pageNumber))}
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmCancel, { borderColor: theme.colors.border }]} onPress={() => setDeletePageConfirmVisible(false)}>
                <Text style={[styles.confirmCancelText, { color: theme.colors.text }]}>{labels.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDelete, { backgroundColor: theme.colors.dangerSoft }]}
                onPress={() => {
                  setDeletePageConfirmVisible(false);
                  onDeletePage();
                }}
              >
                <Text style={[styles.confirmDeleteText, { color: theme.colors.danger }]}>{labels.removeFile}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </MotionModal>
      <MotionModal
        transparent
        variant="dialog"
        visible={colorModalVisible}
        supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={() => setColorModalVisible(false)}
      >
        <View style={styles.colorModalOverlay}>
          <View style={[styles.colorModal, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={styles.colorModalHeader}>
              <View style={[styles.colorModalIcon, { backgroundColor: strokeColor }]} />
              <View style={styles.titleWrap}>
                <Text style={[styles.colorModalTitle, { color: theme.colors.text }]}>{labels.documentEditor.colorTitle}</Text>
                <Text style={[styles.colorModalSubtitle, { color: theme.colors.muted }]}>{labels.documentEditor.colorSubtitle}</Text>
              </View>
              <TouchableOpacity style={[styles.toolsPanelClose, { backgroundColor: theme.colors.surfaceAlt }]} onPress={() => setColorModalVisible(false)}>
                <Feather name="x" size={15} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.colorFamilyList}>
              {colorFamilies.map((family, familyIndex) => (
                <View key={familyIndex} style={styles.colorFamilyRow}>
                  {family.map((color) => (
                    <TouchableOpacity
                      key={color}
                      style={[
                        styles.colorModalSwatch,
                        {
                          backgroundColor: color,
                          borderColor: strokeColor.toLowerCase() === color.toLowerCase() ? theme.colors.accent : theme.colors.border
                        }
                      ]}
                      onPress={() => applyStrokeColor(color)}
                    >
                      {strokeColor.toLowerCase() === color.toLowerCase() ? <Feather name="check" size={14} color={readableColor(color)} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </View>
            <View style={styles.hexRow}>
              <TextInput
                value={draftHexColor}
                onChangeText={setDraftHexColor}
                autoCapitalize="characters"
                placeholder="#DD2A7B"
                placeholderTextColor={theme.colors.muted}
                style={[styles.hexInput, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, color: theme.colors.text }]}
              />
              <TouchableOpacity style={styles.hexApplyClip} onPress={applyDraftHexColor}>
                <InstagramGradient theme={theme} style={styles.hexApplyButton}>
                  <Text style={styles.hexApplyText}>{labels.documentEditor.applyColor}</Text>
                </InstagramGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </MotionModal>
    </Animated.View>
  );
}

function ToolButton({
  active,
  compact,
  icon,
  label,
  theme,
  onPress
}: {
  active: boolean;
  compact?: boolean;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  theme: AppTheme;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.toolButton, compact && styles.toolButtonCompact, active && { backgroundColor: theme.colors.primarySoft }]} onPress={onPress}>
      <Feather name={icon} size={compact ? 15 : 16} color={active ? theme.colors.primary : theme.colors.muted} />
      {compact ? null : <Text style={[styles.toolText, { color: active ? theme.colors.primary : theme.colors.muted }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

function LayerView({
  layer,
  selected,
  theme,
  surfaceSize,
  zoom,
  onSelect,
  onMove,
  onResize,
  onRotate,
  onEditText,
  onDelete
}: {
  layer: DocumentEditLayer;
  selected: boolean;
  theme: AppTheme;
  surfaceSize: { width: number; height: number };
  zoom: number;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onRotate: (rotation: number) => void;
  onEditText: () => void;
  onDelete: () => void;
}) {
  const startPosition = useRef({ x: layer.x, y: layer.y });
  const startSize = useRef({ width: layer.width, height: layer.height });
  const startRotation = useRef(layer.rotation ?? 0);
  const layerRef = useRef(layer);
  const surfaceSizeRef = useRef(surfaceSize);
  const zoomRef = useRef(zoom);
  const onSelectRef = useRef(onSelect);
  const onMoveRef = useRef(onMove);
  const onResizeRef = useRef(onResize);
  const onRotateRef = useRef(onRotate);
  const onEditTextRef = useRef(onEditText);
  const onDeleteRef = useRef(onDelete);
  layerRef.current = layer;
  surfaceSizeRef.current = surfaceSize;
  zoomRef.current = zoom;
  onSelectRef.current = onSelect;
  onMoveRef.current = onMove;
  onResizeRef.current = onResize;
  onRotateRef.current = onRotate;
  onEditTextRef.current = onEditText;
  onDeleteRef.current = onDelete;
  const editableLayer = layer.type === "text" || layer.type === "typedSignature";
  const layerMetrics = getLayerMetrics(layer, surfaceSize);
  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderGrant: () => {
          const currentLayer = layerRef.current;
          startPosition.current = { x: currentLayer.x, y: currentLayer.y };
          onSelectRef.current();
        },
        onPanResponderMove: (_, gesture) => {
          const currentLayer = layerRef.current;
          const currentSize = surfaceSizeRef.current;
          const currentZoom = zoomRef.current;
          const metrics = getLayerMetrics(currentLayer, currentSize);
          const nextX = clampLayerPosition(startPosition.current.x + gesture.dx / Math.max(1, currentSize.width * Math.max(minDocumentZoom, currentZoom)), metrics.width / Math.max(1, currentSize.width));
          const nextY = clampLayerPosition(startPosition.current.y + gesture.dy / Math.max(1, currentSize.height * Math.max(minDocumentZoom, currentZoom)), metrics.height / Math.max(1, currentSize.height));
          onMoveRef.current(nextX, nextY);
        },
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) <= 2 && Math.abs(gesture.dy) <= 2 && (layerRef.current.type === "text" || layerRef.current.type === "typedSignature")) {
            onEditTextRef.current();
            return;
          }
          onSelectRef.current();
        },
        onShouldBlockNativeResponder: () => true
      }),
    []
  );
  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          const currentLayer = layerRef.current;
          startSize.current = { width: currentLayer.width, height: currentLayer.height };
          onSelectRef.current();
        },
        onPanResponderMove: (_, gesture) => {
          const currentLayer = layerRef.current;
          const currentSize = surfaceSizeRef.current;
          const currentZoom = zoomRef.current;
          const referenceSize = getLayerReferenceSize(currentSize);
          const maxWidth = ((0.98 - currentLayer.x) * currentSize.width) / Math.max(1, referenceSize);
          const maxHeight = ((0.98 - currentLayer.y) * currentSize.height) / Math.max(1, referenceSize);
          const nextWidth = Math.max(0.16, Math.min(maxWidth, startSize.current.width + gesture.dx / Math.max(1, referenceSize * Math.max(minDocumentZoom, currentZoom))));
          const nextHeight = Math.max(0.07, Math.min(maxHeight, startSize.current.height + gesture.dy / Math.max(1, referenceSize * Math.max(minDocumentZoom, currentZoom))));
          onResizeRef.current(nextWidth, nextHeight);
        },
        onShouldBlockNativeResponder: () => true
      }),
    []
  );
  const rotateResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          startRotation.current = layerRef.current.rotation ?? 0;
          onSelectRef.current();
        },
        onPanResponderMove: (_, gesture) => {
          const nextRotation = normalizeRotation(startRotation.current + gesture.dx * 0.9 + gesture.dy * 0.35);
          onRotateRef.current(nextRotation);
        },
        onShouldBlockNativeResponder: () => true
      }),
    []
  );
  const frameColor = theme.isDark ? "rgba(10,132,255,0.92)" : "rgba(38,38,38,0.52)";

  if (layer.type === "pen" || layer.type === "highlight") {
    return (
      <View pointerEvents="none" style={styles.strokeHitbox}>
        <StrokeView
          points={layer.points ?? []}
          color={layer.color ?? (layer.type === "highlight" ? "#FFEB3B" : "#111827")}
          width={layer.lineWidth ?? (layer.type === "highlight" ? 14 : 3)}
          opacity={layer.type === "highlight" ? 0.38 : 1}
        />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.layerBox,
        {
          left: layerMetrics.left,
          top: layerMetrics.top,
          width: layerMetrics.width,
          height: layerMetrics.height,
          borderColor: selected ? frameColor : "transparent",
          borderStyle: "solid",
          borderWidth: selected ? 1 : 0,
          backgroundColor: layer.backgroundColor && layer.backgroundColor !== "transparent" ? layer.backgroundColor : "rgba(255,255,255,0.01)",
          transform: [{ rotate: `${layer.rotation ?? 0}deg` }]
        }
      ]}
    >
      <View {...dragResponder.panHandlers} style={styles.layerDragSurface}>
        {layer.type === "redaction" ? (
          <View pointerEvents="none" style={styles.redactionLayer} />
        ) : layer.type === "qrSignature" && layer.imageUri ? (
          <Image pointerEvents="none" source={{ uri: layer.imageUri }} style={styles.signatureImage} contentFit="contain" />
        ) : layer.type === "qrSignature" ? (
          <QrVisual value={layer.text} color="#111827" />
        ) : layer.type === "inkSignature" ? (
          <View pointerEvents="none" style={styles.signatureInkLayer}>
            <StrokeView points={layer.points ?? []} color={layer.color ?? "#111827"} width={layer.lineWidth ?? 3} opacity={1} />
          </View>
        ) : layer.type === "imageSignature" && layer.imageUri ? (
          <Image pointerEvents="none" source={{ uri: layer.imageUri }} style={styles.signatureImage} contentFit="contain" />
        ) : (
          <Text
            pointerEvents="none"
            adjustsFontSizeToFit
            minimumFontScale={0.55}
            style={[
              layer.type === "typedSignature" ? styles.signatureText : styles.layerText,
              {
                fontSize: layer.fontSize ?? (layer.type === "typedSignature" ? 18 : 13),
                textAlign: layer.textAlign ?? "center",
                fontStyle: layer.fontStyle ?? (layer.type === "typedSignature" ? "italic" : "normal"),
                fontWeight: layer.fontWeight ?? (layer.type === "typedSignature" ? "900" : "800"),
                textDecorationLine: layer.textDecorationLine ?? "none",
                fontFamily: fontFamilyForLayer(layer)
              }
            ]}
          >
            {layer.text}
          </Text>
        )}
      </View>
      {selected ? (
        <>
          <TouchableOpacity
            activeOpacity={0.82}
            style={[
              styles.deleteHandle,
              {
                backgroundColor: theme.isDark ? "rgba(20,20,20,0.84)" : "rgba(255,255,255,0.92)",
                borderColor: theme.isDark ? "rgba(255,255,255,0.18)" : "rgba(38,38,38,0.12)"
              }
            ]}
            onPress={() => {
              onSelectRef.current();
              onDeleteRef.current();
            }}
          >
            <Feather name="x" size={10} color={theme.colors.text} />
          </TouchableOpacity>
          <View
            {...rotateResponder.panHandlers}
            style={[
              styles.rotateHandle,
              {
                backgroundColor: theme.isDark ? "rgba(20,20,20,0.84)" : "rgba(255,255,255,0.92)",
                borderColor: theme.isDark ? "rgba(255,255,255,0.18)" : "rgba(38,38,38,0.12)"
              }
            ]}
          >
            <Feather name="rotate-cw" size={10} color={theme.colors.text} />
          </View>
          <View
            {...resizeResponder.panHandlers}
            style={[
              styles.resizeHandle,
              {
                backgroundColor: theme.isDark ? "rgba(20,20,20,0.84)" : "rgba(255,255,255,0.92)",
                borderColor: theme.isDark ? "rgba(255,255,255,0.18)" : "rgba(38,38,38,0.12)"
              }
            ]}
          >
            <Feather name="maximize-2" size={9} color={theme.colors.text} />
          </View>
          {editableLayer ? (
            <TouchableOpacity
              activeOpacity={0.86}
              style={[
                styles.editHandle,
                {
                  backgroundColor: theme.isDark ? "rgba(20,20,20,0.88)" : "rgba(255,255,255,0.95)",
                  borderColor: theme.isDark ? "rgba(255,255,255,0.2)" : "rgba(38,38,38,0.12)"
                }
              ]}
              onPress={() => {
                onSelectRef.current();
                onEditTextRef.current();
              }}
            >
              <Feather name="edit-3" size={10} color={theme.colors.accent} />
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function clampLayerPosition(value: number, size: number) {
  return Math.max(0.01, Math.min(0.99 - size, value));
}

function getLayerReferenceSize(surfaceSize: { width: number; height: number }) {
  return Math.max(1, Math.min(Math.max(1, surfaceSize.width), Math.max(1, surfaceSize.height)));
}

function getLayerMetrics(layer: DocumentEditLayer, surfaceSize: { width: number; height: number }) {
  const safeWidth = Math.max(1, surfaceSize.width);
  const safeHeight = Math.max(1, surfaceSize.height);
  const referenceSize = layer.type === "redaction" ? 1 : getLayerReferenceSize(surfaceSize);
  const width = layer.type === "redaction" ? Math.max(1, layer.width * safeWidth) : Math.max(1, layer.width * referenceSize);
  const height = layer.type === "redaction" ? Math.max(1, layer.height * safeHeight) : Math.max(1, layer.height * referenceSize);
  const left = Math.max(0, Math.min(safeWidth - width, layer.x * safeWidth));
  const top = Math.max(0, Math.min(safeHeight - height, layer.y * safeHeight));
  return { left, top, width, height };
}

function normalizeRotation(rotation: number) {
  return ((rotation % 360) + 360) % 360;
}

function isTextLayer(layer: DocumentEditLayer) {
  return layer.type === "text" || layer.type === "typedSignature" || (layer.type === "qrSignature" && !layer.imageUri);
}

function documentLayerVisualWeight(layer: DocumentEditLayer) {
  if (layer.type === "pen" || layer.type === "highlight") return 10;
  if (layer.type === "redaction") return 20;
  return 30;
}

function fontFamilyForLayer(layer: DocumentEditLayer) {
  if (layer.fontFamily === "serif") return "Times New Roman";
  if (layer.fontFamily === "mono") return "Menlo";
  if (layer.fontFamily === "script" || layer.type === "typedSignature") return "Snell Roundhand";
  return undefined;
}

function isPdfFile(file: AppFile) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "pdf" || Boolean(file.mimeType?.toLowerCase().includes("pdf"));
}

function QrVisual({ value, color }: { value: string; color: string }) {
  const cells = useMemo(() => createQrCells(value), [value]);
  return (
    <View pointerEvents="none" style={styles.qrVisual}>
      {cells.map((active, index) => (
        <View key={index} style={[styles.qrCell, active && { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function StrokeView({ points, color, width, opacity }: { points: EditorPoint[]; color: string; width: number; opacity: number }) {
  const path = pointsToPath(points);
  if (!path) return null;

  return (
    <View pointerEvents="none" style={styles.strokeLayer}>
      <Svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <Path
          d={path}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={opacity}
          strokeWidth={width * 2.6}
        />
      </Svg>
    </View>
  );
}

function createQrCells(value: string) {
  const size = 15;
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) >>> 0;
  }
  return Array.from({ length: size * size }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const finder =
      (x < 5 && y < 5) ||
      (x > size - 6 && y < 5) ||
      (x < 5 && y > size - 6);
    if (finder) {
      const localX = x < 5 ? x : x - (size - 5);
      const localY = y < 5 ? y : y - (size - 5);
      return localX === 0 || localX === 4 || localY === 0 || localY === 4 || (localX === 2 && localY === 2);
    }
    const noise = (seed + x * 17 + y * 29 + x * y * 7) % 11;
    return noise === 0 || noise === 2 || noise === 5 || noise === 7;
  });
}

function pointsToPath(points: EditorPoint[]) {
  if (points.length < 2) return "";
  let path = "";
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (index === 0 || point.move) {
      path += `${path ? " " : ""}M ${point.x * 1000} ${point.y * 1000}`;
      continue;
    }
    const previous = points[index - 1];
    if (previous.move) {
      path += ` L ${point.x * 1000} ${point.y * 1000}`;
      continue;
    }
    const midX = ((previous.x + point.x) / 2) * 1000;
    const midY = ((previous.y + point.y) / 2) * 1000;
    path += ` Q ${previous.x * 1000} ${previous.y * 1000} ${midX} ${midY}`;
  }
  return path;
}

function normalizePoint(
  x: number,
  y: number,
  size: { width: number; height: number },
  pan: { x: number; y: number },
  zoom: number
) {
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  const contentX = centerX + (x - pan.x - centerX) / Math.max(minDocumentZoom, zoom);
  const contentY = centerY + (y - pan.y - centerY) / Math.max(minDocumentZoom, zoom);
  return {
    x: Math.max(0, Math.min(1, contentX / Math.max(1, size.width))),
    y: Math.max(0, Math.min(1, contentY / Math.max(1, size.height)))
  };
}

function normalizePadPoint(x: number, y: number, size: { width: number; height: number }) {
  return {
    x: Math.max(0, Math.min(1, x / Math.max(1, size.width))),
    y: Math.max(0, Math.min(1, y / Math.max(1, size.height)))
  };
}

function clampPan(pan: { x: number; y: number }, size: { width: number; height: number }, zoom: number) {
  const baseX = Math.min(size.width * 0.32, 150);
  const baseY = Math.min(size.height * 0.32, 190);
  const zoomDelta = Math.max(0, Math.max(minDocumentZoom, zoom) - 1);
  const maxX = (zoomDelta * size.width) / 2 + baseX;
  const maxY = (zoomDelta * size.height) / 2 + baseY;
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y))
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 62,
    paddingHorizontal: 12
  },
  topBarLandscape: { minHeight: 48, paddingHorizontal: 10 },
  iconButton: { alignItems: "center", borderRadius: 14, height: 40, justifyContent: "center", width: 40 },
  iconButtonLandscape: { height: 36, width: 36 },
  titleWrap: { flex: 1 },
  title: { fontSize: 17, fontWeight: "900" },
  subtitle: { fontSize: 12, fontWeight: "700" },
  landscapeActionDock: { alignItems: "center", flexDirection: "row", gap: 8 },
  landscapeMiniAction: { alignItems: "center", borderRadius: 13, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  landscapeSaveClip: { borderRadius: 14, overflow: "hidden" },
  landscapeSaveButton: { alignItems: "center", flexDirection: "row", gap: 6, height: 36, justifyContent: "center", paddingHorizontal: 12 },
  landscapeSaveText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  toolBar: { alignItems: "center", borderBottomWidth: 1, flexDirection: "row", gap: 6, minHeight: 58, paddingHorizontal: 8 },
  toolBarLandscape: { gap: 5, minHeight: 46, paddingHorizontal: 6 },
  toolButton: { alignItems: "center", borderRadius: 12, gap: 2, justifyContent: "center", minHeight: 44, paddingHorizontal: 8 },
  toolButtonCompact: { height: 36, minHeight: 36, minWidth: 38, paddingHorizontal: 8 },
  toolText: { fontSize: 10, fontWeight: "900" },
  compactButton: { alignItems: "center", borderRadius: 12, height: 42, justifyContent: "center", minWidth: 38, paddingHorizontal: 8 },
  historyButton: { minWidth: 36, paddingHorizontal: 7 },
  compactText: { fontSize: 12, fontWeight: "900" },
  signatureMenu: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 8,
    position: "absolute",
    right: 12,
    top: 122,
    zIndex: 30
  },
  signatureMenuBackdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 29 },
  signatureMenuButton: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10
  },
  signatureMenuText: { fontSize: 12, fontWeight: "900" },
  pageActionMenu: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 8,
    position: "absolute",
    right: 12,
    top: 62,
    width: 238,
    zIndex: 32
  },
  pageActionButton: { alignItems: "center", borderRadius: 14, flexDirection: "row", gap: 10, minHeight: 50, paddingHorizontal: 10 },
  pageActionTextWrap: { flex: 1 },
  pageActionTitle: { fontSize: 12, fontWeight: "900" },
  pageActionSubtitle: { fontSize: 10, fontWeight: "800", marginTop: 1 },
  drawModeRow: { borderRadius: 13, flexDirection: "row", gap: 4, padding: 4 },
  drawModeButton: { alignItems: "center", borderRadius: 10, flex: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 36, paddingHorizontal: 8 },
  drawModeText: { fontSize: 11, fontWeight: "900" },
  colorPickerButton: { alignItems: "center", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 48, paddingHorizontal: 10 },
  colorPickerPreview: { borderRadius: 999, borderWidth: 1, height: 28, width: 28 },
  colorPickerTextWrap: { flex: 1 },
  colorPickerTitle: { fontSize: 12, fontWeight: "900" },
  colorPickerValue: { fontSize: 11, fontWeight: "800", marginTop: 1 },
  colorModalOverlay: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.52)", bottom: 0, justifyContent: "center", left: 0, padding: 18, position: "absolute", right: 0, top: 0 },
  colorModal: { borderRadius: 22, borderWidth: 1, maxWidth: 420, padding: 14, width: "100%" },
  colorModalHeader: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 12 },
  colorModalIcon: { borderRadius: 999, height: 34, width: 34 },
  colorModalTitle: { fontSize: 16, fontWeight: "900" },
  colorModalSubtitle: { fontSize: 11, fontWeight: "800", marginTop: 1 },
  colorFamilyList: { gap: 8 },
  colorFamilyRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  colorModalSwatch: { alignItems: "center", borderRadius: 14, borderWidth: 2, height: 44, justifyContent: "center", width: 44 },
  hexRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 12 },
  hexInput: { borderRadius: 14, borderWidth: 1, flex: 1, fontSize: 13, fontWeight: "900", height: 44, paddingHorizontal: 12 },
  hexApplyClip: { borderRadius: 14, overflow: "hidden" },
  hexApplyButton: { alignItems: "center", height: 44, justifyContent: "center", paddingHorizontal: 16 },
  hexApplyText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  confirmModal: { alignItems: "center", borderRadius: 22, borderWidth: 1, gap: 10, maxWidth: 360, padding: 16, width: "100%" },
  confirmIcon: { alignItems: "center", borderRadius: 18, height: 48, justifyContent: "center", width: 48 },
  confirmTitle: { fontSize: 17, fontWeight: "900" },
  confirmBody: { fontSize: 13, fontWeight: "800", lineHeight: 18, textAlign: "center" },
  confirmActions: { flexDirection: "row", gap: 8, marginTop: 4, width: "100%" },
  confirmCancel: { alignItems: "center", borderRadius: 14, borderWidth: 1, flex: 1, height: 44, justifyContent: "center" },
  confirmCancelText: { fontSize: 13, fontWeight: "900" },
  confirmDelete: { alignItems: "center", borderRadius: 14, flex: 1, height: 44, justifyContent: "center" },
  confirmDeleteText: { fontSize: 13, fontWeight: "900" },
  eraserNotice: { alignItems: "center", borderRadius: 12, flexDirection: "row", gap: 7, minHeight: 38, paddingHorizontal: 10 },
  eraserNoticeText: { flex: 1, fontSize: 11, fontWeight: "800" },
  savedSignatureBlock: { gap: 6, paddingHorizontal: 2, paddingVertical: 2 },
  savedSignatureTitle: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  savedSignatureRow: { flexDirection: "row", gap: 6 },
  savedSignatureThumb: { borderRadius: 12, borderWidth: 1, height: 44, overflow: "hidden", position: "relative", width: 62 },
  savedSignatureIndex: {
    backgroundColor: "rgba(17, 24, 39, 0.72)",
    borderRadius: 999,
    bottom: 4,
    color: "#fff",
    fontSize: 9,
    fontWeight: "900",
    height: 15,
    lineHeight: 15,
    position: "absolute",
    right: 4,
    textAlign: "center",
    width: 15
  },
  savedSignatureDelete: {
    alignItems: "center",
    borderRadius: 999,
    height: 18,
    justifyContent: "center",
    position: "absolute",
    right: 3,
    top: 3,
    width: 18,
    zIndex: 4
  },
  optionBar: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6, minHeight: 78, paddingHorizontal: 8, paddingVertical: 6 },
  optionBarLandscape: { flexWrap: "nowrap", minHeight: 48, paddingVertical: 3 },
  optionScrollContent: { alignItems: "center", gap: 6, paddingRight: 8 },
  swatch: { borderRadius: 999, borderWidth: 2, height: 22, width: 22 },
  widthSliderWrap: { alignItems: "center", flexBasis: 150, flexGrow: 1, flexDirection: "row", gap: 8, minWidth: 120 },
  widthSliderWrapLandscape: { flexBasis: 150, minWidth: 150 },
  widthPreview: { borderRadius: 999, width: 28 },
  eraserWidthPreview: { borderWidth: 1 },
  widthSlider: { flex: 1, height: 34 },
  viewerArea: { flex: 1, minHeight: 0, padding: 8, paddingBottom: 84, position: "relative" },
  pageRail: {
    borderRadius: 16,
    borderWidth: 1,
    left: 14,
    position: "absolute",
    top: 14,
    width: 42,
    zIndex: 21
  },
  pageRailContent: { gap: 5, padding: 5 },
  pageRailItem: { alignItems: "center", borderRadius: 10, height: 28, justifyContent: "center", width: 30 },
  pageRailText: { fontSize: 11, fontWeight: "900" },
  zoomDock: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 4,
    position: "absolute",
    right: 14,
    top: 14,
    zIndex: 20
  },
  zoomButton: { alignItems: "center", height: 30, justifyContent: "center", width: 30 },
  zoomPercentButton: { alignItems: "center", minWidth: 52, justifyContent: "center" },
  zoomPercent: { fontSize: 12, fontWeight: "900" },
  previewSurface: { borderRadius: 10, borderWidth: 1, flex: 1, minHeight: 0, overflow: "hidden" },
  previewContent: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  nativePreviewShell: { flex: 1, height: "100%", width: "100%" },
  nativePdfPreview: { flex: 1, height: "100%", width: "100%" },
  blankPagePreview: { alignItems: "center", backgroundColor: "#fff", flex: 1, height: "100%", justifyContent: "center", width: "100%" },
  blankPageText: { fontSize: 13, fontWeight: "900" },
  webPreview: { backgroundColor: "transparent", flex: 1 },
  panOverlay: { backgroundColor: "rgba(0,0,0,0.001)", bottom: 0, elevation: 6, left: 0, position: "absolute", right: 0, top: 0, zIndex: 6 },
  layerCanvas: { bottom: 0, elevation: 10, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 },
  strokeLayer: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  strokeHitbox: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  layerBox: { alignItems: "stretch", borderRadius: 7, elevation: 30, justifyContent: "center", position: "absolute", zIndex: 30 },
  layerDragSurface: { alignItems: "stretch", bottom: 0, justifyContent: "center", left: 0, padding: 6, position: "absolute", right: 0, top: 0 },
  layerText: { color: "#111827", flexShrink: 1, fontWeight: "800" },
  redactionLayer: { backgroundColor: "#FFFFFF", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  signatureText: { color: "#111827", flexShrink: 1, fontWeight: "900", fontStyle: "italic" },
  signatureImage: { height: "100%", width: "100%" },
  signatureInkLayer: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  qrVisual: {
    alignSelf: "center",
    aspectRatio: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    height: "100%",
    justifyContent: "center",
    maxHeight: 120,
    maxWidth: 120,
    width: "100%"
  },
  qrCell: { aspectRatio: 1, width: `${100 / 15}%` },
  deleteHandle: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    elevation: 32,
    height: 18,
    justifyContent: "center",
    left: -9,
    position: "absolute",
    shadowColor: "#000",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    top: -9,
    width: 18,
    zIndex: 40
  },
  rotateHandle: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    elevation: 32,
    height: 18,
    justifyContent: "center",
    position: "absolute",
    right: -9,
    shadowColor: "#000",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    top: -9,
    width: 18,
    zIndex: 40
  },
  resizeHandle: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    bottom: -9,
    elevation: 34,
    height: 18,
    justifyContent: "center",
    position: "absolute",
    right: -9,
    shadowColor: "#000",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
    width: 18,
    zIndex: 40
  },
  editHandle: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    bottom: -9,
    elevation: 34,
    height: 18,
    justifyContent: "center",
    left: -9,
    position: "absolute",
    shadowColor: "#000",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    width: 18,
    zIndex: 41
  },
  bottomPanel: {
    borderRadius: 18,
    borderWidth: 1,
    bottom: 10,
    elevation: 24,
    gap: 8,
    left: 18,
    padding: 10,
    position: "absolute",
    right: 18,
    shadowColor: "#000",
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    zIndex: 80
  },
  bottomPanelLandscape: { bottom: 8, gap: 6, left: 18, maxWidth: 500, right: 318, paddingHorizontal: 10, paddingVertical: 8 },
  editorToast: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    bottom: 14,
    left: 18,
    maxWidth: "70%",
    minHeight: 34,
    paddingHorizontal: 12,
    position: "absolute",
    zIndex: 22
  },
  editorToastText: { fontSize: 12, fontWeight: "900", lineHeight: 34 },
  landscapeMessage: {
    borderRadius: 12,
    bottom: 10,
    fontSize: 11,
    fontWeight: "800",
    left: 12,
    maxWidth: "46%",
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: "absolute",
    zIndex: 30
  },
  toolsPanelBackdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 35 },
  toolsPanel: {
    borderRadius: 22,
    borderWidth: 1,
    elevation: 46,
    overflow: "hidden",
    position: "absolute",
    shadowColor: "#000",
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    zIndex: 45
  },
  toolsPanelPortrait: { bottom: 102, left: 12, maxHeight: 338, right: 12 },
  toolsPanelLandscape: { bottom: 12, right: 12, top: 58, width: 306 },
  toolsPanelHeader: { alignItems: "center", flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  toolsPanelTitle: { flex: 1, fontSize: 14, fontWeight: "900" },
  toolsPanelClose: { alignItems: "center", borderRadius: 999, height: 30, justifyContent: "center", width: 30 },
  toolsPanelTabs: { borderRadius: 14, flexDirection: "row", gap: 4, marginHorizontal: 12, marginTop: 8, padding: 4 },
  toolsPanelTab: { alignItems: "center", borderRadius: 11, flex: 1, flexDirection: "row", gap: 6, height: 34, justifyContent: "center" },
  toolsPanelTabText: { fontSize: 11, fontWeight: "900" },
  toolsPanelScroll: { gap: 12, padding: 12, paddingTop: 8 },
  toolsSection: { gap: 9 },
  toolsSectionTitle: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  toolSwatchRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toolActionRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  panelIconButton: { alignItems: "center", borderRadius: 12, height: 38, justifyContent: "center", width: 42 },
  panelTextTools: { gap: 8 },
  emptyToolState: { alignItems: "center", borderRadius: 16, gap: 7, justifyContent: "center", minHeight: 92, padding: 12 },
  emptyToolText: { fontSize: 12, fontWeight: "800", textAlign: "center" },
  floatingLayerEditPanel: {
    borderRadius: 20,
    borderWidth: 1,
    bottom: 14,
    gap: 8,
    left: 14,
    opacity: 0.96,
    padding: 10,
    position: "absolute",
    right: 14,
    zIndex: 25
  },
  floatingLayerEditPanelLandscape: {
    bottom: 8,
    maxHeight: 104,
    padding: 8,
    left: 8,
    right: 8
  },
  pageRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  pagePicker: { borderRadius: 16, height: 46, overflow: "hidden", width: 64 },
  input: { borderRadius: 14, borderWidth: 1, maxHeight: 70, minHeight: 40, paddingHorizontal: 10, paddingVertical: 7 },
  inputLandscape: { maxHeight: 36, minHeight: 34, paddingVertical: 5 },
  actionRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  bottomActionBar: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "center" },
  bottomActionSpacer: { width: 46 },
  editorQuickActions: { flexDirection: "row", gap: 8 },
  editorQuickButton: {
    alignItems: "center",
    borderColor: "rgba(142,142,142,0.24)",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    height: 38,
    justifyContent: "center"
  },
  editorQuickText: { fontSize: 12, fontWeight: "900" },
  speechPanel: { gap: 9 },
  speechPanelHeader: { alignItems: "center", flexDirection: "row", gap: 8 },
  speechPanelTitleWrap: { alignItems: "center", flex: 1, flexDirection: "row", gap: 7 },
  speechPanelTitle: { fontSize: 13, fontWeight: "900" },
  speechPanelClose: { alignItems: "center", borderRadius: 999, height: 28, justifyContent: "center", width: 28 },
  speechRateRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  speechRateLabel: { fontSize: 11, fontWeight: "900" },
  speechRateSlider: { flex: 1, height: 30 },
  speechRateValue: { fontSize: 12, fontWeight: "900", minWidth: 42, textAlign: "right" },
  speechMainButton: { alignItems: "center", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 7, height: 36, justifyContent: "center" },
  speechMainText: { fontSize: 12, fontWeight: "900" },
  speechLanguageText: { fontSize: 11, fontWeight: "800", textAlign: "center" },
  voiceActionButton: {
    alignItems: "center",
    borderColor: "rgba(142,142,142,0.35)",
    borderRadius: 15,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  miniAction: { alignItems: "center", borderRadius: 16, borderWidth: 1, height: 46, justifyContent: "center", width: 46 },
  saveButtonClip: { borderRadius: 12, maxWidth: 230, minWidth: 176, overflow: "hidden" },
  saveButton: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 46, paddingHorizontal: 18 },
  saveText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  textTools: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7 },
  textToolsScrollContent: { alignItems: "center", paddingRight: 8 },
  formatButton: { alignItems: "center", borderRadius: 10, borderWidth: 1, height: 34, justifyContent: "center", width: 38 },
  formatLetter: { fontSize: 14 },
  underlineLetter: { textDecorationLine: "underline" },
  strikeLetter: { textDecorationLine: "line-through" },
  backgroundSwatch: { borderRadius: 10, borderWidth: 2, height: 32, width: 34 },
  fontChip: { alignItems: "center", borderRadius: 10, borderWidth: 1, height: 34, justifyContent: "center", paddingHorizontal: 9 },
  fontChipText: { fontSize: 11, fontWeight: "900" },
  fontSliderWrap: { alignItems: "center", flexDirection: "row", flexGrow: 1, gap: 6, minWidth: 120 },
  fontLabel: { fontSize: 12, fontWeight: "900", minWidth: 38 },
  fontSlider: { flex: 1, height: 32 },
  message: { fontSize: 12, fontWeight: "800" },
  signaturePadScreen: { flex: 1, padding: 16, paddingTop: 54 },
  signaturePadScreenLandscape: { padding: 10, paddingTop: 10 },
  signaturePadHeader: { alignItems: "center", borderBottomWidth: 1, flexDirection: "row", gap: 10, paddingBottom: 14 },
  signaturePadHeaderLandscape: { minHeight: 48, paddingBottom: 8 },
  signaturePadBody: { alignItems: "center", flex: 1, justifyContent: "center" },
  signaturePadBodyLandscape: { alignItems: "stretch", flexDirection: "row", gap: 10, justifyContent: "center", paddingTop: 8 },
  signaturePad: { aspectRatio: 1.72, borderRadius: 18, borderWidth: 1, marginTop: 18, maxWidth: 760, overflow: "hidden", width: "100%" },
  signaturePadLandscape: { aspectRatio: undefined, flex: 1, marginTop: 0, maxWidth: undefined, minHeight: 0, width: undefined },
  signatureSaveClip: { borderRadius: 18, marginTop: 16, overflow: "hidden" },
  signatureSaveClipLandscape: { alignSelf: "center", marginTop: 0, minWidth: 168 },
  signatureSaveButton: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54, paddingHorizontal: 16 },
  redrawButton: { alignItems: "center", borderRadius: 14, flexDirection: "row", gap: 6, height: 40, justifyContent: "center", paddingHorizontal: 10 },
  redrawText: { fontSize: 12, fontWeight: "900" }
});
