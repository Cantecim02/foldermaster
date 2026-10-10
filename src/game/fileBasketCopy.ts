import type { Language } from "../i18n";

const en = {
  game: "Game", title: "File Basket", subtitle: "A little break. A perfect shot.",
  cardBody: "Aim your file, find the hoop.", close: "Back to Editio", daily: "Daily round",
  points: "Hit points", credits: "Preview credits", preview: "Reward preview · device only",
  notice: "5 hits = 1 cloud conversion in the reward preview. Real conversion balances are unchanged.",
  instruction: "Drag the file up toward the hoop. Release to shoot.", aim: "Aim higher for a longer arc.",
  flying: "On its way…", success: "Nothing but net!", successBody: "+1 hit point. Come back for your next round.",
  creditSuccess: "5 hits! A preview credit is saved.", miss: "Almost!", missBody: "Adjust your angle and try again.",
  ended: "Round complete", endedBody: "Your points are safe. Another round in", next: "Next shot",
  ready: "Ready to shoot", attempts: "shots left", power: "Power", loading: "Loading your court…",
  saving: "Saving your shot…", error: "Game progress could not be saved. Reopen the game to try again.",
  loadError: "Game progress could not be loaded. Try again to preserve your saved points.", retry: "Try again",
  paused: "Shot interrupted", pausedBody: "This shot was used. Your earlier points are safe.",
  target: "Hoop", file: "Draggable file. Drag upward toward the hoop to aim and release to shoot."
};
const tr: typeof en = {
  game: "Oyun", title: "Dosya Basket", subtitle: "Küçük bir mola. Harika bir atış.",
  cardBody: "Dosyanı nişanla, potayı bul.", close: "Editio’ya dön", daily: "Günlük tur",
  points: "İsabet puanı", credits: "Deneme hakkı", preview: "Ödül önizlemesi · yalnızca cihazda",
  notice: "Ödül önizlemesinde 5 isabet = 1 bulut dönüşümü. Gerçek dönüşüm bakiyen değişmez.",
  instruction: "Dosyayı potaya doğru yukarı sürükle. Bırak ve at!", aim: "Uzun bir yay için daha yukarı nişanla.",
  flying: "Potaya doğru…", success: "Tam isabet!", successBody: "+1 isabet puanı. Yeni turda tekrar görüşürüz.",
  creditSuccess: "5 isabet! Bir deneme hakkı saklandı.", miss: "Çok yakındı!", missBody: "Açını değiştir ve tekrar dene.",
  ended: "Tur tamamlandı", endedBody: "Puanların güvende. Yeni tura kalan süre", next: "Sonraki atış",
  ready: "Atışa hazır", attempts: "atış kaldı", power: "Güç", loading: "Sahan hazırlanıyor…",
  saving: "Atış kaydediliyor…", error: "Oyun ilerlemesi kaydedilemedi. Tekrar denemek için oyunu yeniden aç.",
  loadError: "Oyun ilerlemesi yüklenemedi. Kayıtlı puanlarını korumak için tekrar dene.", retry: "Tekrar dene",
  paused: "Atış yarıda kaldı", pausedBody: "Bu atış kullanıldı. Önceki puanların güvende.",
  target: "Pota", file: "Sürüklenebilir dosya. Nişan almak için potaya doğru yukarı sürükle ve atmak için bırak."
};

export function basketCopy(language: Language) { return language === "tr" ? tr : en; }
