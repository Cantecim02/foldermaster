# Üyelik geçişi: güvenli staging sırası

Bu bir uygulanmamış dağıtım planıdır. Gerçek kullanıcı DB'si, Windows, Apache/XAMPP, Cloudflare, canlı website/backend ve TestFlight bu görevde değiştirilmedi. Sosyal giriş plan, monetization ve gerçek Basket ödülleri kapalıdır.

## Migration mekanizması

Backend başlangıcı legacy users şemasını **otomatik rebuild etmez**; production ve development'ta hazırlık yazılarından önce durur. Boş, yeni DB tek transaction ile güncel profil şemasında oluşturulur. Güncel bilinen şema normal başlar. DDL karşılaştırması yalnız bilinen legacy/güncel users şemasını kabul eder; eski farklı kolon sırası/ALTER varyantları dahil eşleşmeyen DDL için manuel inceleme gerekir. Özel CHECK/UNIQUE/COLLATE, bilinmeyen users index'i veya bilinen isim altında değiştirilmiş index tanımı reddedilir. DB'deki tüm VIEW/TRIGGER'lar konservatif olarak durdurur; başka tablolardaki index/constraint'ler rebuild edilmez ve korunur. Şema gate'ini aşan bir force seçeneği yoktur.

Offline runner, `--approve account-profile-v2`, açık mutlak DB yolu ve **mevcut olmayan** ayrı mutlak backup yolu ister. Default gerçek DB yolu kullanmaz. `fileMustExist` yanlış yolun boş DB oluşturmasını engeller. Yeni backup dosyası exclusive ve POSIX'te 0600 açılır; Windows için ayrıca servis hesabına uygun NTFS ACL gerekir.

