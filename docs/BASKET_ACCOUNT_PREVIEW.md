# Dosya Basket ve üyelik önizlemesi — inceleme teslimi

Branch: `codex/basket-account-preview`; temel: `codex/dosya-basket-stage-1`, `266787b7a74a4b2e1735484ac7243ba99a3dde08`.

Güvenlik incelemesi sonrası geçiş ve doğrulama ayrıntıları: [STAGING_ACCOUNT_ROLLOUT.md](STAGING_ACCOUNT_ROLLOUT.md) ve [SECURITY_COMPATIBILITY_FIXES.md](SECURITY_COMPATIBILITY_FIXES.md).

Bu çalışma kaynak kodu ve geçici test veritabanlarıyla sınırlıdır. Kaynaklar kullanıcı talimatıyla geliştirme branch'inde commit/push edilebilir; canlı DB/backend/website değişikliği, EAS build ve submission bu teslimin parçası değildir. Mevcut TestFlight sürümü değişmez. Monetization ve gerçek oyun ödülleri kapalıdır. Sonraki kurulum için uygulanmamış komutlar: [STAGING_SETUP_PLAN.md](STAGING_SETUP_PLAN.md).

## Oyun

- 360 × 520 normalize saha; 80 birim çember açıklığı, turuncu çember, gri/beyaz file, kenardan görülen şeffaf arkalık, destek demirleri ve açık temada kontrastlı çizgiler. Pota bileşeni fizik motorunun `court` geometrisini kullanır. File giriş/çıkış düzlemleri görselde aynı koordinatlardadır.
- Dosyayı yukarı sürükleme yönü doğrudan hız olur; küçük sahalarda dokunma hassasiyeti daha kontrollüdür. Güç sınırı 640, yerçekimi 650; otomatik hedefleme yoktur. Noktalı yol aynı sabit-adımlı çarpışma çözümünü kullanır. Çember/arkalık sekmesi, file vurgusu, başarı kutlaması ve başarısızlık solması bulunur.
- İlk açılışta animasyonlu dört adımlı rehber; geçme, bitirme ve tekrar açma. Rehber açıkken veya yüklenirken atış engellenir. Rehber kendi anahtarında saklanır; yazma hatası bir sonraki açılışta yeniden rehber gösterir.
- Normal ilerleme `editio.fileBasket.preview.v1` içinde kalır: 24 saatte bir tur, 3 deneme, tur başına 1 puan, 5 puan başına 1 **yerel önizleme** hakkı. Başarısızlık puanları/hakları silmez. Bu hak hiçbir dönüşüm veya billing API’sine gönderilmez.

## QA sınırı

Geliştirme paketinde veya özel `basket-qa` / `distribution: internal` profilinde test menüsü bulunur. Bu profil başka bir profili devralmaz. EDITIO_STAGING_API_URL ile EXPO_PUBLIC_MEDIA_API_URL açıkça aynı HTTPS staging adresine ayarlanmalı; eksiklik, production host, URL kimlik bilgisi ve monetization=true build guard hatası verir. Önce QA moduna geçilir; ilerleme `editio.fileBasket.qa.v1` anahtarına yüklenir. Yeni tur, sıfırlama ve beş başarılı tur simülasyonu sadece bu kopyayı etkiler; çıkınca normal kayıt tekrar yüklenir. Rehber/atış/kayıt işlemi sürerken test kontrolleri engellenir.

Development, preview ve production EAS profillerinde `EXPO_PUBLIC_FILE_BASKET_QA=false` açıkça ayarlıdır. QA true yalnız `basket-qa` internal profilinde kabul edilir. `app.config.js`, Metro ve `eas-build-pre-install` aynı kontrolü çalıştırır. Store/production profilinde flag true veya geçersiz değer otomatik hata üretir. Metro sıradan release paketinde QA modülünü bağımlılıksız boş bileşene yönlendirir; komutlar, metinler ve QA storage anahtarı pakete girmez.

Yerel release incelemesi (EAS build değildir):

```sh
EXPO_PUBLIC_FILE_BASKET_QA=false EXPO_PUBLIC_MONETIZATION_ENABLED=false npx expo export --platform ios --output-dir .tmp/basket-production-bundle
node scripts/verify-basket-bundle.cjs .tmp/basket-production-bundle
```

