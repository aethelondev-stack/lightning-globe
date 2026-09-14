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

## 13. Kanal Kimliği, Markalama ve İletişim Bilgisi (Kalıcı Hafıza)

- **Kanal Adı:** Aethelion - Earth Lightning Live
- **Handle:** @AethelionDev / @AethelionLive
- **Resmi İletişim Maili:** aethelondev@gmail.com
- **Yayın Başlığı Şablonu:**
  `🔴 LIVE: Earth Lightning & Storm Tracker 24/7 | Real-time NOAA Satellites & Thunder Audio`
- **Kanal ve Yayın Açıklaması:**
```text
⚡ Welcome to Aethelion — The 24/7 Real-Time Planetary Lightning & Storm Observatory.

Watch Earth’s real-time lightning strikes, severe storms, and atmospheric discharges visualized live from orbital space perspective. Powered by ground RF sensor networks and geostationary weather satellites (NOAA GOES-16/18 GLM & EUMETSAT MTG).

Features:
• Real-time global lightning tracking (500,000+ persistent strike telemetry)
• Procedural real-time 3D acoustics & thunder soundscapes
• Autonomous cinematic camera tracking active global storm clusters
• Meteorological classifications: Isolated, Multicell, Supercell, Squall Line, MCS

🎵 Ambient Music Credits (Creative Commons):
- Stellardrone (https://stellardrone.bandcamp.com) - Licensed under CC BY
- Scott Buckley (https://www.scottbuckley.com.au) - Licensed under CC BY 4.0
- Kai Engel (https://www.kai-engel.com) - Licensed under CC BY 4.0

🌍 Inquiries / Contact: aethelondev@gmail.com
```

## 14. Altyapı, Sunucu ve API Bilgileri (Kalıcı Hafıza)

- **Oracle Cloud Web Konsolu Girişi:**
  - **Giriş URL:** `https://cloud.oracle.com`
  - **Tenancy / Cloud Account Name:** `aethelondev`
  - **Kullanıcı Adı / E-posta:** `aethelondev@gmail.com`
  - **Web Konsolu Şifresi:** `kX9#vQ7$mP2!wL4@zR8*`
  - **Bölge:** `eu-frankfurt-1` (Frankfurt)
- **Oracle Cloud VPS IP:** `130.61.53.100`
- **Kullanıcı Adı:** `ubuntu`
- **SSH Anahtar Dosyası (Proje Kök Dizini):** `ssh-key-2026-09-10.key`
- **Bağlantı Komutu:**
  `ssh -i "ssh-key-2026-09-10.key" -o StrictHostKeyChecking=no ubuntu@130.61.53.100`
- **Sunucu Dizin Yolu:** `/home/ubuntu/lightning-globe`
- **Sunucu Çalışan Servisleri:**
  - `PM2`: `lightning-vite` (ID 0, Port 3000, Nginx Port 80 arkasında)
  - `PM2`: `kick-chat-bridge` (ID 1)
  - `Xvfb`: Sanal ekran `:99` (1920x1080)
  - `Chromium`: Kiosk modunda arka planda küreyi render ediyor
- **Merkezi Veri & Arşiv Dosyası:**
  `/home/ubuntu/lightning-globe/.cache/lightning_24h.json` (26MB+ 24h gerçek veri)
- **Yerel Eşzamanlama (Sync) Komutu:**
  `npm run sync:vps`
- **Yerel Port:** `http://localhost:3005`

## 15. Fırtına Hücreleri (Storm Cell Radar) Renk Matrisi ve Sınıflandırma Mantığı (Kalıcı Hafıza)

- **7 Meteorolojik Fırtına Sınıfı ve Standart Renk Tablosu:**
  - `ISOLATED` (< 30 vuruş): Buz Beyazı / Kristal Camgöbeği (`#bbf2f6`), yarıçap tabanı 1.35u
  - `SINGLE_CELL` (30-89 vuruş veya 3+ SPM): Elektrik Mavisi / Sky Cyan (`#00e5ff`), yarıçap tabanı 1.75u
  - `MULTICELL` (90-219 vuruş veya 8+ SPM): Canlı Zümrüt Yeşili / Emerald (`#10b981`)
  - `SUPERCELL` (220-499 vuruş veya 22+ SPM): **Saf Plazma Kırmızısı / Ruby Red (`#ff1744`)**
  - `MCS` (500-999 vuruş veya 45+ SPM): **Asil Elektrik Moru / Deep Violet (`#8b5cf6`)**
  - `SQUALL_LINE` (1000-1999 vuruş veya 70+ SPM): **Yoğun Kor Kırmızı / Crimson (`#f43f5e`)**
  - `EXTREME_OUTBREAK` (2000+ vuruş veya 100+ SPM): **Kozmik Parlak Mor / Pulsar Violet (`#d946ef`)**