[SQLite Online Backup API](https://www.sqlite.org/backup.html), committed WAL verisini içeren tutarlı snapshot sağlar; yalnız ana `.sqlite` dosyasını dosya sistemiyle kopyalamak kullanılmaz. [better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise), runner'ın kullandığı `db.backup()` API'sidir. Kaynak, backup ve migration transaction sonu için [integrity_check ve foreign_key_check](https://www.sqlite.org/pragma.html) ayrı uygulanır; integrity kontrolü tek başına FK kontrolünün yerini tutmaz.

Backup sonrasında source `data_version`/`total_changes` kontrolü immediate write lock altında yapılır; backup sırasında başka yazar kaynakta değişiklik yaptıysa migration başlamaz. Bu kontrol bakım penceresinin yerine geçmez: **tüm DB yazarları durmalıdır**. Hazırlık (eksik token ataması, session/history/index hazırlığı) ve profil rebuild aynı transaction'dadır; hata hepsini geri alır. Mevcut dolu ID/hash/token, eski DOB, timestamps ve çocuk/billing ilişkileri korunur. FK ayarı finally geri açılır. Başarısız rebuild'de doğrulanmış backup korunur; backup oluşturma/doğrulama hatası kaynak şemaya dokunmaz. Yeni username ikinci migration'da değişmez.

## Sentetik staging kurulumu

1. Canlıdan ayrı DB/dosya dizini, servis hesabı ve HTTPS staging API belirle. Canlı kullanıcı verisini kopyalama. Legacy sentetik şema + login hash'i/oturum/history/billing fixture'larıyla migration/yedekten dönüş provasını yap. Bilinmeyen şema çıktısında dur; gate'i gevşetme.
2. Tüm staging DB yazarlarını durdur; offline komut için mutlak yolları incele. Backend klasöründe, yalnız bu ayrı staging DB için örnek komut:

   ```sh
   npm run account:migrate -- --database /ABSOLUTE/STAGING/synthetic.sqlite --backup /ABSOLUTE/PRIVATE-BACKUP/before-profile-v2.sqlite --approve account-profile-v2
   ```

   Backup klasörü önceden hazırlanmalıdır. Örnek yolları gerçek kullanıcı DB'sine çevirmek bu görev kapsamında değildir. Sonuç `backupVerified: true` olmalıdır. Sayım/FK/ID/hash/app-account-token/session/history/billing ilişkilerini karşılaştır, idempotence ve bilinçli failure/rollback provasını doğrula.
3. Başarılı geçişten sonra staging backend'i `BIND_HOST=127.0.0.1`, ayrı `DATABASE_PATH`/`DOWNLOAD_DIR`, `MONETIZATION_ENABLED=false`, doğru staging PUBLIC_BASE_URL ile başlat. TLS/reverse proxy kurulumu bu kaynak görevinin dışında ve henüz yapılmadı. /auth/policy sürüm 2 ve seçilen MIN_ACCOUNT_AGE değerini kontrol et.
4. Güncel backend ile frozen build 7 istemcisinin kayıt/login/me/history/logout/delete akışını ve yeni ad/soyadsız hesapları test et. Eski DOB gönderimi geçici doğrulanır, yeni kullanıcıda saklanmaz; mevcut DOB'lar korunur. Yeni istemciye eski backend 404 policy sonucu verildiğinde güncelleme/servis uyumluluk uyarısı gösterilmeli ve kayıt kapalı kalmalı. Gerçek dağıtılmış build 7 production URL'sine sabit olabilir; onu canlı veriye karşı çalıştırma. Eşdeğer staging istemcisi ve fiziksel cihaz testi yayın öncesi gereklidir.
5. QA profilinde `EDITIO_STAGING_API_URL` ve `EXPO_PUBLIC_MEDIA_API_URL` aynı staging HTTPS URL'si, QA=true ve monetization=false olmalı. Profil preview/production'dan API devralmaz. EAS değişkenleri ileride **preview ortamında açıkça** kurulmalıdır; bu görev EAS hesabına yazmadı. URL'yi staging olarak beyan etmek DNS/servis sahipliğini ispatlamaz; operatör izolasyonu doğrulamalıdır. Normal ilerleme preview.v1, QA qa.v1 anahtarındadır; bu haklar billing'e gönderilmez.
6. Onaylanmış yeni TR/EN Privacy/Terms içerikleri backend kabul sürümleriyle eşlenmeli: yeni varsayılanlar `2026-10-11`; eski env override'ları ayrıca incelenmeli. Mevcut hesap kabul sürümleri migration'da korunur; toplu yeniden kabul işlemi uygulanmadı. ZH/FR/RU/DE/ES tam İngilizce metin fallback'i kullanır.
7. **Backend önce, iOS sonra:** staging sonuçları ve legal/retention incelemesi onaylandıktan sonra ayrı yetkiyle backend geçişi, uyumluluk kontrolü, legal sayfaların yayınlanması ve en son iOS/TestFlight adımları planlanır. Production QA=false/monetization=false guard ve yerel release export kontrolü tekrar yapılmalıdır. Bu görev commit, build, submission veya deploy başlatmaz.

## Rollback ve saklama

Migration failure transaction rollback yapar; eski backend ancak kaynak şemanın hâlâ legacy olduğu doğrulandıktan sonra açılır. Yazı almamış geçişi geri almak için tüm yazarları durdurup doğrulanmış backup'ı ayrı hedefe aç, integrity/FK/ilişkileri doğrula, uyumlu eski backend ile birlikte geri dön. WAL/SHM sidecar'larını eski snapshot'a yanlışlıkla bağlama. Testler backup'ın legacy şema ve satırlarıyla tek başına açılabildiğini doğrular.

Yeni nullable DOB hesaplar/yazılar kabul edildikten sonra eski NOT NULL şemaya kayıpsız downgrade yoktur. Fake DOB üretme, snapshot geri yükleyip sonraki yazıları sessizce kaybetme. Yeni şemaya ileri düzeltme tercih edilmeli; snapshot dönüşü ayrı veri uzlaştırma/onay planı gerektirir. Legacy DOB purge, backup retention, ödeme kayıtları ve güvenli imha ayrı incelenecek operasyonlardır; bu görev veri silmez.

## Hesap silme sınırları

Yalnız HTTP 204 sunucu silme onayı sayılır. Timeout/ağ hatası sonuç belirsiz uyarısı verir; otomatik silme tekrarı yapılmaz. 401/wrong password başarı değildir. Başarılı silme sonrası UI hemen oturumdan çıkar ve başarı gösterir; SecureStore/history temizliği ayrıca uyarılır. Bellek engeli ve token içermeyen AsyncStorage revocation işareti eski tokenın kullanımını durdurur. Başarılı yeni giriş bu işareti kaldırır. Hem Keychain hem revocation depolaması başarısızsa cihazdaki fiziksel temizliği garanti etmek mümkün değildir; silinmiş hesabın tokenı backend'de yine geçersizdir. App Store aboneliği hesabı silmekle iptal edilmez.
