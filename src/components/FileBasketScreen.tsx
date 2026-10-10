import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Modal, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import type { AppTheme } from "../theme";
import type { Language } from "../i18n";
import { basketCopy } from "../game/fileBasketCopy";
import { advanceShot, court, createShot, predictShot, velocityForDrag } from "../game/fileBasketPhysics";
import type { Point, Shot } from "../game/fileBasketPhysics";
import { attemptsLeft, awardHit, beginAttempt, emptyProgress, parseProgress, roundIntervalMs } from "../game/fileBasketRules";
import type { BasketProgress } from "../game/fileBasketRules";

const storageKey = "editio.fileBasket.preview.v1";
type Phase = "loading" | "ready" | "saving" | "flying" | "miss" | "success" | "paused" | "error" | "loadError";

export function FileBasketScreen({ theme, language, onClose }: { theme: AppTheme; language: Language; onClose: () => void }) {
  const copy = basketCopy(language);
  const window = useWindowDimensions();
  const isLandscape = window.width > window.height;
  const [progress, setProgress] = useState<BasketProgress>(emptyProgress);
  const progressRef = useRef(progress);
  const [phase, setPhase] = useState<Phase>("loading");
  const phaseRef = useRef<Phase>("loading");
  const [velocity, setVelocity] = useState<Point | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const drag = useRef<{ pageX: number; pageY: number } | null>(null);
  const aimRef = useRef<Point | null>(null);
  const frame = useRef<number | null>(null);
  const mounted = useRef(true);
  const appState = useRef(AppState.currentState);
  const celebration = useRef(new Animated.Value(0)).current;
  const scale = Math.min(layout.width / court.width, layout.height / court.height);
  const offsetX = (layout.width - court.width * scale) / 2;
  const offsetY = (layout.height - court.height * scale) / 2;
  const left = attemptsLeft(progress, now);
  const canAim = phase === "ready" && left > 0;

  function changePhase(next: Phase) {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }

  async function loadProgress() {
    changePhase("loading");
    try {
      const saved = parseProgress(await AsyncStorage.getItem(storageKey));
      if (!mounted.current) return;
      progressRef.current = saved;
      setProgress(saved);
      setNow(Date.now());
      changePhase("ready");
    } catch {
      if (mounted.current) changePhase("loadError");
    }
  }

  async function saveProgress(next: BasketProgress) {
    await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    progressRef.current = next;
    if (mounted.current) setProgress(next);
  }

  function cancelFlight() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    drag.current = null;
    aimRef.current = null;
    if (mounted.current) setVelocity(null);
    if (phaseRef.current === "flying") changePhase("paused");
  }

  useEffect(() => {
    mounted.current = true;
    void loadProgress();
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    const listener = AppState.addEventListener("change", (state) => {
      appState.current = state;
      if (state !== "active") cancelFlight();
      else setNow(Date.now());
    });
    return () => {
      mounted.current = false;
      clearInterval(timer);
      listener.remove();
      cancelFlight();
      celebration.stopAnimation();
    };
  }, []);

  async function finishFlight(final: Shot, roundStartedAt: number) {
    frame.current = null;
    if (!final.scored) {
      changePhase("miss");
      return;
    }
    changePhase("saving");
    try {
      await saveProgress(awardHit(progressRef.current, roundStartedAt));
      if (!mounted.current) return;
      changePhase("success");
      celebration.setValue(0);
      Animated.timing(celebration, { toValue: 1, duration: 1100, useNativeDriver: true }).start();
    } catch {
      if (mounted.current) changePhase("error");
    }
  }

  async function launch(aim: Point) {
    if (phaseRef.current !== "ready" || aim.y > -150) return;
    const next = beginAttempt(progressRef.current, Date.now());
    if (!next?.round) return;
    const roundStartedAt = next.round.startedAt;
    changePhase("saving");
    setVelocity(null);
    aimRef.current = null;
    try {
      await saveProgress(next);
      if (!mounted.current) return;
      setNow(Date.now());
      if (appState.current !== "active") { changePhase("paused"); return; }
      let current = createShot(aim);
      let previousTime: number | null = null;
      setShot(current);
      changePhase("flying");
      const animate = (timestamp: number) => {
        if (!mounted.current || phaseRef.current !== "flying") return;
        const elapsed = previousTime === null ? 0 : Math.min((timestamp - previousTime) / 1000, 0.06);
        previousTime = timestamp;
        current = advanceShot(current, elapsed);
        setShot(current);
        if (current.done) void finishFlight(current, roundStartedAt);
        else frame.current = requestAnimationFrame(animate);
      };
      frame.current = requestAnimationFrame(animate);
    } catch {
      if (mounted.current) changePhase("error");
    }
  }

  function beginDrag(event: GestureResponderEvent) {
    if (!canAim) return false;
    const { locationX, locationY } = event.nativeEvent;
    const x = (locationX - offsetX) / scale;
    const y = (locationY - offsetY) / scale;
    return Math.hypot(x - court.launch.x, y - court.launch.y) < Math.max(40, 22 / scale);
  }

  function moveDrag(event: GestureResponderEvent) {
    if (!drag.current) return;
    const aim = velocityForDrag((event.nativeEvent.pageX - drag.current.pageX) / scale,
      (event.nativeEvent.pageY - drag.current.pageY) / scale);
    aimRef.current = aim;
    setVelocity(aim);
  }

  const remainingMs = Math.max(0, (progress.round?.startedAt ?? 0) + roundIntervalMs - now);
  const minutes = Math.ceil(remainingMs / 60_000);
  const countdown = `${Math.floor(minutes / 60)}${language === "tr" ? " sa" : "h"} ${minutes % 60}${language === "tr" ? " dk" : "m"}`;
  const complete = left === 0 && phase !== "flying" && phase !== "saving";
  const title = phase === "success" ? copy.success : phase === "miss" ? copy.miss : phase === "paused" ? copy.paused :
    phase === "loading" ? copy.loading : phase === "saving" ? copy.saving : phase === "flying" ? copy.flying :
    phase === "error" || phase === "loadError" ? copy.retry : complete ? copy.ended : copy.ready;
  const body = phase === "success" ? (progress.points === 0 ? copy.creditSuccess : copy.successBody) :
    phase === "error" ? copy.error : phase === "loadError" ? copy.loadError :
    complete ? copy.endedBody : phase === "paused" ? copy.pausedBody :
    phase === "miss" ? copy.missBody : velocity ? copy.aim : copy.instruction;
  const filePosition = shot && (phase !== "ready" && phase !== "loading") ? shot : court.launch;
  const dots = velocity && velocity.y < -150 ? predictShot(velocity) : [];
  const power = velocity ? Math.round(Math.hypot(velocity.x, velocity.y) / 640 * 100) : 0;
  const resetShot = () => { setShot(null); setVelocity(null); setNow(Date.now()); changePhase("ready"); };

  const statsPanel = (
          <View style={[styles.stats, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: theme.colors.primary }]}>{progress.points}<Text style={styles.statTotal}> / 5</Text></Text>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>{copy.points}</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: theme.colors.accent }]}>{progress.previewCredits}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>{copy.credits}</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.stat}>
              <View style={styles.attempts}>{[0, 1, 2].map((n) => <Feather key={n} name="file" size={17}
                color={n < left ? theme.colors.primary : theme.colors.border} />)}</View>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>{left} {copy.attempts}</Text>
            </View>
          </View>
  );
  const noticePanel = (
          <View style={[styles.notice, { borderColor: theme.colors.border }]}>
            <Text style={[styles.previewLabel, { color: theme.colors.accent }]}>{copy.preview}</Text>
            <Text style={[styles.noticeText, { color: theme.colors.muted }]}>{copy.notice}</Text>
          </View>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" supportedOrientations={["portrait", "landscape"]} onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
          <View style={styles.header}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={copy.close} onPress={onClose}
              style={[styles.close, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
              <Feather name="arrow-left" size={22} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={styles.heading}>
              <Text style={[styles.kicker, { color: theme.colors.primary }]}>{copy.daily}</Text>
              <Text style={[styles.title, { color: theme.colors.text }]}>{copy.title}</Text>
            </View>
            <View style={[styles.gameIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="game-controller-outline" size={26} color={theme.colors.primary} />
            </View>
          </View>

          {!isLandscape ? statsPanel : null}
          <View style={[styles.playArea, isLandscape && styles.playAreaLandscape]}>

          <View testID="file-basket-court" style={[styles.court, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}
            onLayout={(event) => { setLayout(event.nativeEvent.layout); drag.current = null; aimRef.current = null; setVelocity(null); }}
            onStartShouldSetResponder={beginDrag}
            onResponderGrant={(event) => { drag.current = { pageX: event.nativeEvent.pageX, pageY: event.nativeEvent.pageY }; }}
            onResponderMove={moveDrag}
            onResponderRelease={(event) => {
              moveDrag(event);
              const aim = aimRef.current;
              drag.current = null;
              if (aim && aim.y < -150) void launch(aim);
              else { aimRef.current = null; setVelocity(null); }
            }}
            onResponderTerminate={() => { drag.current = null; aimRef.current = null; setVelocity(null); }}
            onResponderTerminationRequest={() => false}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Svg width="100%" height="100%" viewBox={`0 0 ${court.width} ${court.height}`}>
                <Defs>
                  <LinearGradient id="courtGlow" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor={theme.colors.primarySoft} />
                    <Stop offset="1" stopColor={theme.colors.accentSoft} />
                  </LinearGradient>
                </Defs>
                <Circle cx="268" cy="200" r="115" fill="url(#courtGlow)" opacity={0.6} />
                <Circle cx="268" cy="200" r="92" stroke={theme.colors.border} strokeDasharray="3 9" fill="none" />
                <Path d="M 18 484 H 342 M 32 490 L 55 506 H 312 L 334 490 M 135 484 Q 190 450 245 484"
                  stroke={theme.colors.border} strokeWidth={2} fill="none" />
                <Rect x={court.board.x - 3} y={court.board.top} width={6} height={court.board.bottom - court.board.top}
                  rx={3} fill={theme.colors.text} />
                <Path d="M 310 160 H 285 V 193 H 310" stroke={theme.colors.muted} strokeWidth={3} fill="none" />
                <Line x1="311" y1="234" x2="311" y2="484" stroke={theme.colors.border} strokeWidth={5} />
                <Path d="M 232 208 L 246 240 H 280 L 294 208 M 244 208 L 257 240 M 258 208 L 270 240 M 278 208 L 262 240 M 289 208 L 275 240 M 237 220 H 289 M 242 232 H 284"
                  stroke={phase === "success" ? theme.colors.success : theme.colors.muted} strokeWidth={1.6} fill="none" />
                <Line x1={court.rim.left} y1={court.rim.y} x2={court.rim.right} y2={court.rim.y}
                  stroke={phase === "success" ? theme.colors.success : theme.colors.gradientStart} strokeWidth={5} strokeLinecap="round" />
                <Circle cx={court.rim.left} cy={court.rim.y} r={4} fill={theme.colors.gradientStart} />
                <Circle cx={court.rim.right} cy={court.rim.y} r={4} fill={theme.colors.gradientStart} />
                {dots.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={2.3}
                  fill={theme.colors.primary} opacity={1 - index / 55} />)}
                <Ellipse cx={court.launch.x} cy={court.floor} rx={25} ry={5} fill={theme.colors.border} />
                {canAim ? <Circle cx={court.launch.x} cy={court.launch.y} r={32} stroke={theme.colors.primary}
                  strokeWidth={1.5} strokeDasharray="4 6" fill={theme.colors.primarySoft} /> : null}
                <G transform={`translate(${filePosition.x}, ${filePosition.y}) rotate(${shot && phase === "flying" ? shot.time * 160 : -12})`}>
                  <Path d="M -10 -14 H 3 L 11 -6 V 14 H -10 Z" fill={theme.colors.primary} stroke={theme.colors.onPrimary} strokeWidth={1.5} />
                  <Path d="M 3 -14 V -6 H 11 M -5 1 H 5 M -5 6 H 5" fill="none" stroke={theme.colors.onPrimary} strokeWidth={1.7} strokeLinecap="round" />
                </G>
              </Svg>
            </View>
            <View pointerEvents="none" style={styles.courtBadge}>
              <Text style={[styles.courtBadgeText, { color: theme.colors.muted }]}>{copy.subtitle}</Text>
            </View>
            {velocity ? <View pointerEvents="none" style={[styles.power, { backgroundColor: theme.colors.surface }]}>
              <Text style={[styles.statLabel, { color: theme.colors.text }]}>{copy.power} {power}%</Text>
              <View style={[styles.powerTrack, { backgroundColor: theme.colors.border }]}>
                <View style={{ height: 4, width: `${power}%`, backgroundColor: theme.colors.primary, borderRadius: 3 }} />
              </View>
            </View> : null}
            <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.celebration, {
              opacity: celebration.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ scale: celebration.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) },
                { translateY: celebration.interpolate({ inputRange: [0, 1], outputRange: [0, -45] }) }]
            }]}>
              <Feather name="star" size={70} color={theme.colors.success} />
              <Text style={[styles.plus, { color: theme.colors.success }]}>+1</Text>
            </Animated.View>
          </View>

          <View style={[styles.controls, isLandscape && styles.controlsLandscape]}>
          {isLandscape ? statsPanel : null}
          <View style={styles.feedback} accessibilityLiveRegion="polite">
            <Text style={[styles.feedbackTitle, { color: phase === "success" ? theme.colors.success : theme.colors.text }]}>{title}</Text>
            <Text style={[styles.feedbackBody, { color: theme.colors.muted }]}>{body}</Text>
            {(phase === "miss" || phase === "paused") && left > 0 ?
              <TouchableOpacity accessibilityRole="button" style={[styles.next, { backgroundColor: theme.colors.primary }]} onPress={resetShot}>
                <Text style={[styles.nextText, { color: theme.colors.onPrimary }]}>{copy.next}</Text>
                <Feather name="arrow-right" size={18} color={theme.colors.onPrimary} />
              </TouchableOpacity> : phase === "loadError" ?
                <TouchableOpacity accessibilityRole="button" style={[styles.next, { backgroundColor: theme.colors.primary }]} onPress={() => void loadProgress()}>
                  <Text style={[styles.nextText, { color: theme.colors.onPrimary }]}>{copy.retry}</Text>
                </TouchableOpacity> : complete && left === 0 ?
                  <Text style={[styles.countdown, { color: theme.colors.primary }]}>{countdown}</Text> : null}
            {left > 0 && (phase === "success" || complete) ? <TouchableOpacity onPress={resetShot} accessibilityRole="button">
              <Text style={{ color: theme.colors.primary }}>{copy.next}</Text>
            </TouchableOpacity> : null}
          </View>
          {isLandscape ? noticePanel : null}
          </View>
          </View>
          {!isLandscape ? noticePanel : null}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18, gap: 12 },
  playArea: { flex: 1, gap: 12 }, playAreaLandscape: { flexDirection: "row" },
  controls: { gap: 10 }, controlsLandscape: { width: "40%", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 15, borderWidth: 1 },
  heading: { flex: 1, gap: 3 }, kicker: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.5 },
  title: { fontSize: 25, fontWeight: "900", letterSpacing: -0.7 },
  gameIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  stats: { flexDirection: "row", alignItems: "center", borderRadius: 20, paddingVertical: 12, borderWidth: 1 },
  stat: { flex: 1, alignItems: "center", gap: 5 }, statValue: { fontSize: 24, fontWeight: "900" }, statTotal: { fontSize: 14, fontWeight: "700" },
  statLabel: { fontSize: 10, fontWeight: "700", textAlign: "center" }, statDivider: { width: 1, height: 28 },
  attempts: { flexDirection: "row", gap: 4, height: 29, alignItems: "center" },
  court: { flex: 1, minHeight: 130, borderRadius: 26, borderWidth: 1, overflow: "hidden" },
  courtBadge: { position: "absolute", top: 16, alignSelf: "center" }, courtBadgeText: { fontSize: 11, fontWeight: "600" },
  power: { position: "absolute", bottom: 16, right: 16, width: 92, padding: 10, borderRadius: 12, gap: 7 },
  powerTrack: { height: 4, borderRadius: 3 },
  celebration: { position: "absolute", top: "27%", left: "48%", alignItems: "center" }, plus: { fontSize: 30, fontWeight: "900" },
  feedback: { alignItems: "center", gap: 5, minHeight: 85, justifyContent: "center" },
  feedbackTitle: { fontSize: 20, fontWeight: "900" }, feedbackBody: { fontSize: 12, lineHeight: 17, textAlign: "center", maxWidth: 340 },
  next: { minHeight: 44, borderRadius: 15, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  nextText: { fontSize: 13, fontWeight: "800" }, countdown: { fontSize: 18, fontWeight: "800" },
  notice: { borderTopWidth: 1, paddingTop: 10, paddingBottom: 8, gap: 4 },
  previewLabel: { fontSize: 10, fontWeight: "800", textAlign: "center" }, noticeText: { fontSize: 10, lineHeight: 14, textAlign: "center" }
});
