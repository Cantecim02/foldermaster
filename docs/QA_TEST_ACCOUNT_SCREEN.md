# Hesap bazlı Basket test yetkisi ve tam ekran hesap sayfası

İnceleme branch'i: `codex/qa-tester-account-screen`.
Temel commit: `17d44384a5f4f5b2d634393680ec33f4fdc6862f`.
Kaynak değişiklikleri bu geliştirme branch'inde GitHub incelemesi için kaydedilir. Canlı sistemler, gerçek kullanıcı DB'si ve
website değişmedi; EAS build/submission/deploy çalıştırılmadı. Bu belge önceki ayrı QA bundle
identifier önerisinin yerini alır: uygulama kimliği **com.cantecim.editio** olarak kalır.

## Yetkinin kapsamı

`qa_tester` yalnız Basket'in yerel test araçları için bir izindir. Admin, kullanıcı yönetimi,
subscription veya gerçek conversion/billing kotası sıfırlama rolü değildir.
`account_test_permissions` tablosunda immutable user UUID, sabit `qa_tester` ve atama zamanı
saklanır. `account_test_permission_audit` grant/revoke zamanlarını tutar; her ikisi de
users(id) FK + ON DELETE CASCADE kullanır. E-posta veya username allowlist'i yoktur.

Atama için HTTP endpoint yoktur. Register/login strict payload'ları yetki alanı kabul etmez.
`GET /auth/qa-access` yalnız bearer session sahibinin güncel DB yetkisini döndürür.
`POST /auth/qa-access` yalnız `enter/new_round/reset/five_wins/shot/score` işlem isimlerini
kabul edip **aynı oturum sahibinin** yetkisini tekrar doğrular; oyun/DB bakiyesi değiştirmez.
Login/register/me cevaplarındaki permissions bilgisi ekrandaki araçlara tek başına erişim vermez.
Eski build 7 yeni ek alanları görmezden gelebilir; eski API/session/history testleri korunur.

Backend'de varsayılan QA kapalıdır. Açmak için bütün koşullar gerekir:

- `APP_ENV=staging`, `QA_TEST_ACCESS_ENABLED=true`, `MONETIZATION_ENABLED=false`.
- Kanonik, mevcut ve özel `STAGING_ROOT`; DB ve DOWNLOAD_DIR bu root'un ayrı alt yollarında; DB klasörü ile download klasörü birbirini içeremez.
- Depolama yolunda symlink/junction yok; kontrol DB açma veya download cleanup'tan önce yapılır.
- `BIND_HOST=127.0.0.1`, `PORT` 4000 dışında; production hostname olmayan HTTPS public URL.
- Ayrı VM/servis hesabı; üretim disk/paylaşım/env/SMTP/Apple credential erişimi yok.

Bir env değeri gerçek izolasyonun kanıtı değildir. VM/ACL/ağ sınırları operatörce ayrıca
kurulmalı ve incelenmelidir. Bu görev bu operasyonları yapmadı.
Production veya development ortamında atama aracı durur; QA tablosu production startup'ta
oluşturulmaz. Legacy profile schema otomatik migrate edilmez; önceki offline gate değişmedi.
Staging'in güncel auth şemasına yalnız iki additive QA tablosu eklenir; users rebuild edilmez.

## Operatör komutları: yalnız gelecekte onaylı staging üzerinde

Önce [STAGING_SETUP_PLAN.md](STAGING_SETUP_PLAN.md) ile ayrı staging kurulur; bu belgede
komut çalıştırılmaz. Yeni/boş staging DB güncel profil şemasıyla başlar. Gerçek DB kopyası
veya production hesap/şifre kullanmayın. Sentetik kullanıcı kayıt olup kendi server UUID'sini
alır. Backend env, root/paths ve server'ın hangi DB'yi açtığı gözle kontrol edilir.

Staging backend klasöründe mevcut staging env ile, somut UUID ve açık onay:

```powershell
# PLACEHOLDER'ları yalnız incelemiş staging DB yolu ve sentetik kullanıcı UUID'siyle değiştirin.
npm run qa:permission -- --database C:\EditioStaging\data\staging.sqlite --user-id REPLACE_STAGING_USER_UUID --action grant --approve qa-tester-staging
# Yetki iptali:
npm run qa:permission -- --database C:\EditioStaging\data\staging.sqlite --user-id REPLACE_STAGING_USER_UUID --action revoke --approve qa-tester-staging
```