`basket-qa` App Store/TestFlight genel dağıtımına gönderilmemelidir. QA profili API adresini başka profilden devralmaz; açık staging adresi gerektirir. QA doğrulamasında hesabı/dönüşümleri de test etmek için ayrıca izole staging backend ve test hesapları gerekir. Ayrı native QA bundle identifier henüz hazırlanmadı; mevcut TestFlight uygulamasıyla yan yana kurulum için staging kurulum planındaki native kimlik adımı build öncesi tamamlanmalıdır.

## Kayıt hatası: doğrulanan nedenler ve sınırlar

Canlı servise istek gönderilmedi; tek bir canlı hata kök nedeni iddia edilmez. Yerelde doğrulanan uyuşmazlıklar:

1. Eski ekran şifrenin yalnız dolu/eşit olmasını kontrol ediyordu; backend 10–128 karakter, ASCII büyük/küçük harf ve sayı istiyordu. Frontend artık aynı temel kuralları kontrol eder. Backend sınırı otoritedir; örneğin e-posta için daha sıkı Zod kontrolü sürer.
2. Eski ekran isimleri zorunlu ve sadece dolu kontrol ediyordu; backend farklı isim kuralları kullanıyordu. Yeni alanlar isteğe bağlı, Unicode harfler destekli, en fazla 80 karakterdir.
3. Eski doğum tarihi girişi ay/gün sırasını tahmin ediyordu; seçici 13 yaşı sabit kabul ediyordu, backend ise yapılandırılmış yaş sınırı kullanıyordu. Yeni ekran tam doğum tarihi toplamaz.
4. Backend 400 ve 429, ağ/timeout ve SecureStore hataları genel hata gösteriliyordu. Yeni kod güvenli hata kodlarını çevirir, ham Axios request/response’u veya sunucu mesajını UI hatasına taşımaz. Yedi dilde açıklama vardır. Timeout sırasında kayıt tamamlanmış olabileceğinden önce giriş denemesi önerilir; otomatik kayıt tekrarı yapılmaz.
5. SecureStore yazma hatasında yeni remote session için en iyi çabayla logout yapılır; başarısızsa sunucu expiry son güvencedir. Kilitli/erişilemez store başarılı giriş gibi gösterilmez. Transient `/me` hatası tokenı silmez; 401 siler. Çıkışta sunucuya erişilemese bile cihaz tokenı silinir ve ekran oturumu kapanır; store silinemiyorsa oturum bellekte ve ayrı, kalıcı bir revocation işaretiyle engellenir. Sunucu hesabı silmişse UI başarı gösterir; cihaz temizliği ayrıca uyarılır. İki cihaz deposu da başarısız olursa fiziksel temizlik garanti edilemez; silinmiş hesap tokenı sunucuda zaten geçersizdir.
6. `/auth/me` eski dahili profil nesnesini döndürüyordu; artık register/login ile aynı halka açık alanları döndürür, doğum tarihi dışarı verilmez.

`GET /auth/policy` yeni ekran için `{ minimumAge, registrationVersion: 2 }` döndürür. Ekran politika yüklenmeden kayıt gönderemez; kullanıcı gösterilen yaşı ayrıca onaylar. Sunucu farklı minimumAge alırsa 400 `REGISTRATION_POLICY_CHANGED` verir. Yeni kayıt gövdesi:

```json
{"email":"test@example.com","password":"<user input>","firstName":"","lastName":"","acceptedTerms":true,"ageConfirmed":true,"minimumAge":13}
```

13 burada örnektir, istemcinin sabit kabul ettiği bir yaş değildir. Sunucudaki mevcut `MIN_ACCOUNT_AGE` politikası kullanılır. Sosyal login henüz uygulanmadı/aktif değil; provider SDK veya secret eklenmedi.

**Uyumluluk:** Eski TestFlight istemcisinin birthDate gövdesi ayrı, strict bir şemayla kontrol edilir, yaş hesaplanır ve tarih saklanmadan atılır. Yeni hesaplar `birth_date=NULL` olur. Önceki kullanıcıların tarihleri migration sırasında korunur. Ad/soyad boşsa public API eski istemcinin `.slice()` çağrısını da korumak için boş string döndürür; yeni istemci isim yoksa username, eski server username yoksa email gösterir.