- **Canlı Yayın Frekans Sınıflandırması (SPM):**
  Canlı tamponda (30s pencere) ham toplam vuruş sayısı 220'ye ulaşamayacağı için, sınıflandırma dakikalık konvektif vuruş hızını (`strikesPerMinute`) hesaba katar. Canlı yayında 22+ SPM üreten fırtınalar kırmızı Süper Hücreye, 45+ SPM üretenler mor MCS'ye dönüşür.
- **Tek Kontur Kuralı:** Tüm petekler `isDoubleStroke: false` ile çizilir (GPU fill-rate ve görsel sadelik testi gereği).
- **Mikro-Petekler (Sub-Hotspots):** 7-rosette alt-çekirdekler ana hücrenin göbeğinde 0.55u yarıçaplı zarif beyaz/cyan lazer aksanı olarak çizilir, ana peteğin kırmızı/mor rengini bastırmaz.

## 16. Kamera Rejisi ve 6 Ölçekli Çeşitlilik (Kalıcı Hafıza)

- **6 Çekim Ölçeği:**
  `VERY_CLOSE (145)`, `CLOSE (175)`, `COUNTRY (220)`, `REGIONAL (195-260)`, `CONTINENTAL (240-310)`, `ATMOSPHERIC / GLOBAL (380)`.
- **Kontrastlı Seçim Kuralı:** Art arda aynı veya yakın iki ölçek seçilmez (`lastPickedScale` hafızası).
- **Gezegen Devriyesi (Interleaved Planetary Overview):** Her 4 doğal fırtına sunumunda 1 kez reji otomatik olarak `GLOBAL (380)` atmosferik yörüngeye yükselerek kıtalar arası sakin bir ufuk turu atar; aynı 2 bölge arasındaki mekik dokumayı kırar.
- **Kıta Çeşitlilik Bonusu:** Son ziyaret edilen kıtaya -1.25 ceza, taze kıtalara +1.10 bonus, 2500+ km uzaktaki sistemlere +0.45 gezinti bonusu uygulanır.

## 17. Veri Akışı ve Çoklu Sensör Entegrasyonu (Kalıcı Hafıza)

- **Sensör Kaynakları ve Rolleri:**
  - `Blitzortung (RF)`: Küresel yer istasyonları ağı; anlık, nanasaniye hassasiyetinde yer vuruşları (CG/IC). Anında (0ms) render kuyruğuna alınır.
  - `NOAA GOES-16 & GOES-18 GLM`: Geostationary hava uyduları; Amerika ve Pasifik optik flaş telemetrisi. AWS S3 açık veri havuzundan `h5wasm` NetCDF-4 motoruyla çözülür.
  - `EUMETSAT MTG-LI`: Avrupa ve Afrika yıldırım görüntüleyici uydu verisi.
  - `Bölgesel Ağlar`: Singapur NEA, Japonya JMA, Finlandiya FMI resmi meteoroloji yayınları.
- **Çapraz Sensör Eşleştirme ve Mükerrer Eleme (Deduplication):**
  - Kriter: Zaman farkı $\Delta t \le 1200\text{ ms}$ ve mesafe $\Delta r \le 18\text{ km}$ ($0.20^\circ$ uzamsal ızgara).
  - RF ve optik flaş aynı anda yakalandığında tekil hibrit (`hybrid`) vuruşa dönüştürülür; çift vuruş patlaması engellenir.
- **24 Saatlik Bellek & Disk Arşivi:**
  - Hem yerelde hem Oracle VPS'te `.cache/lightning_24h.json` dosyasında gerçek 24 saatlik telemetri saklanır.
  - Sabit FIFO kesme kaldırılmıştır; yalnızca 24 saatten eski (`timestamp < 24h`) veriler elenir. Uydular yer istasyonlarını (Avrupa/Asya) bellekten silemez.

## 18. Ses ve Görsel Efekt Motoru (VFX & Procedural Audio)

- **Prosedürel 3D Akustik (`SoundDirector.ts`):**
  - Şimşeğin uzaklığına ve enerjisine (kA) göre fiziksel ses gecikmesi ($v \approx 343\text{ m/s}$ analog ölçekleme), bas rezonansı ve stereo panlama hesaplanır.
- **Ambiyans Müzik Çalar (`BackgroundMusicPlayer.ts`):**
  - Creative Commons (CC BY) lisanslı Stellardrone, Scott Buckley ve Kai Engel parçalarını kesintisiz ve yumuşak geçişle (cross-fade) çalar.