Araç mutlak DB yolu ile config.databasePath eşleşmesini, fileMustExist, gerçek dosya/root,
ID/approval/action, bilinen profile/QA şemasını ve integrity/FK kontrollerini doğrular.
Tüm permission/audit yazıları tek immediate transaction'dır. Var olan grant tekrarında
izin satırı çoğalmaz; audit operatör işlemini kaydeder. Yanlış ID/approval/env/schema hatası
rollback yapar; schema gate gevşetilmez. CLI şifre veya hesap profilini çıktıya yazmaz.
Operatör yetkisi Windows staging servis hesabı/NTFS sınırıdır; uygulama kullanıcısının dosya
sistemine/CLI'ye erişimi olmamalıdır. Bu bir online admin paneli değildir.

## İstemcide canlı erişim ve test verisi

QA modülü yalnız izinli `basket-qa` internal build'de açılabilir. `__DEV__`, e-posta, gizli
hareket, profile'daki qaTester veya frontend flag tek başına izin vermez.
Panel ilk açılışta kapalıdır; güncel bearer session ile server'ın staging/scope/userId/izin
cevabı doğrulanır. Aktif oyun sırasında saniyede bir yenilenir; her test düğmesi ve QA
atış/başarı kaydı ayrıca canlı POST kontrolü ister. Yetki cevabı diskte cache edilmez.

Çıkış, yeni session, hesap silme, ekran kapanması ve background geçişi bellekte hemen
kapatır. Stale in-flight cevaplar generation kontrolüyle atılır. İptal server'da bir sonraki
istekten itibaren etkilidir; panel normal ağda yaklaşık bir saniyede iptali algılar.
Sessiz ağ kaybı için 1500ms lease ve 100ms expiry kontrolü vardır; istek timeout'u 1000ms'dir.
Ağ üzerinden **sıfır gecikmeli** uzak iptal garantisi verilmez. Ağ hatası/401/403/yanlış
scope/userId/production cevabı fail closed'dur. Durmuş controller'ın eski callback'i paneli açamaz.

QA kontrolleri yeni günlük tur, sıfırlama, beş başarılı tur; tur başlangıcı/deneme/puan/
önizleme kredisi/sonraki tur bilgisini ve normal oyuna dönüşü sunar. Komut ve oyun kayıtları
sadece `editio.fileBasket.qa.v1` anahtarına gider. Normal `editio.fileBasket.preview.v1`
ilerlemesi ve gerçek bakiyeler değişmez. ProgressLane kayıt hedefini await'ten önce yakalar;
yetki iptalinde eski QA read/write normal lane'e veya UI'ya geçemez. QA uçuşu iptal olur,
normal kayıt yeniden okunur; bu okuma yazma değildir.

Aynı bundle ID Keychain/AsyncStorage alanını paylaştığı için QA auth token/revocation anahtarı
API adresiyle ayrı namespace kullanır. QA uygulaması eski live tokenı otomatik okumaz veya
staging'e göndermez; normal sürümün mevcut token anahtarı korunur. Normal kullanıcı sentetik
staging hesabıyla giriş yapabilir ama QA panelini göremez. Test için üretim parolası kullanmayın.

## AccountScreen

Ortadaki şeffaf Modal kaldırıldı; App içinde opaque tam ekran AccountScreen üst katmanı
kullanılır. Ana uygulama, seçili sekme/dosyalar ve conversion işleri mounted kalır.
Giriş tamamlandığında yalnız hesap sayfası kapanır; kullanıcı geldiği sekmeye döner.
Ad/soyad opsiyoneldir; email/password/repeat/yaş beyanı/yasal kabul vardır, DOB alanı yoktur.
Server username, çıkış/silme, geçmiş ve monetization izinliyse mevcut abonelik yönetimi korunur.

Header geri düğmesi, erişilebilir auth tab'ları, scroll + KeyboardAvoidingView, input focus
scroll ve yedi dilde geri/güvenlik/şifre gösterme/geçmiş etiketleri bulunur. Eski AccountModal
import'u küçük compatibility export'uyla desteklenir; App artık AccountScreen kullanır.
Legal metin mevcut modal üzerinden sayfanın üstünde açılır; taslak/yaş/kabul kaybolmaz.
Hesap sayfası tamamen kapandığında şifreler temizlenir. HTTP 204 hesap silme başarısı
cihaz temizliğinden ayrı kalır. SecureStore logout okuma hatası da session cleanup/fence
mekanizmasını artık atlamaz.

## Aynı kimlikle test dağıtımı ve TestFlight kararı

