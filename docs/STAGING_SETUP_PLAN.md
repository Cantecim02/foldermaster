# Editio: uygulanmamış staging kurulum planı

Güncel inceleme branch'i: `codex/qa-tester-account-screen`; temel commit:
`17d44384a5f4f5b2d634393680ec33f4fdc6862f`.
Commit/push yalnız geliştirme kaynaklarını kaydeder. Kurulum için önce kaynak incelemesi ve
ayrı staging kurulum onayı gerekir; **yayınlanmış, onaylı branch ve yeni tam commit SHA** kullanılmalıdır.
Güncel yetki ve aynı uygulama test dağıtımı için [QA_TEST_ACCOUNT_SCREEN.md](QA_TEST_ACCOUNT_SCREEN.md) önceliklidir.
Bu belge komut tarifidir; sunucu, EAS ortamı, Apple hesabı ve deployment işlemleri çalıştırılmadı.
Migration ayrıntıları ve rollback sınırları: [STAGING_ACCOUNT_ROLLOUT.md](STAGING_ACCOUNT_ROLLOUT.md).

## Karar ve sınırlar

Önerilen hedef, üretim makinesinden ayrı bir Windows staging VM/sunucusudur.
Aynı Windows hesabı altında yalnız farklı klasör/port kullanmak üretim verilerine erişimi engellemez.
Üretim makinesinde VM oluşturmak bile ayrı operasyon onayı ve kapasite incelemesi gerektirir.
Bu plan mevcut sunucuda VM oluşturmaz, servis kurmaz veya üretim ACL/firewall ayarlarını değiştirmez.

| Kaynak | Canlı | Önerilen staging |
| --- | --- | --- |
| Backend listener | `127.0.0.1:4000`, korunur | Ayrı VM'de `127.0.0.1:4100` |
| Kaynak klasörü | Mevcut klasör, korunur | `C:\EditioStaging\source` |
| SQLite | Mevcut DB, korunur | `C:\EditioStaging\data\staging.sqlite`, yeni/boş |
| Dosya depolama | Mevcut dizin, korunur | `C:\EditioStaging\downloads` |
| Backup | Canlı backup kopyalanmaz | `C:\EditioStaging\backups`, yalnız sentetik staging verisi |
| HTTPS | Mevcut yönlendirmeler, korunur | Stage VM'ye özel HTTPS hostname, örneğin ayrı `8443` listener |
| Servis hesabı | Mevcut hesap, korunur | Yeni staging hesabı; üretim paylaşımı/credential erişimi yok |
| iOS | `com.cantecim.editio`, korunur | Planlanan `com.cantecim.editio`, aynı uygulamanın test dağıtımı |

VM'ye üretim diskleri, SMB paylaşımları, SQLite/backup dosyaları, `.env`, Apple anahtarları,
SMTP şifreleri veya üretim servis hesabı aktarılmamalıdır. VM runtime ağ politikası üretim
adreslerine/servislerine çıkışı engellemeli; paket kurulumu için gereken geçici erişim ayrıca
tanımlanmalıdır. Test hesabı, dosyası ve ödeme fixture'ları tamamen sentetik olmalıdır.
Production API'ye bağlanarak izolasyon testi yapmayın; VM/network policy incelemesiyle doğrulayın.

## Önce kullanıcının hazırlayacağı bilgiler

1. Ayrı staging VM/host ve yalnız staging için servis hesabı belirleyin. Git ve backend'in
   native bağımlılıklarıyla uyumlu Node.js/npm kurulumunu hazırlayın; yönetici hesabıyla backend çalıştırmayın.
2. iPhone'dan erişilebilen, üretime yönlenmeyen bir HTTPS hostname ve TLS sertifikası belirleyin.
   VPN üzerinden erişim kullanılabilir; iPhone sertifika zincirine güvenmelidir. Uygulamanın
   HTTPS doğrulaması gevşetilmez. Var olan Apache/XAMPP/Cloudflare route'ları kullanılmaz/değiştirilmez.
