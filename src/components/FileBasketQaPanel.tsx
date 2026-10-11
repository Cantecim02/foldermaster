import { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BasketProgress } from '../game/fileBasketRules';
import { attemptsLeft, roundIntervalMs } from '../game/fileBasketRules';
import { qaFiveWins, qaNewRound, qaReset, qaStorageKey } from '../game/fileBasketQa';
import { QaAccessController, type QaAction, type QaGuard } from '../services/qaAccessController';
import { checkQaAccess } from '../services/qaAccessService';
import { subscribeAccountSession, type AccountUser } from '../services/authService';
import type { Language } from '../i18n';
export { qaStorageKey };
const labels = {
  tr: ['QA test modu', 'Normal oyuna dön', 'Yeni günlük tur', 'Önizlemeyi sıfırla', 'Beş başarılı tur', 'Tur başlangıcı', 'Kalan deneme', 'Puan', 'Önizleme kredisi', 'Sonraki tur'],
  en: ['QA tools', 'Return to normal game', 'New daily round', 'Reset preview', 'Five successful rounds', 'Round started', 'Attempts left', 'Points', 'Preview credits', 'Next round'],
  zh: ['QA 工具', '返回普通游戏', '新一轮', '重置预览', '模拟五次成功', '开始时间', '剩余次数', '分数', '预览额度', '下一轮'],
  fr: ['Outils QA', 'Jeu normal', 'Nouvelle partie', 'Réinitialiser', 'Cinq réussites', 'Début', 'Essais restants', 'Points', 'Crédits de test', 'Prochaine partie'],
  ru: ['Инструменты QA', 'Обычная игра', 'Новый раунд', 'Сброс теста', 'Пять побед', 'Начало раунда', 'Попытки', 'Очки', 'Тестовые кредиты', 'Следующий раунд'],
  de: ['QA-Werkzeuge', 'Normales Spiel', 'Neue Runde', 'Vorschau zurücksetzen', 'Fünf Erfolge', 'Rundenbeginn', 'Versuche', 'Punkte', 'Testguthaben', 'Nächste Runde'],
  es: ['Herramientas QA', 'Juego normal', 'Nueva ronda', 'Reiniciar vista previa', 'Cinco aciertos', 'Inicio de ronda', 'Intentos', 'Puntos', 'Créditos de prueba', 'Próxima ronda']
};
type Props = {
  user: AccountUser | null; language: Language; active: boolean; busy: boolean; progress: BasketProgress;
  onToggle: () => void; onChange: (next: BasketProgress) => void;
  onAccessChange: (guard: QaGuard | null) => void;
};
export default function FileBasketQaPanel({ user, language, active, busy, progress, onToggle, onChange, onAccessChange }: Props) {
  const [allowed, setAllowed] = useState(false);
  const controller = useRef<QaAccessController | null>(null);
  const callbacks = useRef({ onAccessChange }); callbacks.current = { onAccessChange };
  useEffect(() => {
    setAllowed(false); callbacks.current.onAccessChange(null);
    if (!user || process.env.EXPO_PUBLIC_FILE_BASKET_QA !== 'true') return;
    let stopped = false; let pending = false;
    const access = new QaAccessController(user.id, checkQaAccess, permitted => {
      setAllowed(permitted);
      callbacks.current.onAccessChange(permitted ? action => access.verify(action) : null);
    });
    controller.current = access;
    const refresh = async () => {
      if (stopped || pending || AppState.currentState !== 'active') return;
      pending = true;
      try { await access.verify(); } finally { pending = false; }
    };
    void refresh();
    const poll = setInterval(() => void refresh(), 1000);
    const expiry = setInterval(() => access.expire(), 100);
    const stop = () => { stopped = true; access.dispose(); };
    const unsubscribe = subscribeAccountSession(stop);
    const appState = AppState.addEventListener('change', state => {
      access.invalidate();
      if (state === 'active' && !stopped) void refresh();
    });
    return () => { stop(); clearInterval(poll); clearInterval(expiry); unsubscribe(); appState.remove(); controller.current = null; };
  }, [user]);
  if (!allowed || !user) return null;
  const copy = labels[language] ?? labels.en;
  const perform = (action: QaAction, effect: () => void) => {
    if (!busy) void controller.current?.run(action, effect);
  };
  const stamp = (time?: number) => time ? new Date(time).toLocaleString(language) : '—';
  return <ScrollView style={styles.panel} contentContainerStyle={styles.content}>
    <Text style={styles.label}>FILE_BASKET_QA_ONLY · qa_tester · local preview</Text>
    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => active ? onToggle() : perform('enter', onToggle)}><Text style={styles.button}>{active ? copy[1] : copy[0]}</Text></TouchableOpacity>
    {active ? <>
      <View style={styles.actions}>{[
        [copy[2], 'new_round', () => qaNewRound(progress)], [copy[3], 'reset', qaReset], [copy[4], 'five_wins', () => qaFiveWins(progress, Date.now())]
      ].map(([label, action, next]) => <TouchableOpacity accessibilityRole="button" key={String(action)} disabled={busy}
        onPress={() => perform(action as QaAction, () => onChange((next as () => BasketProgress)()))}><Text style={styles.button}>{String(label)}</Text></TouchableOpacity>)}</View>
      <Text selectable style={styles.stats}>{copy[5]}: {stamp(progress.round?.startedAt)} · {copy[6]}: {attemptsLeft(progress, Date.now())} · {copy[7]}: {progress.points} · {copy[8]}: {progress.previewCredits} · {copy[9]}: {stamp(progress.round ? progress.round.startedAt + roundIntervalMs : undefined)}</Text>
    </> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({ panel: { maxHeight: 160, flexGrow: 0, backgroundColor: '#302C45', borderRadius: 12 }, content: { padding: 10, gap: 8 }, label: { fontSize: 9, color: '#FFCD70' }, stats: { color: '#FFFFFF', fontSize: 11, lineHeight: 17 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, button: { color: '#FFFFFF', fontSize: 12, paddingVertical: 8 } });
