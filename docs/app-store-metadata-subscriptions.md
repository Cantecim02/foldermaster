# Editio Subscription Metadata Draft

These drafts must be reviewed against the final App Store Connect products and production build. StoreKit displays the final localized price and billing period.

## Turkish

### App description addition

Editio’yu ücretsiz indirin ve ilk 3 başarıyla tamamlanan dönüşümünüzü ücretsiz yapın. Başarısız veya iptal edilen işlemler ücretsiz hakkınızı tüketmez.

Ücretsiz haklarınızdan sonra aylık veya yıllık Editio Pro ile desteklenen yeni dönüşümlere devam edebilirsiniz. Güncel yerel fiyat ve abonelik dönemi satın alma onayından önce Apple tarafından gösterilir. Mevcut dosya boyutu, güvenlik ve kullanım sınırları tüm planlarda geçerlidir.

Satın alımlarınızı uygulama içinden geri yükleyebilir ve aboneliğinizi Apple abonelik ayarlarından yönetebilir veya iptal edebilirsiniz. Editio hesabı isteğe bağlıdır; dönüşüm yapmak veya Editio Pro satın almak için hesap açmanız gerekmez.

### Editio Pro description

Ücretsiz kullanım hakkından sonra Editio’nun mevcut desteklenen belge, PDF, görsel, ses ve video dönüşüm araçlarında yeni işlemler oluşturmaya devam edin. Aylık ve yıllık seçenekler mevcuttur. Fiyatlar uygulamada App Store tarafından yerel para biriminizle gösterilir.

### App Review Notes

Editio hesabı zorunlu değildir. İnceleme ekibi uygulamayı hesap açmadan kullanabilir.

Test akışı:

1. Dönüştür sekmesinden desteklenen bir dosya seçin.
2. İlk üç başarıyla tamamlanan dönüşüm ücretsizdir. Dosya seçme, iptal, bozuk/desteklenmeyen dosya ve başarısız işlem hak tüketmez.
3. Dördüncü yeni dönüşüm başlatıldığında Editio Pro paywall açılır.
4. Paywall içinde aylık/yıllık StoreKit ürünleri, **Satın Alımları Geri Yükle**, **Aboneliği Yönet**, Gizlilik Politikası ve Kullanım Koşulları bulunur.
5. Ayarlar ekranındaki Editio Pro bölümünden paywall, restore ve yönetim seçeneklerine de ulaşılabilir.

Dosyalar yalnızca kullanıcının istediği işlemi tamamlamak için cihazda veya production backend’de geçici olarak işlenir. Hesaplı geçmişte dosya içeriği değil dönüşüm metadata’sı saklanır. Hesap silme Ayarlar > Editio hesabı içinde bulunur. Hesap silmek Apple aboneliğini iptal etmez; kullanıcıya Apple abonelik ayarlarına giden bağlantı gösterilir.

Demo hesap gerekmez. Sandbox abonelik testi için App Review’un kendi Sandbox ortamı kullanılabilir.

### Subscription review notes

- Subscription group: Editio Pro
- Monthly: `com.cantecim.editio.pro.monthly`
- Yearly: `com.cantecim.editio.pro.yearly`
- Hesap açmak satın alma için zorunlu değildir.
- Fiyatlar hardcode edilmez; StoreKit ürünlerinden gösterilir.
- Restore Purchases paywall ve Ayarlar > Editio Pro içindedir.
- Manage Subscription paywall ve aktif Pro durum kartındadır.
- İptal edilen otomatik yenileme erişimi doğrulanmış dönem sonuna kadar kesmez.
- Refund/revoke ve Server Notifications V2 backend entitlement’ını günceller.

### URLs

- Support: `https://editioapp.com/support`
- Privacy: `https://editioapp.com/privacy`
- Terms: `https://editioapp.com/terms`

## English

### App description addition

Download Editio for free and complete your first 3 successful conversions at no cost. Failed or cancelled operations do not use your free allowance.

After your free conversions, continue creating supported new conversions with a monthly or yearly Editio Pro subscription. Apple shows the current local price and subscription period before purchase confirmation. Existing file-size, security and usage limits apply to every plan.

You can restore purchases in the app and manage or cancel your subscription in Apple subscription settings. An Editio account is optional; you do not need to create one to convert files or purchase Editio Pro.

### Editio Pro description

Continue creating new conversions with Editio’s currently supported document, PDF, image, audio and video tools after the free allowance. Monthly and yearly options are available. The App Store displays prices in your local currency inside the app.

### App Review Notes

An Editio account is optional. Reviewers can use the app without registering.

Test flow:

1. Select a supported file from the Convert tab.
2. The first three successfully completed conversion jobs are free. Picking a file, cancelling, an unsupported/corrupt file, or a failed job does not consume a credit.
3. Starting a fourth new conversion presents the Editio Pro paywall.
4. The paywall contains monthly/yearly StoreKit products, **Restore Purchases**, **Manage Subscription**, Privacy Policy and Terms of Use.
5. The same subscription and restore controls are available from Settings > Editio Pro.

Files are processed on device or temporarily by the production backend only to perform the requested operation. Signed-in conversion history stores metadata, not permanent copies of converted file contents. Account deletion is available under Settings > Editio account. Deleting an Editio account does not cancel an Apple subscription; the app displays a link to Apple subscription settings.

No demo account is required. App Review can use its normal Sandbox purchase environment for subscription testing.

### Subscription review notes

- Subscription group: Editio Pro
- Monthly: `com.cantecim.editio.pro.monthly`
- Yearly: `com.cantecim.editio.pro.yearly`
- An account is not required to purchase.
- Prices are read from StoreKit and are not hardcoded.
- Restore Purchases is available in the paywall and Settings > Editio Pro.
- Manage Subscription is available in the paywall and active Pro status card.
- Turning off renewal does not remove access before the verified period end.
- Refund/revoke events and App Store Server Notifications V2 update the backend entitlement.

### URLs

- Support: `https://editioapp.com/support`
- Privacy: `https://editioapp.com/privacy`
- Terms: `https://editioapp.com/terms`

## App Privacy disclosure checklist

Confirm these answers from the exact submitted build:

- Optional account: name, email address, date of birth, Editio user ID.
- Support: name, email, message and optional attachment.
- Conversion processing: user-selected files are temporarily processed for App Functionality.
- Signed-in history: file name, input/output formats, file size, status and date.
- Billing: product ID, original/latest transaction identifiers, entitlement status, expiration/revocation/renewal metadata and free-credit usage.
- Anonymous usage: random installation UUID and free conversion counter.
- Payments are processed by Apple. Editio does not receive card number, CVV, Apple Account password or full payment credentials.
- This implementation contains no advertising and does not use data for tracking.
- Internal diagnostics must remain disabled in the submitted public build unless the privacy answers are updated for a real remote diagnostics service.
