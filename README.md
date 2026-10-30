# YeniParti Yönetim Paneli

Türkçe, duyarlı web paneli. Bu sürüm örnek verilerle çalışır; gerçek Firebase kullanıcılarına bağlanmaz. Veriler `yeniparti-admin-demo-v1` anahtarıyla yalnızca tarayıcının localStorage alanında tutulur. Demo yönetim hesabı görsel bir temsildir, kimlik doğrulaması değildir.

## Çalıştırma

Proje klasöründe `python3 -m http.server 4173 --directory dist` komutunu çalıştırın, ardından `http://localhost:4173` adresini açın. Derleme veya bağımlılık kurulumu gerekmez.

## Özellikler

- Kullanıcı ekleme, düzenleme ve onay ile silme
- `admin` ve `user` uygulama rollerini atama
- Son yöneticinin silinmesini veya rolünün düşürülmesini engelleme
- E-posta tekilliği, zorunlu alanlar, arama, rol filtresi ve sayfalama
- Roller ve yetkiler ekranı, mobil görünüm, klavye ve diyalog desteği
- Depolama başarısızsa işlemi kaydedilmiş gibi göstermeme

Teşkilat rolleri, özel rol tanımları, Excel raporları ve gerçek hesap yönetimi bu ilk sürüme dahil değildir. Gerçek bağlantıda kullanıcı oluşturma/silme ve rol atama yalnızca sunucuda yetki kontrolü yapan bir Admin SDK servisi üzerinden uygulanmalıdır. İstemciye servis hesabı anahtarı eklenmemelidir. Mevcut `users/{uid}.role` sözleşmesi korunmalıdır.