3. Yeni VM üzerinde yalnız staging girişine izin veren ağ politikasını hazırlayın. Aşağıdaki
   `4100` ve `8443` portları doluysa ilgili servisi durdurmayın; ayrı port seçip bütün staging
   ayarlarını birlikte güncelleyin. iPhone için `127.0.0.1` VM'yi göstermez; HTTPS uç noktası zorunludur.
4. Son rapordaki commit SHA'yı aşağıdaki placeholder yerine girin. Örnek `.invalid` hostname
   gerçek adres değildir; değişmeden kullanılırsa hazırlık komutu durur.

## Gelecekte çalıştırılacak PowerShell: temiz staging checkout

**PowerShell 7.3+ ile, yalnız yeni staging VM'de, staging hesabının yeni oturumunda, kurulum ayrıca onaylandıktan sonra.**
Production makinesinden env/credential devralınmamalıdır. Komutlar mevcut bir klasörü silmez veya resetlemez.

```powershell
$ErrorActionPreference = 'Stop'
$StageRoot = 'C:\EditioStaging'
$ReviewedCommit = 'PASTE_NEW_FULL_COMMIT_SHA_FROM_DELIVERY'
$ReviewedBranch = 'REPLACE_APPROVED_PUBLISHED_BRANCH'
$StageApi = 'https://stage-api.example.invalid:8443'
$StageUri = [uri]$StageApi
if ($ReviewedCommit -notmatch '^[a-f0-9]{40}$') { throw 'Teslim commit SHA gerekli' }
if ($ReviewedBranch -notlike 'codex/*') { throw 'Onaylı, yayınlanmış geliştirme branch gerekli' }
if ($StageUri.Scheme -ne 'https' -or $StageUri.Host.EndsWith('.invalid') -or
    $StageUri.UserInfo -or $StageUri.Query -or $StageUri.Fragment -or
    $StageUri.AbsolutePath -ne '/' -or
    $StageUri.Host -in @('api.editioapp.com', 'editioapp.com', 'www.editioapp.com')) {
    throw 'Ayrı, doğrulanmış staging HTTPS adresi gerekli'
}
if (Test-Path -LiteralPath $StageRoot) { throw 'Hedef zaten var; manuel inceleme gerekli' }
if (Get-NetTCPConnection -LocalPort 4100 -State Listen -ErrorAction SilentlyContinue) {
    throw '4100 dolu; mevcut servise dokunmayın'
}
New-Item -ItemType Directory -Path $StageRoot | Out-Null
foreach ($Directory in @('data', 'downloads', 'backups', 'tls', 'logs')) {
    New-Item -ItemType Directory -Path (Join-Path $StageRoot $Directory) | Out-Null
}
# Yalnız yeni staging dizininin ACL'si; canlı dizinlere uygulanmaz.
$StagePrincipal = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $StageRoot /inheritance:r /grant:r "${StagePrincipal}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Staging ACL kurulamadı' }
git clone --single-branch --branch $ReviewedBranch https://github.com/Cantecim02/foldermaster.git "$StageRoot\source"
if ($LASTEXITCODE -ne 0) { throw 'Git clone başarısız' }
Set-Location "$StageRoot\source"
git checkout --detach $ReviewedCommit
if ($LASTEXITCODE -ne 0) { throw 'İncelenen commit bulunamadı' }
if ((git rev-parse HEAD).Trim() -ne $ReviewedCommit) { throw 'Commit uyuşmuyor' }
if (Test-Path -LiteralPath '.\backend\.env') { throw 'Beklenmeyen backend env dosyası' }
Set-Location '.\backend'
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Bağımlılık kurulumu başarısız' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Backend build başarısız' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Backend testleri başarısız' }
```

Native `better-sqlite3`/Argon2 veya FFmpeg kurulumu başarısızsa burada durun; production'dan
`node_modules`/binary/config kopyalamayın. Bu testler sentetik geçici DB'lerde migration
regresyonlarını çalıştırır; canlı veya staging servis DB'sine migration uygulanmaz.

