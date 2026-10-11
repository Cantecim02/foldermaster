# Editio güvenlik ve uyumluluk düzeltmeleri — inceleme teslimi

11 Ekim 2026. Branch `codex/basket-account-preview`; HEAD `266787b7a74a4b2e1735484ac7243ba99a3dde08` değişmedi. Mevcut önizleme kaynakları korundu; reset/temizleme/yeniden başlama yapılmadı. Değişiklikler unstaged; commit, push, merge, EAS build, submission ve deploy yapılmadı. Gerçek SQLite veya kullanıcı verisine erişilmedi. Windows/Apache/XAMPP/Cloudflare/canlı site ve backend değiştirilmedi.

## Doğrulanan ve giderilen sorunlar

1. **Yüksek — başlangıç migration'ı ve kısmi commit:** Önceki initializeAccountStore hazırlığı ayrı commit edip otomatik users rebuild yapıyordu. Başlangıç artık legacy şemada hazırlık yazısı yapmadan durur. Açık mutlak yollar ve `account-profile-v2` onayı isteyen offline runner, SQLite Online Backup API ile tutarlı snapshot'ı doğrular. Hazırlık ve rebuild tek immediate transaction'dadır; token atama/index/tablo hazırlığı dahil failure rollback testinde geri alındı. Önce/backup/sonuç integrity ve FK kontrolleri var; backup sırasında başka writer değişikliği lock altında reddedilir. Tekrar çalıştırma usernames/ID/hash/session/history/billing bağlarını bozmaz.
2. **Yüksek — beklenmeyen DDL:** Kolon adlarıyla sınırlı kontrol özel CHECK ve VIEW'leri yeterince yakalamıyordu. Tam bilinen users DDL'si ve literal/constraint'ler kontrol edilir. Tüm VIEW/TRIGGER, bilinmeyen users INDEX veya bilinen index adı altındaki farklı tanım için güvenli durma eklendi. Diğer tablolar rebuild edilmez; constraint ve ilişkileri korunur. Uyumlu olmayan legacy DDL varyantını zorla kabul eden override yoktur.
3. **Uyumluluk:** Build 7 temel commit'inin authService kaynağı sabit test fixture'ına alındı (kaynak SHA-256 dosya başlığında); yeni backend üzerinde eski register/login/me/history/logout/delete fonksiyonları doğrudan çalıştırıldı. Yeni adsız hesap eski istemcinin isim `.slice()` akışını bozmadı. Önceki hesabın gerçek hash'li sentetik session/login/history migration testi de geçti. Yeni istemci policy 404/malformed yanıtında açık güncelleme/uyumluluk uyarısı veriyor. Yeni kayıt DOB saklamıyor; mevcut DOB otomatik purge edilmiyor. Gerçek IPA/fiziksel TestFlight testi yapılmış sayılmaz.
4. **Hesap silme:** Yalnız HTTP 204 æsunucu başarı onayıdır. SecureStore silme hatası bu onayı iptal etmez; UI önce kullanıcı/form durumunu temizler ve başarı gösterir. Cihaz tokenı bellekte engellenir, token içermeyen AsyncStorage revocation işareti restart'ta kullanımını durdurur. History/Keychain temizliği ayrı uyarıdır. Ağ/timeout için belirsiz sonuç mesajı; 401/wrong password için hata korunur. Yazma/okuma/silme ve revocation-store hataları, restart, geç gelen me yanıtı ve eski 401'in yeni login'i temizlememesi test edildi.
5. **Gizlilik/koşullar:** App.tsx ve yerel TR/EN web kaynakları optional ad/soyad, e-posta/username, tam DOB'suz yaş beyanı, beyanın kimlik/gerçek yaş doğrulaması olmadığı ve legacy DOB saklama/geçişini açıklıyor. Hesap silme ödeme kaydı/backup'ın anında tamamen yok olduğu veya abonelik iptal edildiği şeklinde sunulmuyor. Yeni varsayılan TERMS_VERSION/PRIVACY_VERSION `2026-10-11`; mevcut kabul kayıtları korunur. Diğer beş UI dili mevcut tam İngilizce legal fallback'ini kullanıyor; o fallback güncellendi, yeni tam çeviri iddiası yok. Web yayınlanmadı.
6. **QA isolation:** basket-qa preview'ı devralmıyor. Aktif QA profilinde QA=true, monetization=false ve aynı explicit HTTPS EDITIO_STAGING_API_URL/EXPO_PUBLIC_MEDIA_API_URL şart. Eksik staging, production host (port/path/case varyantları dahil), credentials/query/fragment, farklı adres ve monetization override reddediliyor. Staging-only menü komutları QA storage kullanır; normal preview ilerlemesini ve billing bakiyesini değiştirmez. Production bundle'da QA marker/menu/storage anahtarı bulunmadı. Sosyal giriş butonları veya gerçek oyun ödülü açılmadı.

