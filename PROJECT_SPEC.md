# PROJECT SPEC — Lightning Globe

## 1. Vision

Dünya'nın etrafında dolaşan kullanıcı, dünyanın herhangi bir yerindeki yıldırım aktivitesini canlı bir planetary monitoring experience olarak izler.

Hedef his:
- canlı,
- teknolojik,
- atmosferik,
- sinematik,
- sakin ama gerektiğinde dramatik.

Bu bir klasik harita dashboard'u değildir. Küre ana karakterdir.

## 2. Ana ekran

Varsayılan görünüm:
- koyu uzay arka planı,
- 3D Dünya,
- atmosfer,
- gece/gündüz görünümü mümkünse,
- yakın zamanlı yıldırım olayları,
- önemli fırtına kümeleri,
- minimal HUD.

Bilgi yoğunluğu düşük tutulmalıdır.

## 3. Ana kullanıcı senaryosu

Kullanıcı siteyi açar:
1. Dünya görünür.
2. Sistem LIVE durumunu gösterir.
3. Son yıldırım olayları kürede belirir.
4. Yeni önemli aktivite oluşursa olay pipeline'a girer.
5. Kamera kararı verilir.
6. Kamera fırtına bölgesine yumuşak biçimde yaklaşır.
7. Yıldırım flaşları görünür.
8. Event panelinde bölge/zaman/veri bilgisi gösterilir.
9. Sunum biter.
10. Kamera global monitoring görünümüne döner veya olayda kalır.

## 4. Tek yıldırım ile fırtına arasındaki fark

Tek olay:
- küçük ve kısa flash,
- düşük öncelik,
- çoğu zaman otomatik kamera yok.

Küçük aktivite:
- birkaç yakın olay,
- küçük cluster glow,
- isteğe bağlı kamera focus.

Orta fırtına:
- çok sayıda olay kısa zaman aralığında,
- bölgesel activity visualization,
- kamera bölgeye yaklaşır.

Yoğun fırtına:
- yüksek strike density,
- geniş regional framing,
- çoklu flash sequence,
- daha uzun presentation.

Çok geniş sistem:
- kamera daha uzakta kalır,
- bölgesel/continental context gösterilir,
- fırtına hücreleri birlikte görünür.

## 5. Yıldırım veri modeli

Önerilen domain:

LightningEvent:
- id
- source
- timestamp
- latitude
- longitude
- intensity (nullable)
- polarity (nullable)
- peakCurrent (nullable)
- type (nullable)
- altitude (nullable)
- confidence (nullable)
- sourceMetadata
- receivedAt
- updatedAt

Provider hangi alanı vermiyorsa null kalmalıdır.

## 6. Fırtına/aktivite modeli

LightningCluster:
- id
- eventIds
- centroid
- boundingBox
- startTime
- lastEventTime
- eventCount
- strikesPerMinute
- density
- growthRate
- activityScore
- presentationClass

Bu model gerçek meteorolojik storm cell değildir; veri ve algoritma yeterli olmadığı sürece "lightning activity cluster" olarak düşünülmelidir.

## 7. Activity Score

Activity score sunum önceliğidir.

Örnek girdiler:
- son dakikadaki olay sayısı,
- olay yoğunluğu,
- yoğunluğun artış hızı,
- cluster büyüklüğü,
- recency,
- event confidence,
- veri sağlayıcının özel alanları.

Mümkün olduğunca normalize edilmiş [0,1] veya benzeri kontrollü bir aralık kullan.

Skorun anlamı:
"Bu aktivite şu anda ekranda ne kadar dikkat çekmeli?"

Skor:
"Bu fırtına ne kadar tehlikeli?" anlamına gelmez.

## 8. Camera presentation classes

GLOBAL:
Dünya'nın tamamına yakın görünüm.

CONTINENTAL:
Geniş bölgeyi gösterir.

REGIONAL:
Fırtına sistemini ve çevresini gösterir.

LOCAL:
Cluster merkezini yakından gösterir.

MACRO:
Tek flash/olay için yakın plan; otomatik kullanım sınırlı olmalıdır.