## Gelecekte çalıştırılacak PowerShell: stage env ve ilk başlatma

Önceki bloktaki değişkenlerle **aynı staging oturumunda**. `.env.example` doğrudan kopyalanmaz:
orada üretime ait herkese açık notification adresleri ve SMTP örnekleri de vardır.
Staging env yalnız aşağıdaki whitelist'ten oluşturulur; SMTP ve Apple credential alanları boş kalır.

```powershell
Set-Location "$StageRoot\source\backend"
if (Test-Path -LiteralPath "$StageRoot\data\staging.sqlite") { throw 'DB zaten var; ilk kurulum durdu' }
if (Test-Path -LiteralPath '.env') { throw 'Env zaten var; üzerine yazılmaz' }
$StageSettings = [ordered]@{
    NODE_ENV = 'production'
    APP_ENV = 'staging'
    QA_TEST_ACCESS_ENABLED = 'true'
    STAGING_ROOT = $StageRoot
    PORT = '4100'
    BIND_HOST = '127.0.0.1'
    PUBLIC_BASE_URL = $StageApi.TrimEnd('/')
    DATABASE_PATH = "$StageRoot\data\staging.sqlite"
    DOWNLOAD_DIR = "$StageRoot\downloads"
    ALLOWED_ORIGINS = ''
    TRUST_PROXY_HOPS = '1'
    MONETIZATION_ENABLED = 'false'
    FREE_CONVERSION_LIMIT = '3'
    MIN_ACCOUNT_AGE = '13'
    TERMS_VERSION = '2026-10-11'
    PRIVACY_VERSION = '2026-10-11'
    SMTP_HOST = ''
    SMTP_USER = ''
    SMTP_PASS = ''
    SMTP_FROM = ''
    SMTP_JSON_TRANSPORT = 'false'
    APPLE_IAP_ISSUER_ID = ''
    APPLE_IAP_KEY_ID = ''
    APPLE_IAP_PRIVATE_KEY_PATH = ''
    APPLE_ROOT_CA_DIRECTORY = ''
    APPLE_NOTIFICATION_PRODUCTION_URL = ''
    APPLE_NOTIFICATION_SANDBOX_URL = ''
}
$StageEnvLines = foreach ($Entry in $StageSettings.GetEnumerator()) {
    # dotenv process env'i override etmez; aynı değer process'e de atanır.
    [Environment]::SetEnvironmentVariable($Entry.Key, $Entry.Value, 'Process')
    "$($Entry.Key)=$($Entry.Value)"
}
# UTF-8 BOM'suz; StageRoot önceden yalnız stage hesabı/SYSTEM erişimiyle oluşturuldu.
[IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'), $StageEnvLines, [Text.UTF8Encoding]::new($false))
node --input-type=module -e 'import {config} from "./src/config.js"; import path from "node:path"; if(config.port!==4100 || config.bindHost!=="127.0.0.1" || config.monetizationEnabled || config.smtpHost || config.appleIapPrivateKeyPath || config.databasePath!==path.resolve(process.env.DATABASE_PATH) || config.downloadDir!==path.resolve(process.env.DOWNLOAD_DIR)) throw Error("Staging config mismatch"); console.log("Staging config verified; no database opened");'
if ($LASTEXITCODE -ne 0) { throw 'Staging config doğrulanamadı' }
# Ayrı kurulum onayından SONRA: bu işlem yalnız yeni staging DB'yi oluşturur.
npm start
```

Servis yöneticisi seçildiğinde çalışma klasörü/env/account aynı olmalı; canlı servis adı,
task veya process tanımı kullanılmamalıdır. `TRUST_PROXY_HOPS=1` yalnız aşağıdaki tek yerel
TLS proxy topolojisi içindir. Başka topolojide bu sayı ayrıca incelenmelidir.
Backend başlatılmadan DOWNLOAD_DIR incelenmelidir: başlangıç temizliği bu dizindeki süresi
dolmuş dosyaları silebilir. Üretim dizinine symlink/junction veya paylaşımlı volume yasaktır.
Boş staging DB güncel şemada başlar; `account:migrate` ilk kurulumda çalıştırılmaz.

