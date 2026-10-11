import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from "react-native-svg";
import type { AppTheme } from "../theme";
import type { Language } from "../i18n";
import { basketCopy } from "../game/fileBasketCopy";
import { advanceShot, court, createShot, predictShot, velocityForDrag } from "../game/fileBasketPhysics";
import type { Point, Shot } from "../game/fileBasketPhysics";
import { attemptsLeft, awardHit, beginAttempt, emptyProgress, parseProgress, roundIntervalMs } from "../game/fileBasketRules";
import { FileBasketHoop } from "./FileBasketHoop";
import { FileBasketTutorial, tutorialCopy } from "./FileBasketTutorial";
import type { BasketProgress } from "../game/fileBasketRules";
import type { AccountUser } from '../services/authService';
import type { QaGuard } from '../services/qaAccessController';
import { ProgressLane } from '../game/progressLane';

const QaPanel = require("./FileBasketQaPanel").default as typeof import("./FileBasketQaPanel").default;
const qaStorageKey = require("./FileBasketQaPanel").qaStorageKey as string;
const qaAvailable = process.env.EXPO_PUBLIC_FILE_BASKET_QA === "true";
const tutorialKey = "editio.fileBasket.tutorial.v2";
const storageKey = "editio.fileBasket.preview.v1";
type Phase = "loading" | "ready" | "saving" | "flying" | "miss" | "success" | "paused" | "error" | "loadError";

