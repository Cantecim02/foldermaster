import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BasketProgress } from '../game/fileBasketRules';
import { qaFiveWins, qaNewRound, qaReset, qaStorageKey } from '../game/fileBasketQa';
export { qaStorageKey };
export default function FileBasketQaPanel({ active, busy, progress, onToggle, onChange }: { active: boolean; busy: boolean; progress: BasketProgress; onToggle: () => void; onChange: (next: BasketProgress) => void }) {
  return <View style={styles.panel}><Text style={styles.label}>FILE_BASKET_QA_ONLY · local preview</Text>
    <TouchableOpacity disabled={busy} onPress={onToggle}><Text style={styles.button}>{active ? 'Exit QA / Normal oyun' : 'QA test modu'}</Text></TouchableOpacity>
    {active ? <View style={styles.actions}>{[
      ['Yeni günlük tur', () => qaNewRound(progress)], ['Önizlemeyi sıfırla', qaReset], ['5 başarılı tur simüle et', () => qaFiveWins(progress, Date.now())]
    ].map(([label, action]) => <TouchableOpacity key={String(label)} disabled={busy} onPress={() => onChange((action as () => BasketProgress)())}><Text style={styles.button}>{String(label)}</Text></TouchableOpacity>)}</View> : null}
  </View>;
}
const styles = StyleSheet.create({ panel: { padding: 8, backgroundColor: '#302C45', borderRadius: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }, label: { fontSize: 9, color: '#FFCD70' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, button: { color: '#FFFFFF', fontSize: 11, paddingVertical: 7 } });