| Dağıtım | Bu branch'te QA | Gerekenler / yayın sınırı |
| --- | --- | --- |
| EAS `basket-qa`, internal | İzinli; staging + canlı qa_tester zorunlu | iOS ad hoc provisioning, kayıtlı iPhone UDID; aynı bundle ID |
| Normal production/TestFlight | QA kodu dışlanır | Güncel hesap sayfası test edilebilir; production profilinde QA açılamaz |
| QA araçlı TestFlight Internal Only | Tasarım, henüz EAS akışı oluşturulmadı | Store-signing archive + Apple Internal Only export doğrulaması gerekir |
| Genel App Store | QA kodu dışlanmalıdır | Ayrı QA=false yayın binary'si ve bundle guard; QA binary'si promote edilmez |

[EAS internal distribution](https://docs.expo.dev/build/internal-distribution/) iOS'ta ad hoc
veya enterprise provisioning kullanır; TestFlight ile aynı mekanizma değildir.
[TestFlight](https://docs.expo.dev/submit/testflight/) store distribution build ister.
Apple'ın [TestFlight Internal Only](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
seçeneğiyle işaretli build müşterilere veya external tester'lara gönderilemez. Yerel
`xcodebuild -help` de `testFlightInternalTestingOnly` export key'ini doğruladı; bir archive
veya export/upload yapılmadı.

QA araçlı TestFlight için sonraki adım, mevcut app ID altında özel test export akışını
hazırlayıp Internal Only işaretinin gerçekten artefact/ASC'ye geçtiğini doğrulamaktır.
Mevcut guard bu güvence henüz kurulmadığı için QA=true store/TestFlight profilini reddeder.
Guard'ı production profilinde veya sadece bir env flag'le gevşetmeyin. Bu adım ve build/
submission ayrı kullanıcı talimatı gerektirir. Normal yayın için yeniden QA=false binary
üretilmeli ve JS/Hermes bundle'da panel/controller/qa-access endpoint metni bulunmamalıdır.
QA ayrı EAS Update channel/runtime politikası olmadan OTA ile genel sürüme gönderilmemelidir.

Aynı bundle ID kullanıldığı için test sürümü cihazda mevcut uygulamanın yerini alabilir;
yan yana ayrı uygulama kurulumu bu talimatla yapılmaz. QA storage/auth ayrımı bunun veri
etkisini azaltır, Apple'ın kurulum/sürüm seçimi davranışını değiştirmez.

## Doğrulama ve fiziksel cihaz sınırı

Komutlar: typecheck; test:game; test:auth; test:qa-access; test:account-screen;
test:basket-config; test:monetization; test:routing; test:archive; backend build/test.
Yeni backend testleri yalnız geçici sentetik DB/loopback sunucu kullanır. Component testleri
hesap formunun gerçek submit/silme/legal ve dil/layout dallarını çalıştırır; OS klavyesi
ve fiziksel iPhone SafeArea/Keychain garantisi değildir.

Yerel production iOS JS/Hermes export + bundle guard, normal oyunun kaldığını ve QA panel,
controller, yetki endpoint'i/scope/test storage metinlerinin dışlandığını doğrular.
Bu EAS veya native iPhone build değildir. Küçük iPhone/yatay modda gerçek klavye,
SecureStore kilit durumu, TestFlight kurulum ve gerçek HTTPS staging ağ kesintileri
cihazda ayrıca doğrulanmalıdır. Sosyal giriş yalnız plan olarak kalır.


## Son test sonuçları — 11 Ekim 2026

| Kontrol | Sonuç |
| --- | --- |
| `npm run typecheck` | Başarılı |
| `npm run test:game` | 41 kontrol başarılı |
| `npm run test:auth` | 214 kontrol başarılı |
| `npm run test:qa-access` | 34 kontrol başarılı |
| `npm run test:account-screen` | 141 kontrol başarılı |
| `npm run test:basket-config` | 26 kontrol başarılı |
| `npm run test:monetization` | Başarılı; flag false ve aynı app kimliği korundu |
| `npm run test:routing` | Başarılı |
| `npm run test:legal` | 11 kontrol başarılı |
| `npm run test:archive` | 14 Swift testi + bridge sözleşmesi başarılı |
| Backend `npm run build` / `npm test` | Başarılı / 90 test, 0 hata |
| Yerel production iOS JS/Hermes export + `verify-basket-bundle.cjs` | Başarılı; normal oyun var, QA modülü yok |
| `git diff --check` | Başarılı |

Backend kapsamı eski TestFlight build 7, migration/rollback/backup/FK uyumluluğunu ve yeni
QA staging kapısını içerir. Sentetik HTTP/CLI testi anonim/standart kullanıcıyı, kayıt
payload'ına izin enjekte etmeyi, quota reset işlemini ve iptal edilen yetkiyi reddeder.
Yetki değişimlerinde sessions/history/billing ve users bilgileri değişmez. Beklenmeyen
QA şeması veya özel trigger operatör işlemini de durdurur.

Native ZIP komutu geçici bir Swift scratch-path wrapper ile çalıştırıldı; repository'nin
native kaynakları değiştirilmedi. Tek tekrarda mevcut disk alanı testi başarısız oldu;
test iki kapasite ölçümü arasında yalnız 1 byte ek rezerv kullanıyor ve dış disk alanı
hareketlerinden etkilenebilir. Export işlemi bittikten sonraki tekrar 14/14 geçti.
Bu mevcut flaky test için ayrı bir deterministik disk ölçümü iyileştirmesi değerlendirilebilir.

Gerçek AccountScreen bileşeni, backend çağrısı yapmayan yerel fixture ile tarayıcıda
375×667 ve 667×375 boyutlarında incelendi. TR koyu / EN açık, sekmeler, form scroll,
yasal sayfa açılıp dönüşte taslak koruma kontrol edildi. Görsel fixture ve screenshot
`.tmp` altında ignored kalır, inceleme kaynaklarına dahil değildir. Ana uygulamanın web
önizlemesi mevcut native `react-native-pdf` bağımlılığı nedeniyle çalışmadı; PDF kaynakları
değiştirilmedi. Tarayıcı kontrolü fiziksel iOS klavye veya native SafeArea testi yerine geçmez.

## Sonraki dağıtım sırası — henüz uygulanmadı

1. GitHub'daki bu geliştirme branch'inin kod incelemesini tamamlayın; staging kurulumu için ayrıca onay gerekir.
2. İncelenen yeni revision ile ayrı VM, staging servis hesabı, HTTPS adresi ve boş sentetik
   DB/download dizinlerini hazırlayın. Canlı `127.0.0.1:4000` ve canlı SQLite korunmalıdır.
3. Backend'i önce staging'de doğrulayın; QA varsayılan kapalıdır. İzole stage env'de açın,
   sentetik hesap oluşturun ve yalnız onun UUID'sine açık CLI onayıyla qa_tester atayın.
4. Aynı `com.cantecim.editio` kimliği için `basket-qa` staging adreslerini eşleştirin.
   İlk test yolu EAS internal + ad hoc kayıtlı UDID'dir. TestFlight QA için ayrıca
   Apple Internal Only export/ASC doğrulaması olan test pipeline'ı tamamlanmalıdır;
   mevcut store-QA engelini kaldırmayın. Bu görev bu pipeline veya build'i başlatmadı.
5. Fiziksel iPhone'da küçük ekran/yatay klavye, legal dönüş, Keychain hataları, logout,
   offline/timeout/revoke ve normal/QA ilerleme ayrımını doğrulayın. Aynı bundle kurulumu
   mevcut test uygulamasının yerini alabileceği için sentetik hesapla test edin.
6. Genel yayın yalnız ayrı QA=false binary, monetization=false ve production bundle
   kontrolüyle hazırlanır. QA test build'i genel App Store yayın sürümüne dönüştürülmez.

## Bu görevde değişen kaynak dosyaları

16 mevcut dosya değişti, 12 yeni dosya oluşturuldu (toplam 28). Önceki altı simulator PNG
aynı şekilde untracked kalır. `.env`, anahtarlar, gerçek DB, native/build çıktıları
bu kaynak listesinde yoktur. Commit/push yalnız bu geliştirme branch'ini kaydeder; main merge yapılmaz.

**Değişen mevcut dosyalar**

- `App.tsx`
- `backend/.env.example`
- `backend/package.json`
- `backend/src/config.js`
- `backend/src/routes/accountRoutes.js`
- `backend/src/server.js`
- `backend/src/services/accountService.js`
- `docs/BASKET_ACCOUNT_PREVIEW.md`
- `docs/STAGING_SETUP_PLAN.md`
- `package.json`
- `scripts/run-auth-tests.cjs`
- `scripts/verify-basket-bundle.cjs`
- `src/components/AccountModal.tsx`
- `src/components/FileBasketQaPanel.tsx`
- `src/components/FileBasketScreen.tsx`
- `src/services/authService.ts`

**Yeni dosyalar**

- `backend/scripts/set-qa-tester.js`
- `backend/src/services/qaEnvironment.js`
- `backend/src/services/qaPermissionService.js`
- `backend/tests/qaPermissions.test.js`
- `docs/QA_TEST_ACCOUNT_SCREEN.md`
- `scripts/test-account-screen.cjs`
- `scripts/test-qa-access.cjs`
- `src/components/AccountScreen.tsx`
- `src/game/progressLane.ts`
- `src/services/accountPageCopy.ts`
- `src/services/qaAccessController.ts`
- `src/services/qaAccessService.ts`