export function FileBasketScreen({ theme, language, onClose, user }: { theme: AppTheme; language: Language; onClose: () => void; user: AccountUser | null }) {
  const copy = basketCopy(language);
  const window = useWindowDimensions();
  const isLandscape = window.width > window.height;
  const [tutorial, setTutorial] = useState(true);
  const [tutorialLoaded, setTutorialLoaded] = useState(false);
  const tutorialRef = useRef(true);
  const [qaActive, setQaActive] = useState(false);
  const qaActiveRef = useRef(false);
  const qaGuard = useRef<QaGuard | null>(null);
  const progressLane = useRef(new ProgressLane(storageKey));
  const [impact, setImpact] = useState(0);
  const missFade = useRef(new Animated.Value(1)).current;
  const [missOpacity, setMissOpacity] = useState(1);
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
  const canAim = phase === "ready" && left > 0 && tutorialLoaded && !tutorial;

  useEffect(() => {
    const id = missFade.addListener(({ value }) => setMissOpacity(value));
    missFade.setValue(1);
    if (phase === "miss") Animated.timing(missFade, { toValue: 0.35, duration: 550, useNativeDriver: false }).start();
    return () => { missFade.stopAnimation(); missFade.removeListener(id); };
  }, [phase, missFade]);

  function changePhase(next: Phase) {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }

  async function loadProgress() {
    const lane = progressLane.current.capture();
    changePhase("loading");
    try {
      const saved = parseProgress(await AsyncStorage.getItem(lane.key));
      if (!mounted.current || !lane.current()) return;
      progressRef.current = saved;
      setProgress(saved);
      setNow(Date.now());
      changePhase("ready");
    } catch {
      if (mounted.current && lane.current()) changePhase("loadError");
    }
  }

  async function saveProgress(next: BasketProgress) {
    const lane = progressLane.current.capture();
    await AsyncStorage.setItem(lane.key, JSON.stringify(next));
    if (!lane.current()) return false;
    progressRef.current = next;
    if (mounted.current) setProgress(next);
    return true;
  }

  function switchProgress(test: boolean) {
    if (!mounted.current) return;
    progressLane.current.select(test ? qaStorageKey : storageKey);
    cancelFlight();
    qaActiveRef.current = test; setQaActive(test);
    progressRef.current = emptyProgress(); setProgress(progressRef.current);
    setShot(null); setVelocity(null); celebration.stopAnimation(); celebration.setValue(0);
    void loadProgress();
  }
  function updateAccess(guard: QaGuard | null) {
    qaGuard.current = guard;
    if (!guard && qaActiveRef.current) switchProgress(false);
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
    AsyncStorage.getItem(tutorialKey).then(seen => { if (mounted.current) { tutorialRef.current = seen !== 'seen'; setTutorial(seen !== 'seen'); setTutorialLoaded(true); } }).catch(() => { if (mounted.current) setTutorialLoaded(true); });
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
    const lane = progressLane.current.capture();
    frame.current = null;
    if (!final.scored) {
      changePhase("miss");
      return;
    }
    changePhase("saving");
    try {
      if (qaActiveRef.current && !await qaGuard.current?.('score')) return;
      if (!lane.current()) return;
      if (!await saveProgress(awardHit(progressRef.current, roundStartedAt))) return;
      if (!mounted.current) return;
      changePhase("success");
      celebration.setValue(0);
      Animated.timing(celebration, { toValue: 1, duration: 1100, useNativeDriver: true }).start();
    } catch {
      if (mounted.current && lane.current()) changePhase("error");
    }
  }

  async function launch(aim: Point) {
    if (tutorialRef.current || !tutorialLoaded || phaseRef.current !== "ready" || aim.y > -150) return;
    const lane = progressLane.current.capture();
    if (qaActiveRef.current) {
      changePhase('saving');
      if (!await qaGuard.current?.('shot') || !lane.current()) return;
      changePhase('ready');
    }
    const next = beginAttempt(progressRef.current, Date.now());
    if (!next?.round) return;
    const roundStartedAt = next.round.startedAt;
    changePhase("saving");
    setImpact(0); setMissOpacity(1);
    setVelocity(null);
    aimRef.current = null;
    try {
      if (!await saveProgress(next)) return;
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
        const oldImpacts = current.impacts;
        current = advanceShot(current, elapsed);
        setImpact(current.impacts > oldImpacts ? 1 : value => Math.max(0, value - elapsed * 4));
        setShot(current);
        if (current.done) void finishFlight(current, roundStartedAt);
        else frame.current = requestAnimationFrame(animate);
      };
      frame.current = requestAnimationFrame(animate);
    } catch {
      if (mounted.current && lane.current()) changePhase("error");
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
    const aim = velocityForDrag((event.nativeEvent.pageX - drag.current.pageX) / Math.max(scale, 0.75),
      (event.nativeEvent.pageY - drag.current.pageY) / Math.max(scale, 0.75));
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
  const resetShot = () => { setImpact(0); setMissOpacity(1); setShot(null); setVelocity(null); setNow(Date.now()); changePhase("ready"); };

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

  const controlsPanel = (<>
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
  </>);

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
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={tutorialCopy(language)[9]} disabled={phase === "flying" || phase === "saving"} onPress={() => { drag.current = null; aimRef.current = null; setVelocity(null); tutorialRef.current = true; setTutorial(true); }} style={styles.close}><Feather name="help-circle" size={24} color={theme.colors.primary} /></TouchableOpacity>
            <View style={[styles.gameIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="game-controller-outline" size={26} color={theme.colors.primary} />
            </View>
          </View>

          {qaAvailable ? <QaPanel user={user} language={language} onAccessChange={updateAccess} active={qaActive} busy={phase === "flying" || phase === "saving" || phase === "loading" || tutorial} progress={progress}
            onToggle={() => { if ((!qaActiveRef.current && !qaGuard.current) || ["flying", "saving", "loading"].includes(phaseRef.current) || tutorialRef.current) return; switchProgress(!qaActiveRef.current); }}
            onChange={next => { if (!qaActiveRef.current || !qaGuard.current || ["flying", "saving", "loading"].includes(phaseRef.current) || tutorialRef.current) return; const lane = progressLane.current.capture(); changePhase("saving"); void saveProgress(next).then(saved => { if (saved && mounted.current) resetShot(); }).catch(() => { if (mounted.current && lane.current()) changePhase("error"); }); }} /> : null}
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
                  stroke={theme.isDark ? "#B86DA2" : "#8693A7"} strokeWidth={2.5} fill="none" />
                <FileBasketHoop theme={theme} entered={!!shot?.entered} success={phase === "success"} impact={impact} />
                {dots.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={2.3}
                  fill={theme.colors.primary} opacity={1 - index / 55} />)}
                <Ellipse cx={court.launch.x} cy={court.floor} rx={25} ry={5} fill={theme.colors.border} />
                {canAim ? <Circle cx={court.launch.x} cy={court.launch.y} r={32} stroke={theme.colors.primary}
                  strokeWidth={1.5} strokeDasharray="4 6" fill={theme.colors.primarySoft} /> : null}
                <G opacity={missOpacity} transform={`translate(${filePosition.x}, ${filePosition.y}) rotate(${shot && phase === "flying" ? shot.time * 160 : -12})`}>
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

          {isLandscape ? <ScrollView style={styles.controlsLandscape} contentContainerStyle={styles.controlsScroll} showsVerticalScrollIndicator={false}>{controlsPanel}</ScrollView> : <View style={styles.controls}>{controlsPanel}</View>}
          </View>
          {!isLandscape ? noticePanel : null}
          {tutorial && tutorialLoaded ? <FileBasketTutorial theme={theme} language={language} onDone={() => { tutorialRef.current = false; setTutorial(false); void AsyncStorage.setItem(tutorialKey, 'seen').catch(() => { /* Replay next time if persistence is unavailable. */ }); }} /> : null}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18, paddingBottom: 8, gap: 12 },
  playArea: { flex: 1, minHeight: 0, gap: 12 }, playAreaLandscape: { flexDirection: "row" },
  controls: { gap: 10 }, controlsLandscape: { width: "40%", flexGrow: 0 }, controlsScroll: { flexGrow: 1, justifyContent: "center", gap: 10, paddingBottom: 8 },
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