## Yeniden çalıştırılan kontroller

| Komut/kontrol | Sonuç |
| --- | --- |
| npm run typecheck | Başarılı |
| npm run test:game | 41 fizik/ödül önizlemesi/QA kontrolü |
| npm run test:auth | 207 doğrulama, 7 dil mesajı ve session kontrolü |
| npm run test:basket-config | 26 staging/dağıtım/override kontrolü |
| npm run test:routing | Başarılı |
| npm run test:monetization | Başarılı; profil monetization değerleri false |
| npm run test:legal | 11 uygulama dili/web çeviri kontrolü |
| npm run test:archive | 14 native Swift testi, 0 hata; JS/native bridge kontratı başarılı |
| backend npm run build | Başarılı |
| backend npm test | 84 test, 0 hata; 15 yeni migration güvenlik testi ve frozen build 7 entegrasyonu dahil |
| Yerel production iOS Expo export + verify-basket-bundle | Başarılı; normal oyun mevcut, QA kod işaretleri yok |
| Yerel website build | 4 route ve TR/EN çeviriler doğrulandı; MONETIZATION_LIVE=false |
| git diff --check | Başarılı |

Native ZIP için yeni, repo dışı Swift scratch cache kullanıldı. İlk tekrar TypeScript çalışması node_modules/@types içindeki 16 tamamen boş `react 3` vb. kopya klasöründe TS2688 verdi. Bu boş dizinler silinmeden repo dışındaki `editio-empty-types-quarantine-*` geçici klasörüne taşındı; kaynak, tsconfig, lockfile veya asıl bağımlılık paketleri bu sorun için değiştirilmedi. Ardından normal npm run typecheck ve tüm mobil test komutları geçti. Bu ortam sorununun tekrar oluşması bağımlılık/cache bakımı gerektirebilir.

## Bu düzeltme turunda değiştirilen/eklenen 29 dosya

| Alan | Dosyalar (repo köküne göre) |
| --- | --- |
| Migration ve başlangıç | backend/src/services/accountService.js; backend/src/services/accountProfileMigration.js; backend/src/services/accountStoreSchema.js (yeni); backend/src/services/accountMigrationRunner.js (yeni); backend/scripts/migrate-account-profiles.js (yeni) |
| Backend test/config | backend/tests/accountMigrationSafety.test.js (yeni); backend/tests/accountProfileMigration.test.js; backend/tests/account.test.js; backend/tests/fixtures/build7AuthService.cjs (yeni); backend/package.json; backend/src/config.js; backend/.env.example |
| Hesap istemcisi | src/services/authService.ts; src/services/accountDeletion.ts (yeni); src/services/authMessages.ts; src/components/AccountModal.tsx; scripts/run-auth-tests.cjs |
| QA | eas.json; scripts/verify-basket-config.cjs; scripts/test-basket-config.cjs |
| Legal/web | App.tsx; scripts/test-account-legal.cjs (yeni); website/privacy/index.html; website/terms/index.html; website/assets/js/translations.js |
| Komutlar/dokümantasyon | package.json; docs/BASKET_ACCOUNT_PREVIEW.md; docs/STAGING_ACCOUNT_ROLLOUT.md (yeni); docs/SECURITY_COMPATIBILITY_FIXES.md (bu yeni rapor) |