**Dağıtım sırası:** Yeni uygulama mevcut backend’e karşı yeni kayıt yapamaz (`/auth/policy` yoksa anlaşılır uyumluluk hatası). Canlıya çıkmadan önce backend değişikliği ve migration ayrı incelenmeli, staging’de doğrulanmalı ve ayrıca dağıtım yetkisi alınmalı. Bu teslim bunları çalıştırmaz.

## Veritabanı migration ve geri alma

`accountProfileMigration.js`, yalnız açık onaylı offline runner üzerinden SQLite immediate transaction içinde tabloyu yeniden kurar. Backend başlangıcı legacy şemada hazırlık yazısı yapmadan durur. `accountMigrationRunner.js` Online Backup API ile yeni, erişimi kısıtlı yedek oluşturur; kaynak/yedek için integrity_check ve foreign_key_check uygular. Hazırlık ve profil yeniden kurma artık aynı transaction içinde geri alınır. Ayrıntılı komutlar ve bakım penceresi şartı staging planındadır. İsimler ve DOB nullable; username `NOT NULL UNIQUE`. Her hesap için crypto random 128-bit `user-<32 hex>` üretilir. Migration ve yeni kayıtta çakışma yalnız username UNIQUE ihlalinde en fazla 8 kez tekrar edilir; email ve diğer kısıtlar yanlışlıkla çakışma gibi ele alınmaz. Yeni hesap ve session aynı transaction içindedir.

Korunan alanlar: dahili UUID, ayrı Apple appAccountToken, password_hash, email, terms/privacy kabul zamanı/sürümleri, tüm profile timestamps, subscription durumu/sonu ve eski birth_date. Child session/history/subscription bağlantıları taşınırken `foreign_keys` geçici kapatılır, transaction içinde `foreign_key_check` yapılır, eski ayar finally ile geri açılır. Tekrar çalıştırma username değiştirmez. Tam users DDL/constraint kontrolü, tüm VIEW/TRIGGER ve users INDEX tanımı kontrolü bilinmeyen şemayı yakalar; bunlar varsa otomatik veri kaybı yerine manuel inceleme için durur. Username alanı hesabın dahili ID’si veya Apple purchase tokenı değildir.

Gelecekte uygulanacak operasyon sırası:

1. Gerçek dosyanın yolu/env’si ve şema envanteri doğrulanır; servis kontrollü bakım penceresine alınır. SQLite backup API ile tutarlı, erişimi kısıtlı snapshot alınır (WAL açıkken yalnız `.sqlite` dosyasını kopyalamak yeterli değildir).
2. Sentetik staging verisinde offline migration komutu çalıştırılıp ardından yeni kod başlatılır; kullanıcı/sessions/history/billing sayıları ve bağlantıları, login/me/logout/delete, NULL isimler, free/premium tokenları kontrol edilir. Hata varsa transaction rollback yapar; canlıya ilerlenmez.
3. Onaylı bakım penceresinde tüm DB yazarları durdurulup offline migration komutu açık onay ve yeni backup yolu ile çalıştırılır; yalnız başarıdan sonra yeni backend başlatılır. Başlatma başarısızsa servis trafik almaz. Sayım/FK ve eski istemci smoke testleri tekrar edilir. Bu adımlar burada uygulanmadı.
4. Geri alma: migration sırasında yazma kapalıysa tutarlı snapshot ve eski backend birlikte geri yüklenir. Yeni kayıtlar kabul edildikten sonra eski NOT NULL DOB şemasına kayıpsız dönüş **mümkün değildir**; sahte DOB üretmeyin. Yeni şemayı koruyan ileri düzeltme tercih edilir. Snapshot dönüşü gerekiyorsa yeni veri kaybını önleyecek reconciliation/export planı ve ayrıca onay gerekir. Şema eski kodla rastgele geri çevrilmemelidir.

Eski DOB minimizasyonu **ayrı, opt-in operasyon planıdır**, otomatik purge yoktur. Politika/yaş beyanı hukuki incelemeden geçtikten sonra etkilenen hesapların sayısını gösteren dry-run, veri sorumlusu onayı ve ayrı backup ile ilerlenir. Eski tarihlerden tam tarihi saklamadan uygun yaş kontrolü yapıldı kaydı üretme veya kullanıcıdan yeni beyan alma kararı verilir; ardından yalnız ilgili `birth_date` alanları NULL yapılır. WAL/free pages, eski yedekler, retention ve güvenli imha da plana dahildir; SQL NULL fiziksel verinin tüm kopyalarını silmek değildir. Operasyon mevcut hesapları/history/session/subscription satırlarını silmez. Bu görev gerçek tarih silmez.