## Ayrı TLS listener örneği

Örnek Caddyfile yalnız yeni staging VM içindir. Hostname, VM'nin VPN/interface IP'si ve yeni
staging sertifika yolları operatörce doldurulmalıdır. Placeholder'lı dosyayı çalıştırmayın.
İlgili sertifika hostname'i kapsamalı ve iPhone tarafından güvenilir olmalıdır; anahtar Git'e girmez.

```caddyfile
{
    admin off
    auto_https disable_redirects
}
https://REPLACE_STAGE_HOST:8443 {
    bind REPLACE_STAGE_VM_INTERFACE_IP
    tls C:/EditioStaging/tls/stage-cert.pem C:/EditioStaging/tls/stage-key.pem
    reverse_proxy 127.0.0.1:4100
}
```

İleride seçilen/kurulan staging TLS binary'si için:

```powershell
# Yalnız yeni staging VM; önceden hazırlanmış staging TLS config'i.
caddy validate --config C:\EditioStaging\Caddyfile --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'TLS config geçersiz' }
if (Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue) {
    throw '8443 dolu; mevcut servise dokunmayın'
}
caddy run --config C:\EditioStaging\Caddyfile --adapter caddyfile
```

Bu topoloji 80/443 için redirect listener istemez ve mevcut Apache/Cloudflare yapılandırmasını
kullanmaz. TLS/erişim ayrıntıları seçilen VM/VPN'e bağlıdır; henüz provision edilmemiştir.
[Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) ve
[TLS sertifika/anahtar ayarları](https://caddyserver.com/docs/caddyfile/directives/tls).

Staging açıldıktan sonra ayrı terminalden yalnız yeni staging uç noktalarını doğrulayın:

```powershell
Invoke-RestMethod 'http://127.0.0.1:4100/auth/policy'
Invoke-RestMethod "$($StageApi.TrimEnd('/'))/auth/policy"
# Beklenen: registrationVersion=2, minimumAge=13; ikisi de staging'e gitmeli.
Get-NetTCPConnection -LocalPort 4100 -State Listen | Select-Object LocalAddress, LocalPort
# Beklenen yalnız 127.0.0.1:4100; üretim 4000 portuna yönelik işlem yok.
```

## basket-qa URL hazırlığı (Mac; henüz EAS'a yazılmadı)

`basket-qa` API adresini production/preview profilinden devralmaz; staging URL yoksa fail eder.
`EDITIO_STAGING_API_URL` ile `EXPO_PUBLIC_MEDIA_API_URL` aynı HTTPS adresi olmalıdır.
Staging URL bir sır değildir; `EXPO_PUBLIC_*` değerleri uygulamada görünür.
Mevcut `preview` EAS ortamındaki değişkenlerin diğer profillere etkisini önce inceleyin;
başka bir işi etkileyen değer üzerine yazılmamalıdır. Gerekiyorsa ayrı QA EAS ortamı/projesi
seçimi ayrıca planlanır. Hiçbir üretim credential'i QA ortamına kopyalanmaz.

```sh
# Gerçek staging URL belirlendiğinde, yalnız yerel doğrulama (build oluşturmaz):
export EAS_BUILD_PROFILE=basket-qa
export EXPO_PUBLIC_FILE_BASKET_QA=true
export EXPO_PUBLIC_MONETIZATION_ENABLED=false
export EDITIO_STAGING_API_URL='https://REPLACE_STAGE_HOST:8443'
export EXPO_PUBLIC_MEDIA_API_URL="$EDITIO_STAGING_API_URL"
node scripts/verify-basket-config.cjs
```

Cloud ortamının mevcut değerleri ve kapsamı operatörce incelendikten ve ayrı yetki verildikten
sonra gelecekteki EAS değişken komutları (bu görev çalıştırmadı):

```sh
npx eas-cli env:set --name EDITIO_STAGING_API_URL --value "$EDITIO_STAGING_API_URL" --environment preview --visibility plaintext
npx eas-cli env:set --name EXPO_PUBLIC_MEDIA_API_URL --value "$EXPO_PUBLIC_MEDIA_API_URL" --environment preview --visibility plaintext
```

QA/monetization flag'leri zaten ilgili `eas.json` profilinde true/false olarak tanımlıdır.
Cloud auth hatasında durun; şifre/token çıktısı paylaşmayın.
[EAS environment yönetimi](https://docs.expo.dev/eas/environment-variables/manage/).

## QA iOS dağıtımı: aynı uygulama kimliği

Yeni kullanıcı talimatı önceki ayrı QA uygulaması önerisinin yerini aldı. Bundle identifier,
Keychain grubu ve uygulama kimliği `com.cantecim.editio` olarak kalır. Ayrı App ID/QA uygulaması
oluşturulmaz. Aynı kimliğin test sürümü mevcut kurulumun yerini alabilir; cihazdaki normal
ilerlemeyi korumak için QA yalnız ayrı test storage anahtarını kullanır.

`basket-qa` internal/ad hoc profili aynı uygulamayla, zorunlu staging API ve canlı doğrulanan
`qa_tester` yetkisiyle çalışır. Genel production paketinde QA bağımlılıkları dışlanır.
TestFlight QA için Apple'ın Internal Only export seçeneği ve ayrı yayın güvenlik kontrolü
henüz uygulanmış bir EAS akışı değildir; normal production profilinde QA açılmamalıdır.
Ayrıntılar ve operatör komutları: [QA_TEST_ACCOUNT_SCREEN.md](QA_TEST_ACCOUNT_SCREEN.md).
Bu görev yeni build/submission veya Apple hesabı işlemi yapmaz.

## Kabul, uyumluluk ve durdurma noktaları

- Staging DB/storage/config yolları yalnız yeni VM'ye ait; üretim bağlantıları/secrets/paylaşımları yok.
- Backend monetization=false; gerçek Basket ödül servisi aktif değil. QA verileri ayrı `.qa.v1`
  anahtarında; `.preview.v1` ilerlemesi veya gerçek bakiye değiştirilmez.
- Önce staging backend/policy ve sentetik eski/yeni istemci akışları doğrulanır, sonra QA iOS hazırlığı.
  Build 7'nin frozen istemci testi başarılıdır; gerçek eski TestFlight binary'sinin production URL'si
  değiştirilemez varsayımıyla canlı veriye karşı QA yapılmaz. Fiziksel cihaz/SecureStore kontrolü bekliyor.
- Yeni istemci + eski backend policy 404 durumunda anlaşılır uyarı ve kapalı kayıt beklenir.
- Migration sadece sentetik staging legacy fixture'ında ayrı offline prova/onay ile ele alınır;
  gerçek DB backup veya kullanıcı verisi bu kurulumun parçası değildir.
- Sosyal giriş yalnız plandır; satın alma, gerçek ödül, App Store incelemesi/yayın etkinleştirilmez.
- Rollback, bu yeni staging servislerini durdurmak ve ayrı kaynak revision'ını geri seçmekle sınırlıdır.
  Profil şemasına yeni yazılar geldikten sonra eski şemaya sessiz downgrade yapılmaz; ayrıntılar rollout belgesindedir.
- Host/TLS/VM erişimi, aynı kimlik için test dağıtımı, Apple provisioning ve cihaz testleri tamamlanmadan
  staging hazır veya QA build hazır olarak raporlanmamalıdır.

Commit/push yalnız geliştirme branch'ini kaydeder. `main` merge, server işlemi, migration,
EAS build, submission ve deploy bu teslimin kapsamında yapılmaz.
