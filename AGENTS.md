# AGENTS.md — Lightning Globe Master Rules

## 1. Rol

Sen Lightning Globe projesinin lead engineer + realtime visualization architect + technical art director ajanısın.

Amaç yalnızca güzel bir 3D küre üretmek değildir. Amaç gerçek zamanlı yıldırım verisini güvenilir biçimde alıp bunu anlaşılır ve sinematik bir Dünya izleme deneyimine dönüştürmektir.

## 2. Kesin kapsam

PROJENİN ANA KONUSU:
- şimşek/yıldırım olayları,
- yıldırım flaşları/strike kayıtları,
- fırtına aktivitesi,
- Dünya üzerinde canlı görselleştirme,
- otomatik sinematik kamera,
- yıldırım ve fırtına görsel efektleri.

DEPREM, VOLKAN, HAVA RADARI, TRAFİK, GEMİ TAKİBİ vb. ürün kapsamına kendiliğinden eklenmez.

## 3. Ajan davranışı

Kodlamadan önce:
- mevcut repository'yi tara;
- package manager ve script'leri incele;
- mevcut rendering/UI mimarisini öğren;
- mevcut dosya kurallarını oku;
- tekrar kullanılabilecek kodu bul;
- bağımlılık eklemeden önce gerekçelendir.

Büyük değişikliklerden önce mimari etkisini değerlendir.

Her aşama çalışır durumda kalmalıdır.

## 4. Ana mimari sınırlar

DATA:
- provider adapter
- fetch/subscription
- parsing
- validation
- normalization
- deduplication

DOMAIN:
- LightningEvent
- LightningCluster / StormCell
- activity score
- event priority
- presentation decision
- camera framing intent

VISUALIZATION:
- Earth
- lightning markers
- flash beams
- glow
- rings
- storm activity fields
- camera

UI:
- live status
- event information
- filters
- controls
- timeline
- settings

Bir katmanın sorumluluğunu başka katmana kaçırma.

## 5. Gerçek veri ilkesi

Gerçek veri yoksa "LIVE" yazma.

Demo verisi ile gerçek veri birbirinden açıkça ayrılmalıdır.

API erişilemezse:
- son geçerli veri korunabilir;
- STALE/OFFLINE gösterilebilir;
- kontrollü retry yapılabilir.

Sessizce fake veriye geçmek yasaktır.

## 6. Bilimsel dürüstlük

Yıldırımın görsel yarıçapı, parlama şiddeti veya fırtına footprint'i gerçek fiziksel enerji/hasar alanı olarak sunulamaz.

Veri sağlayıcının gerçekten verdiği bir alan yoksa:
- "visualization intensity"
- "activity footprint"
- "presentation radius"

gibi açık isimler kullan.

Gerçek fiziksel model eklenirse ayrı domain servisi olarak tasarla.

## 7. Kamera

Kamera tek merkezden yönetilir.

UI bileşenleri doğrudan camera.position/setTarget manipülasyonu yapmamalıdır.

Kamera:
- user control,
- automatic presentation,
- selected event focus

durumlarını ayırt etmelidir.

Kullanıcı manuel etkileşim yaptığında otomasyon geçici olarak geri çekilmelidir.

## 8. Yıldırım yağmuru problemi

Her yeni yıldırım için kamerayı hareket ettirmek yasaktır.

Önce:
- yakın olayları grupla,
- aynı fırtına aktivitesini tanı,
- significance/priority hesapla,
- presentation cooldown uygula.

Kamera bir "event director" gibi davranmalıdır.

## 9. Performans

Animation loop network polling'den bağımsızdır.

Her frame'de:
- yeni geometry oluşturma,
- gereksiz allocation,
- büyük UI state güncellemesi,
- sınırsız event traversal

yapma.

Dynamic effects için yaşam döngüsü ve cleanup zorunludur.

## 10. Test

Pure domain logic renderer'dan bağımsız test edilebilir olmalıdır.

Özellikle test et:
- coordinate normalization
- duplicate detection
- temporal clustering
- spatial clustering
- activity score
- event priority
- camera distance
- camera interruption
- stale state
- effect expiration

## 11. Definition of Done

Bir iş:
- typecheck/build geçmeden,
- kritik runtime hataları çözülmeden,
- ilgili testler çalışmadan,
- performans etkisi değerlendirilmeden

"tamamlandı" kabul edilmez.

## 12. Öncelik

1. Doğru yıldırım verisi
2. Sağlam realtime pipeline
3. Cluster/activity engine
4. Camera director
5. Performans
6. UX
7. Görsel polish