- **Fulgurit 24 Saatlik İz Katmanı (`FulguriteTraceLayer.ts`):**
  - 500.000 kalıcı iz kapasitesi, 5 yoğunluk rengi ve parçalı şeffaflık sönümleme tablosu (piecewise opacity decay).
- **Güneş Işığı Çizgisi (Solar Terminator & Glow):**
  - Gerçek astronomik güneş konumu hesabı (`src/utils/sun.ts`), gece şehir ışıkları ve atmosferik Fresnel ufuk ışıması (AtmosphereGlow).

## 19. OBS Studio ve Yayın Optimizasyonu Rehberi

- **Yerel Önizleme Adresi:** `http://localhost:3005`
- **OBS Tarayıcı Kaynağı:**
  - Genişlik: 1920, Yükseklik: 1080.
  - OBS ayarlarında "Donanım Hızlandırması" (Browser Hardware Acceleration) açık tutulmalıdır.
  - Sayfa yenilemek için: Kaynağa sağ tık -> *Refresh cache of current page*.
- **Bilgisayar Yükünü Düşürme:**
  - OBS önizleme ekranına sağ tıklayıp *Önizlemeyi Devre Dışı Bırak* (Disable Preview) seçilirse GPU/CPU yükü %30-50 azalır.
  - Kullanılmayan YouTube Chat/Panel Dock pencereleri kapatıldığında ~400 MB RAM tasarrufu sağlanır.
- **Yayın Stabilitesi:**
  - Wi-Fi dalgalanmalarına karşı OBS Gelişmiş Ağ Ayarları'nda "Dinamik Bit Hızı" aktif tutulmalı, 6500 kbps CBR tercih edilmelidir.

## 20. Kritik Komutlar ve İş Akışı Referansı

- **Yerel Canlı Başlatıcı:** `CANLI_SIMSEK_BASLAT.bat` (Vite, VPS sync ve OBS kontrolünü tek tıkla yapar)
- **Manuel Dev Sunucusu:** `npx vite --port 3005`
- **Birim & Regresyon Testleri:** `npm test` (109 test, kesinlikle yeşil kalmalıdır)
- **Üretim Derlemesi:** `npm run build` (`tsc && vite build`)
- **VPS Veri Senkronizasyonu:** `npm run sync:vps`
- **VPS PM2 Durumu:** `ssh -i "ssh-key-2026-09-10.key" ubuntu@130.61.53.100 "pm2 status"`
- **VPS Yeniden Başlatma:** `ssh -i "ssh-key-2026-09-10.key" ubuntu@130.61.53.100 "pm2 restart lightning-vite"`

## 21. Proje Durumu ve Sürüm Onayı: Beta_v1 (Tamamlandı)

- **Durum:** **BAŞARIYLA TAMAMLANDI & KULLANICI ONAYLI (GEÇER PUAN ALDI)**
- **Sürüm:** `Beta_v1`
- **Arşiv Tarihi:** 14 Eylül 2026
- **Konum:** `C:\Users\Korhan\Desktop\AG Korhan\Tamamlanan projeler\Lightning_Beta_v1`
- **Tamamlanan & Doğrulanan Temel Yetenekler:**
  1. **Gerçek Zamanlı Küresel Telemetri:** GOES-16/18 GLM NetCDF-4 uydu flaşları, EUMETSAT MTG-LI ve Blitzortung RF istasyonlarının 0ms - kademeli hibrit entegrasyonu.
  2. **540.000+ Kalıcı 24 Saatlik İz Katmanı (`FulguriteTraceLayer`):** `NormalBlending` ile parlama/beyaz patlama (blowout) yapmayan, 4 kademeli zamansal yaş haritası ve küresel gezegen belleği.
  3. **Meteorolojik Fırtına Radarı (`StormCellRadar`):** 7 sınıflı tek konturlu petekler, SPM bazlı Süper Hücre/MCS frekans tespiti ve 7-rosette alt-çekirdek mikro petekler.
  4. **Otonom Sinematik Reji (`CameraDirector`):** 6 çekim ölçeği, kıtasal çeşitlilik kuralı ve her 4 fırtınada bir devreye giren küresel yörünge devriyesi (Interleaved Planetary Patrol).
  5. **Ses & Müzik Motoru:** Uzaklık ve enerjiye göre fiziksel gecikmeli 3D akustik gök gürültüsü (`SoundDirector`) ve telifsiz (CC BY) ambiyans müzik çalar (`BackgroundMusicPlayer`).
  6. **Üretim Kararlılığı:** 109/109 birim test yeşil, 0 TypeScript derleme hatası, Oracle VPS'te 7/24 kesintisiz çalışan arka plan havuzu.


