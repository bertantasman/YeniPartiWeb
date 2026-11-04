# YeniParti Yönetim Paneli

Gerçek Firebase projesi: `bertantasman-yeniparti`. Panel Firebase Authentication ile giriş yapar; kullanıcı işlemleri `us-central1` bölgesindeki `webAdminUsers` callable fonksiyonuna gider. Oturum açılmadığında panel salt okunur örnek verilerle doğrudan açılır. Arama, filtreleme ve roller ekranı kullanılabilir. Gerçek kullanıcıları görmek veya değiştirmek için üstteki Yönetici girişi düğmesi kullanılır. Önizleme modunda Firebase kullanıcı verisi okunmaz ve yazılmaz.

## Çalıştırma

```sh
npm ci
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

`http://localhost:4173` adresinde, mevcut iOS uygulamasındaki hesabınızla giriş yapın. `users/{uid}.role` alanı `admin` olmalıdır. Normal kullanıcı ve teşkilat yöneticisi rolü tek başına panele giriş yetkisi vermez. Şifre veya servis hesabı anahtarı kaynak koda eklenmez. Analytics başlatılmaz.

## Yönetim işlemleri

- Firestore kullanıcı profilleri sayfalanarak listelenir; profili olmayan Auth hesapları bu listeye dahil değildir.
- Katılım raporu Excel çıktısı `Katılım durumu`, `Katılanlar` ve `Katılmayanlar` sekmelerinde her onaylı üyeyi etkinlik bazında isim, telefon, e-posta ve durumuyla gösterir.
- Kullanıcı oluşturma: Auth hesabı ve aynı UID altında profil oluşturulur. En az 12 karakterlik başlangıç şifresi gerekir. Kullanıcı onayı, telefon veya ad/soyad alanları varsayılmaz. Hesap profil hazır olana kadar kapalıdır; tekrar deneme aynı işlem kimliğini kullanır.
- Ad ve `admin` / `user` rolü güncellenir. E-posta bu panelde değiştirilmez. Güncellenen ad Firestore `displayName` alanıdır; mevcut ayrı ad/soyad alanları korunur.
- Silme: kendi hesabını silme engellenir. Teşkilat üyeliği olan hesaplar önce iOS yönetiminden üyelikten çıkarılmalıdır. Auth hesabı ve profil silinir; geçmiş katılım kayıtları korunur. Bu işlem tüm kişisel verileri silme iş akışı değildir.
- Silme yarıda kalırsa profil `deletionPending` olarak işaretli kalır ve yeniden silme denenebilir.
- Son yöneticinin rolünün kaldırılması ve kişinin kendi yönetici yetkisini kaldırması engellenir.
- Sunucu her istekte token, token iptali ve güncel global admin profilini kontrol eder. Mutasyonlarda transaction içinde yeniden yetki kontrol edilir. Dakikada yönetici başına 60 istek sınırı vardır.
- `webAdminAudit` yalnızca işlemi yapan UID, hedef UID, işlem ve zaman tutar. `webAdminLimits` istek sınırını tutar. Mevcut kurallar bu koleksiyonlara istemci erişimi vermez.

## Backend dağıtımı

```sh
npm --prefix functions ci
firebase deploy --project bertantasman-yeniparti --only functions:web-admin:webAdminUsers
```

Ayrı `web-admin` codebase kullanılır. Mevcut iOS fonksiyonları, Firestore kuralları ve indeksler bu komutta değiştirilmez. CORS yalnızca localhost:4173, 127.0.0.1:4173 ve mevcut Sites alan adına izin verir. Web için App Check henüz yapılandırılmamıştır; yetkilendirme Auth ve sunucu profil kontrolüne dayanır.

## İzole test

Java 17 kurulu ortam için Firebase CLI 14 kullanılır:

```sh
npx --yes firebase-tools@14.27.0 emulators:exec --project demo-yeniparti-web --only auth,firestore 'node --test functions/test/management.test.cjs'
```

Testler emülatör ortam değişkenleri olmadan çalışmayı reddeder. Gerçek hesaplar test için oluşturulmaz veya değiştirilmez. Emulator portları Auth 9199 ve Firestore 8180'dir.