## Gizlilik, koşullar ve App Store açıklamaları

Uygulamanın TR/EN gizlilik/koşul metinleri ve yerel website/privacy, website/terms, website/assets/js/translations.js dosyaları yeni modele göre hazırlandı; deploy yapılmadı. ZH/FR/RU/DE/ES için mevcut tam İngilizce yasal metin fallback’i günceldir; yeni tam çeviriler hazırlanmadı. Aşağıdakiler yayın öncesi içerik/ürün inceleme listesidir:

- DOB yeni kayıt için artık toplanmıyor; opsiyonel isim, email, server-generated username, yaş beyanı zamanı/sınırı/kaynağı ve kabul sürümleri açıklanmalı. Eski DOB geçişi, retention/yedek silme ve kullanıcı hakları eklenmeli.
- Oyun puanları, günlük tur/deneme zamanı ve önizleme kredileri cihazda yerel tutulur; gerçek bulut bakiye/ödül değildir. Kullanım koşullarında gelecekteki server doğrulaması ayrı aşama olarak belirtilmeli; ödül vaadi yapılmamalı.
- Sosyal giriş aktif olduğunda sağlayıcı subject/issuer, opsiyonel isim/email/relay adresi, güvenli saklanan revoke bilgileri, bağlantı/silme akışı ve sağlayıcılarla veri paylaşımı açıklanmalı.
- App Store Connect App Privacy envanterinde gerçek uygulama/SDK ağ akışlarına göre name/email (Contact Info), internal user identifier (Identifiers) ve conversion metadata/filename kapsamı yeniden değerlendirilmeli. Yerelde kalan oyun verisi toplanmış veri olarak otomatik işaretlenmez. Yaş beyanı/legacyDOB için ilgili kategori, bağlılık, kullanım amacı ve retention hukuki/ürün incelemesiyle kararlaştırılmalı. Toplanmayan finansal/sosyal/oyun sunucu verisi varmış gibi beyan yapılmamalı.
- Mevcut minimum yaş varsayılanı 13, evrensel uyumluluk garantisi değildir. GDPR rızaya dayalı çocukların çevrimiçi hizmetleri için ülkeye göre 13–16 eşiği ve ebeveyn izni şartları bulunabilir. FTC/COPPA uygulamanın çocuklara yönelik olması veya gerçek yaş bilgisi edinmesi gibi koşullara bağlıdır. KVKK hedef ülke, amaç ve veri minimizasyonuyla birlikte uzman tarafından değerlendirilmelidir. Basit yaş checkbox’ı tek başına yasal yeterlilik/yaş doğrulaması iddiası taşımaz. [Avrupa Komisyonu](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data/are-there-any-specific-safeguards-data-about-children_en), [FTC](https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy).

## TestFlight öncesi

- Yerel inceleme, izinli commit/push ve staging backend migration/smoke testleri tamamlanmalı; canlı backend için ayrı dağıtım kararı gerekir.
- Yeni signup ekranını uyumlu staging API ile gerçek iPhone üzerinde; kilitli cihaz/SecureStore, offline, yavaş ağ/timeout, 400/409/429, keyboard, opsiyonel isimler ve 13–18 farklı politika ile test edin.
- Oyun tutorial skip/replay, 3 miss, temiz/kenar/arkalık atışları, tur cooldown, background/kapanış ve ışık/koyu/landscape farklı iPhone oranları elle denenmeli. Tarayıcı doğrulaması fiziksel dokunma ve iOS Keychain’in yerini tutmaz.
- Production profilinde QA=false, monetization=false; yerel iOS export + bundle guard tekrar çalıştırılmalı. QA profili release için kullanılmamalı.
- Sosyal giriş çalışması bu teslimde plan seviyesinde; provider kurulumları ve güvenlik testleri bitmeden buton açılmamalı.
- Yeni build/submission yalnız ayrı kullanıcı talimatıyla başlatılır; App Store incelemesi/genel yayın ayrıca onay gerektirir.

## Yerel doğrulama komutları