Camera class yalnızca event count'a göre değil, cluster geometry ve activity score'a göre belirlenmelidir.

## 9. Kamera mesafesi

Kamera mesafesi:
- globe radius,
- FOV,
- viewport,
- cluster bounding radius,
- desired context

ile hesaplanmalıdır.

Magic number kullanma.

Küçük cluster -> daha yakın.
Büyük cluster -> daha uzak.
Geniş aktivite -> daha geniş framing.

## 10. Cinematic sequence

Önerilen sıra:

IDLE
-> DETECT
-> QUALIFY
-> QUEUE
-> APPROACH
-> FOCUS
-> FLASH_SEQUENCE
-> HOLD
-> EXIT

### APPROACH
Kamera yumuşak şekilde hedefe döner.

### FOCUS
Cluster merkezini stabilize eder.

### FLASH_SEQUENCE
Gerçek olay timestamp'lerine mümkün olduğunca yakın flashlar gösterilir.

### HOLD
Kullanıcı bilgi panelini okuyabilir.

### EXIT
Global görünüme dönülür.

Her süre config'den gelir.

## 11. Flash visual

Bir flash:
- epicenter dot,
- kısa yoğun glow,
- kısa ışık patlaması,
- ince expanding ring,
- isteğe bağlı atmosferik flicker

kullanabilir.

Efekt gerçek yıldırım geometrisini taklit etmek zorunda değildir.

Görsel hedef: "burada az önce bir yıldırım oldu" mesajını çok hızlı vermek.

## 12. Fırtına görseli

Cluster için:
- soft glow,
- density field,
- event trails,
- subtle particle activity,
- pulse/ripple

kullanılabilir.

Aşırı neon kullanma.

Dünya'nın okunabilirliği kaybolmamalıdır.

## 13. Gece/gündüz

İleri aşamada:
- gerçek güneş yönüne göre daylight terminator,
- gece tarafında şehir ışıkları,
- yıldırım flash'ının gece tarafında daha belirgin görünmesi

eklenebilir.

Bunlar ilk MVP için bloklayıcı değildir.

## 14. Event panel

Seçilen/aktif olay için:
- bölge/ülke adı varsa,
- UTC/local timestamp,
- koordinatlar,
- veri sağlayıcısı,
- intensity/current gibi veri varsa,
- event type varsa,
- cluster activity bilgisi

gösterilebilir.

Verilmeyen veri uydurulmaz.

## 15. Kullanıcı kontrolleri

- Auto Focus ON/OFF
- Live Mode
- Pause Presentation
- Reset Globe
- Event Filters
- Recent Activity
- Reduced Motion
- Data Source
- Demo Mode

## 16. Manuel kontrol

Kullanıcı:
- rotate,
- zoom,
- select,
- focus,
- inspect

yapabilir.

Manuel hareket sırasında otomatik director kamera kontrolünü bırakır.

Otomasyon için kısa bir cooldown kullanılabilir.

## 17. Filtreler

Başlangıçta:
- minimum activity,
- time window,
- region,
- automatic focus threshold

yeterlidir.

Filtre mantığı data ingestion'dan sonra uygulanmalıdır; provider query'sine gereksiz biçimde gömülmemelidir.

## 18. Live status

Durumlar:
- CONNECTING
- LIVE
- UPDATING
- STALE
- OFFLINE
- ERROR
- DEMO

Her durum kullanıcıya açıkça ifade edilmelidir.

## 19. Demo

Demo:
- tek strike,
- cluster,
- yoğun storm,
- multi-cluster global scenario

üretebilmeli.

Demo gerçek pipeline'ın aynısını kullanmalıdır.

## 20. Başarı kriteri

Site açıldığında kullanıcı 5 saniye içinde:
- Dünya'yı,
- yıldırım aktivitesini,
- sistemin canlı olup olmadığını

anlayabilmeli.

Yeni önemli aktivitede kamera hareketi "rastgele animasyon" değil, anlamlı bir sunum gibi hissettirmelidir.
