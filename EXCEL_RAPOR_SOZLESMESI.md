# YeniParti Katılım Excel Raporu

Bu doküman iOS, Android ve web yönetim panelindeki katılım raporlarının aynı veri sözleşmesini kullanması için hazırlanmıştır.

## Rapor modları

- **Genel tarih aralığı:** Seçilen teşkilat ve başlangıç/bitiş tarihleri arasındaki etkinlikleri tek Excel dosyasında verir.
- **Etkinlik bazlı:** Tek bir etkinlik seçildiğinde yalnızca o etkinliğin katılım detaylarını verir.

Her iki modda da aşağıdaki sayfa adları ve kolon sırası aynı kalmalıdır.

## Excel sayfaları

### Etkinlik özeti

`Etkinlik | Başlangıç | Bitiş | Konum | Durum | Katılan | Onaylı üye | Katılım oranı`

Her satır bir etkinliktir. Katılım oranı `Katılan / Onaylı üye * 100` olarak hesaplanır.

### Katılım durumu

`Etkinlik | Etkinlik tarihi | Ad soyad | Telefon | E-posta | Durum | Katılım saati | Konuma uzaklık (m)`

Her etkinlik için o tarihteki onaylı üyelerin tamamı bulunur. `Durum` değeri yalnızca `Katıldı` veya `Katılmadı` olmalıdır.

### Katılanlar

`Etkinlik | Etkinlik tarihi | Ad soyad | Telefon | E-posta | Durum | Katılım saati | Konuma uzaklık (m)`

`Katılım durumu` sayfasının yalnızca `Katıldı` satırlarından oluşur.

### Katılmayanlar

`Etkinlik | Etkinlik tarihi | Ad soyad | Telefon | E-posta | Durum`

`Katılım durumu` sayfasının yalnızca `Katılmadı` satırlarından oluşur. Katılım saati ve konum uzaklığı boş bırakılır.

### Katılımlar

`Etkinlik | Etkinlik tarihi | Ad soyad | Katılım saati | Telefon | E-posta | Konuma uzaklık (m)`

Yalnızca gerçekten katılım kaydı bulunan üyeleri listeler.

### Kişi bazlı

`Ad soyad | Telefon | E-posta | Katıldığı etkinlik | Toplam etkinlik | Katılım oranı`

Her satır bir üyedir. `Katıldığı etkinlik` alanında etkinlik adları virgülle ayrılır. Katılım oranı `Katıldığı etkinlik / Toplam etkinlik * 100` olarak hesaplanır.

## Veri eşleştirme kuralları

1. Üye ve katılım kayıtları **UID ile** eşleştirilmelidir. Ad, telefon veya e-posta eşleştirme anahtarı değildir.
2. `Onaylı üye`, raporun etkinlik tarihindeki ilgili teşkilatın onaylı üyeleridir.
3. Onaylı üyeye ait katılım kaydı yoksa üye `Katılmadı` kabul edilir.
4. Artık onaylı olmayan kullanıcılar güncel rapora eklenmemelidir.
5. Tarih ve saatler cihazın yerel saat diliminde gösterilebilir; ham Firestore timestamp dışarı verilmemelidir.
6. Konum için yalnızca `Konuma uzaklık (m)` raporlanır; ham GPS koordinatı Excel'e yazılmaz.
7. Genel ve etkinlik bazlı rapor aynı alan adlarını, aynı sayfa isimlerini ve aynı kolon sırasını kullanmalıdır.

## Örnek kayıt mantığı

```text
approvedMembers = teşkilatın onaylı üyeleri
attendanceByUid = etkinliğin katılım kayıtları (uid -> kayıt)

for member in approvedMembers:
  record = attendanceByUid[member.uid]
  if record exists:
    status = "Katıldı"
  else:
    status = "Katılmadı"
```

Web panelindeki mevcut uygulama mantığı `dist/xlsx.js` içindeki `reportSheets(report)` fonksiyonunda bulunmaktadır. iOS ve Android tarafında aynı sonuçları üretmek için bu sözleşme referans alınmalıdır.