```sh
npm run typecheck
npm run test:game
npm run test:auth
npm run test:basket-config
npm run test:routing
npm run test:monetization
npm run test:archive
cd backend
npm run build
npm test
```

Backend integration testleri geçici klasörde test DB’si ve loopback listener kullanır. Migration birim testleri in-memory SQLite kullanır. Native ZIP testleri yerel `.tmp` scratch build cache üzerinden de çalıştırılabilir; kaynak/bridge değişmez. Screenshot, export çıktısı, `.env` ve test veritabanları commit kapsamı değildir.

## İlk önizleme tesliminin sonuçları (güvenlik düzeltmeleri öncesi)

Güncel güvenlik düzeltmesi sonuçları SECURITY_COMPATIBILITY_FIXES.md içindedir; aşağıdaki sayılar ilk önizlemenin tarihsel kaydıdır.

- TypeScript: başarılı.
- Oyun: 41 fizik, üç deneme/24 saat/ödül önizlemesi ve QA izolasyon kontrolü başarılı.
- İstemci hesap akışı: 163 validation, yedi dil mesajı, timeout/network/API hatası, SecureStore ve session davranışı kontrolü başarılı.
- QA dağıtım guard: 8 kontrol başarılı; production flag override ve store dağıtım sızıntısı reddedildi.
- Routing ve monetization doğrulaması: başarılı; tüm ilgili monetization değerleri false.
- Native ZIP/bridge: 14 Swift testi, 0 hata; bridge kontratı başarılı.
- Backend build: başarılı; backend testleri 68/68. Yeni ve eski kayıtlar, 18 yaş politikası, gerçek eski-session/login/history migration entegrasyonu, uniqueness/retry/rollback ve silme ilişkileri dahil.
- Yerel Playwright ekran kontrolü: rehber bitirme/geçme/tekrar açma ve deneme tüketmeme, QA izolasyonu/sıfırlama/beş tur, gerçek sürükleme ile beşinci puan, yeniden açınca cooldown, açık/koyu/küçük/yatay ekranlar başarılı. Kayıt ekranında isimler boş bırakıldı, DOB olmadı, server minimumAge=18 kullanıldı; şifre/yaş hatası, username fallback ve logout geçti. Hesap ekranı API çağrıları yalnız test yanıtlarıyla intercept edildi; canlıya istek gitmedi.
- Production iOS JS/Hermes export: normal oyun mevcut, QA menü metni/komut ve storage anahtarı yok. EAS build/submission değildir. Export sonrası bundle verifier başarılı.

Fiziksel iPhone dokunma hissi ve gerçek iOS SecureStore henüz cihaz üzerinde doğrulanmadı; yukarıdaki TestFlight öncesi kontrol listesi bu ayrımı korur. Sosyal giriş tasarımdır; dış kurulumlar eksiktir. İlk inceleme tesliminde commit/push yapılmamıştı; güncel Git kaydı sonraki teslim raporundadır.

## Değişen kaynak, test ve dokümantasyon dosyaları

- `App.tsx`
- `app.config.js`
- `backend/package.json`
- `backend/src/routes/accountRoutes.js`
- `backend/src/services/accountProfileMigration.js`
- `backend/src/services/accountService.js`
- `backend/src/services/accountValidation.js`
- `backend/tests/account.test.js`
- `backend/tests/accountProfileMigration.test.js`
- `docs/BASKET_ACCOUNT_PREVIEW.md`
- `docs/SOCIAL_LOGIN_PLAN.md`
- `eas.json`
- `metro.config.js`
- `package.json`
- `scripts/run-auth-tests.cjs`
- `scripts/test-basket-config.cjs`
- `scripts/verify-basket-bundle.cjs`
- `scripts/verify-basket-config.cjs`
- `src/components/AccountModal.tsx`
- `src/components/FileBasketHoop.tsx`
- `src/components/FileBasketQaDisabled.tsx`
- `src/components/FileBasketQaPanel.tsx`
- `src/components/FileBasketScreen.tsx`
- `src/components/FileBasketTutorial.tsx`
- `src/game/fileBasketPhysics.ts`
- `src/game/fileBasketQa.ts`
- `src/services/accountValidation.ts`
- `src/services/authErrors.ts`
- `src/services/authMessages.ts`
- `src/services/authService.ts`
- `tests/game.test.ts`