Önceden mevcut, bu turda değiştirilmeden korunan 16 önizleme dosyası: backend/src/routes/accountRoutes.js; src/components/FileBasketScreen.tsx; src/game/fileBasketPhysics.ts; tests/game.test.ts; app.config.js; backend/src/services/accountValidation.js; docs/SOCIAL_LOGIN_PLAN.md; metro.config.js; scripts/verify-basket-bundle.cjs; src/components/FileBasketHoop.tsx; src/components/FileBasketQaDisabled.tsx; src/components/FileBasketQaPanel.tsx; src/components/FileBasketTutorial.tsx; src/game/fileBasketQa.ts; src/services/accountValidation.ts; src/services/authErrors.ts.

Temel commit’e göre tüm branch çalışma ağacı 17 değiştirilmiş ve 28 yeni kaynak/test/dokümantasyon dosyası, toplam 45 dosya içerir; bu turdaki 29 dosya ve önceki 16 dosya yukarıda ayrılmıştır. Eski simulator screenshot'ları ve .env/anahtar/signing/veritabanları kaynak teslimine dahil edilmedi. Önceki editio-code-review.zip bu görevde yeniden üretilmedi; bu rapor ve çalışma ağacı sonraki inceleme için güncel kaynaktır.

## Kalan riskler ve staging adımları

- Gerçek iPhone/Keychain, dağıtılmış build 7 ve yeni native IPA henüz denenmedi. JS/Hermes marker kontrolü imzalı IPA'nın bütün bağımlılıklarını bağımsız denetleyen bir analiz değildir. Yeni EAS build yapılmadı.
- DDL gate konservatif: semantik olarak eşdeğer farklı eski SQL/kolon sırası da durabilir. Staging şema envanteri ve gerekirse manuel incelenmiş ek varyant desteği gerekir. Tüm writer'lar durmalıdır; büyük DB'de integrity/migration süresi ve backup kapasitesi staging'de ölçülmeli.
- İki cihaz deposu da hata verirse fiziksel token temizliği garanti edilemez. Onaylanmış hesap silmesinde sunucu tokenı geçersizdir; bellek engeli oturumun aynı süreçte tekrar kullanılmasını önler. Timeout'un sunucuda bitmiş silmeye mi yoksa başarısız isteğe mi ait olduğu yalnız istemci hatasıyla belirlenemez.
- Staging URL guard DNS alias/servis sahipliği ispatlamaz. Ayrı servis/DB ve erişim izolasyonu operatör tarafından doğrulanmalı; EAS staging environment değişkenleri henüz kurulmadı.
- Legal/retention, eski env legal-version override'ları, App Privacy beyanı ve diğer dillerin tam yasal çevirisi yayın öncesi incelenmeli. Legacy DOB purge ve sosyal provider/revocation uygulaması kapsam dışıdır.

Kurulum sırası: izole sentetik staging DB/API ve özel backup dizini → tüm writer'ları durdur → explicit offline migration + backup/integrity/FK ve geri alma provası → backend'i loopback/monetization=false ile aç → eski/yeni istemci matrisi ve cihaz hata senaryoları → yalnız staging'e bağlı internal QA → legal sürüm/yayın koordinasyonu → ayrı talimatla backend önce, iOS sonra. Komutlar, rollback sınırları ve environment gereksinimleri [STAGING_ACCOUNT_ROLLOUT.md](STAGING_ACCOUNT_ROLLOUT.md) içindedir. Burada dağıtım yapılmadı; inceleme için durulur.
