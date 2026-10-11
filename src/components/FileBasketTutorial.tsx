import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Path } from 'react-native-svg';
import type { Language } from '../i18n';
import type { AppTheme } from '../theme';
import { FileBasketHoop } from './FileBasketHoop';
import { predictShot } from '../game/fileBasketPhysics';
const languages: Language[] = ['en', 'tr', 'zh', 'fr', 'ru', 'de', 'es'];
const texts = [
  ['How to play', 'Touch the file', 'Drag upward to set angle and power', 'Follow the dotted flight path', 'Release to shoot', '3 shots every 24 hours. Each round can earn 1 hit. 5 hits = 1 preview cloud credit. No real credit is granted yet.', 'Skip', 'Next', 'Play', 'Guide'],
  ['Nasıl oynanır?', 'Dosyaya dokun', 'Açı ve güç için yukarı sürükle', 'Noktalı uçuş yolunu izle', 'Atış için parmağını bırak', 'Her 24 saatte 3 atış. Tur başına en fazla 1 isabet. 5 isabet = 1 önizleme bulut hakkı. Henüz gerçek hak verilmez.', 'Geç', 'İleri', 'Oyna', 'Rehber'],
  ['玩法', '触摸文件', '向上拖动以设置角度和力度', '观察虚线飞行路径', '松手投篮', '每24小时3次投篮，每轮最多1分。5分=1个预览云转换次数，暂不发放真实奖励。', '跳过', '下一步', '开始', '指南'],
  ['Comment jouer', 'Touchez le fichier', 'Glissez vers le haut pour viser et doser', 'Suivez la trajectoire pointillée', 'Relâchez pour tirer', '3 tirs par 24 h. Au plus 1 point par tour. 5 points = 1 crédit cloud en aperçu, sans crédit réel.', 'Passer', 'Suivant', 'Jouer', 'Guide'],
  ['Как играть', 'Коснитесь файла', 'Тяните вверх для направления и силы', 'Следите за пунктирной траекторией', 'Отпустите для броска', '3 броска за 24 часа. Не более 1 очка за раунд. 5 очков = 1 пробный облачный кредит, без реальной награды.', 'Пропустить', 'Далее', 'Играть', 'Обучение'],
  ['So wird gespielt', 'Datei berühren', 'Für Winkel und Kraft nach oben ziehen', 'Gepunkteter Flugbahn folgen', 'Zum Werfen loslassen', '3 Würfe alle 24 Stunden. Höchstens 1 Punkt pro Runde. 5 Punkte = 1 Cloud-Guthaben in der Vorschau, kein echtes Guthaben.', 'Überspringen', 'Weiter', 'Spielen', 'Anleitung'],
  ['Cómo jugar', 'Toca el archivo', 'Arrastra hacia arriba para apuntar y dar fuerza', 'Sigue la trayectoria de puntos', 'Suelta para lanzar', '3 tiros cada 24 horas. Máximo 1 punto por ronda. 5 puntos = 1 crédito de nube de vista previa, sin premio real.', 'Omitir', 'Siguiente', 'Jugar', 'Guía']
];
export function tutorialCopy(language: Language) { return texts[languages.indexOf(language)] ?? texts[0]; }
export function FileBasketTutorial({ theme, language, onDone }: { theme: AppTheme; language: Language; onDone: () => void }) {
  const copy = tutorialCopy(language);
  const [step, setStep] = useState(0);
  const value = useRef(new Animated.Value(0)).current;
  const [sample, setSample] = useState(0);
  const path = predictShot({ x: 131, y: -620 });
  useEffect(() => {
    value.setValue(0);
    const id = value.addListener(({ value: progress }) => setSample(progress));
    const animation = Animated.loop(Animated.sequence([Animated.timing(value, { toValue: 1, duration: 1500, useNativeDriver: false }), Animated.delay(700), Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: false })]));
    animation.start();
    return () => { animation.stop(); value.removeListener(id); };
  }, [step, value]);
  const point = step === 3 ? path[Math.min(path.length - 1, Math.floor(sample * path.length))] : { x: 70 + (step > 0 ? sample * 35 : 0), y: 432 - (step > 0 ? sample * 160 : 0) };
  return <View testID="basket-tutorial" style={styles.overlay} accessibilityViewIsModal>
    <ScrollView contentContainerStyle={[styles.card, { backgroundColor: theme.colors.surface }]} style={styles.scroll}>
      <Text style={[styles.title, { color: theme.colors.text }]}>{copy[0]}</Text>
      <View style={[styles.demo, { backgroundColor: theme.colors.primarySoft }]} pointerEvents="none">
        <Svg width="100%" height="140" viewBox="30 80 300 400">
          {step >= 2 ? path.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={3} fill={theme.colors.primary} opacity={0.5} />) : null}
          <FileBasketHoop theme={theme} entered={step === 3 && sample > 0.8} success={false} impact={0} />
          <Path d={`M ${point.x - 10} ${point.y - 14} h 14 l 8 8 v 22 h -22 Z`} fill={theme.colors.primary} />
          {step < 3 ? <Circle cx={point.x + 10} cy={point.y + 16} r={14 + (step === 0 ? sample * 5 : 0)} fill="none" stroke={theme.colors.text} strokeWidth={3} /> : null}
        </Svg>
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.step, { color: theme.colors.primary }]}>{step + 1} / 4 · {copy[step + 1]}</Text>
      <Text style={[styles.rules, { color: theme.colors.muted }]}>{copy[5]}</Text>
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" onPress={onDone} style={styles.button}><Text style={{ color: theme.colors.muted }}>{copy[6]}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => step === 3 ? onDone() : setStep(step + 1)} style={[styles.button, { backgroundColor: theme.colors.primary }]}><Text style={{ color: theme.colors.onPrimary, fontWeight: '800' }}>{copy[step === 3 ? 8 : 7]}</Text><Feather name="arrow-right" color={theme.colors.onPrimary} size={18} /></TouchableOpacity>
      </View>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({ overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: 'rgba(10,12,24,0.8)', padding: 20, justifyContent: 'center', alignItems: 'center' }, scroll: { maxHeight: '100%', width: '100%', maxWidth: 420, flexGrow: 0, borderRadius: 24 }, card: { padding: 20, gap: 14 }, title: { fontSize: 22, fontWeight: '900' }, demo: { borderRadius: 18, height: 140, overflow: 'hidden' }, step: { fontSize: 16, fontWeight: '800' }, rules: { fontSize: 13, lineHeight: 20 }, actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, button: { minHeight: 44, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', flexDirection: 'row', gap: 10 } });
