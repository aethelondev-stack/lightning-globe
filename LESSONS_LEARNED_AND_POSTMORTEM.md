# Aethelion — Real-Time Planetary Lightning Observatory
## Proje Post-Mortem, Yapılan Hatalar ve Çıkartılan Dersler Raporu (Lessons Learned)

> **Tarih:** 13 Eylül 2026  
> **Proje:** Aethelion - Earth Lightning Live (24/7 Planetary Real-Time Lightning Observatory)  
> **Yazarlar:** Antigravity AI & Lead Engineer  
> **Yayın Hedefi:** YouTube 24/7 Canlı Yayın (`@AethelionLive`) & Kick TV  
> **Dosya Konumu:** `LESSONS_LEARNED_AND_POSTMORTEM.md`

---

## 1. Yönetici Özeti (Executive Summary)

Aethelion projesi, Dünya üzerindeki tüm atmosferik elektriksel deşarjları (yıldırım ve şimşek olaylarını), yer tabanlı RF sensör ağları (Blitzortung, NEA, JMA, FMI) ve yerdurağan meteoroloji uyduları (NOAA GOES-16/18 GLM, EUMETSAT MTG-I1) aracılığıyla toplayıp 60 FPS sinematik 3D küre üzerinde 7/24 canlı yayınlayan bilimsel bir görselleştirme sistemidir.

Bu belge; projenin fikir aşamasından 7/24 YouTube canlı yayınına geçişine kadar karşılaşılan **kritik mimari tıkanıklıkları, yapılan teknik hataları, uygulanan cerrahi çözümleri ve gelecekteki gerçek zamanlı görselleştirme projeleri için çıkartılan kalıcı dersleri** kayıt altına almaktadır.

---

## 2. Karşılaşılan Temel Hatalar ve Uygulanan Çözümler

### 2.1. "Yıldırım Yağmuru" ve Kamera Savrulması Hatası
* **Hata Tanımı:** Projenin ilk aşamalarında, her yeni gelen şimşek olayında kameranın o noktaya odaklanmaya çalışmasıydı. Saniyede 15-40 şimşek düştüğünde kamera saniyede onlarca kez yön değiştiriyor, ekran kontrolsüz bir şekilde titriyor ve izleyicide mide bulantısına (motion sickness) yol açan bir görsel kaos oluşuyordu.
* **Kök Neden:** Kamera katmanının (`CameraDirector`), olay akışına (`Event Stream`) doğrudan bağlanmış olması ve aralarında bir "yönetmen" filtre katmanının bulunmaması.
* **Uygulanan Düzeltme:**
  * `EventDirector` katmanı inşa edildi.
  * Olaylar önce uzamsal ve zamansal kümelere (`StormCellBatcher`) ayrıldı.
  * Her fırtına hücresine bir aktivite ve büyüme skoru (`activityScore`) verildi.
  * Kameraya **7 ila 12 saniyelik odaklanma süresi (Cadence Dwell Timer)** getirildi. Bir fırtına hücresine odaklanıldığında o süre bitmeden veya olağanüstü ekstrem bir afet hücresi (Extreme Outbreak) patlak vermeden kamera savrulması kesin olarak yasaklandı.
* **Çıkartılan Ders:** Canlı veri görselleştirmede *her veriyi anında ekrana taşımak marifet değildir*. Olayları süzüp hikayeleştiren bir **Director (Yönetmen)** katmanı şarttır.

---

### 2.2. WebGL Heap Allocation ve Garbage Collection FPS Çöküşleri
* **Hata Tanımı:** Canlı yayının 2. veya 3. saatinde tarayıcı sekmesinin bellek kullanımının 1.5 GB'ın üzerine çıkması, saniyede bir gerçekleşen Garbage Collection (çöp toplama) duraklamaları ve FPS'in 60'tan 15-20'ye çakılması.
* **Kök Neden:** Her düşen şimşek için `new THREE.LineSegments()`, `new THREE.BufferGeometry()` veya yeni JavaScript nesneleri tahsis edilmesi (heap allocation). Animasyon döngüsü içinde nesne yaratılması V8 motorunu sürekli çöp toplamaya zorluyordu.
* **Uygulanan Düzeltme:**
  * **Sıfır Tahsisli Havuz (Zero-Allocation Object Pool):** `LightningBoltPool` sınıfı yazılarak 6-8 adet önceden bellekte ayrılmış sabit mesh oluşturuldu. Şimşekler bu havuza geri dönüştürülerek (recycle / LRU eviction) yeniden kullanıldı.
  * **GPU Memcpy Sınırlandırması:** 500.000 vuruşluk 24 saatlik iz tamponunda (`FulguriteTraceLayer`), her yeni vuruşta 2.8 MB'lık tüm dizi GPU'ya gönderilmek yerine `THREE.BufferAttribute.updateRange` kullanılarak **yalnızca 48 byte'lık** yeni vuruş parçası gönderildi.
  * **InstancedMesh Konsolidasyonu:** Radar hücreleri (petekler) ve şok dalgası halkaları tek bir çizim çağrısında (`Draw Call: 31`) birleştirildi.
* **Çıkartılan Ders:** 7/24 kesintisiz çalışan WebGL projelerinde `render loop` içinde tek bir `new` ifadesi dahi bulunamaz. Her veri yapısı dairesel tampon (ring buffer) ve TypedArray (`Float32Array`) olarak önceden ayrılmalıdır.

---

### 2.3. Boşluk Merkezi Hatası (The Dead-Zone Centroid Bug)
* **Hata Tanımı:** Fırtına kümeleme algoritması, iki yakın fırtına hattını birleştirdiğinde (örneğin Florida'nın batı kıyısı Tampa ile doğu kıyısı Daytona arasındaki yıldırımlar), hesaplanan ağırlıklı kütle merkezi (Center of Mass) şimşeklerin hiç olmadığı bomboş bir göle veya bataklığa radar peteği yerleştiriyordu.
* **Kök Neden:** Standart matematiksel ortalama (centroid), simetrik iki hat arasındaki boşluğu "merkez" zanneder.
* **Uygulanan Düzeltme:**
  * **Dead-Zone Guard & Medoid Algoritması:** Kümenin merkez noktası matematiksel ortalama yerine, küme içerisindeki diğer tüm vuruşlara en yakın olan *gerçek vuruş konumu (Medoid)* olarak kilitlendi.
  * Ayrı kıyı şeritlerindeki fırtınaların birbirine yapışmasını engelleyen mesafe tavanı (150 km) konuldu.
* **Çıkartılan Ders:** Meteorolojide matematiksel ortalama her zaman fiziksel gerçeği temsil etmez. Fiziksel yoğunluk çekirdeği (Density Medoid) her zaman aritmetik ortalamaya tercih edilmelidir.

---

### 2.4. Sub-Piksel Çizgi Genişliği ve Canlı Yayın Video Sıkıştırma Kaybı
* **Hata Tanımı:** 24 saatlik şimşek izleri yerel monitörde yakından bakıldığında harika görünürken, YouTube 1080p canlı yayınında izleyiciler "şimşek izleri yok gibi, ekranda bir şey görünmüyor" şikayetinde bulundu.
* **Kök Neden:** 
  * Dünya küresinin yarıçapı 100u, kameranın uzaktan orbital izleme mesafesi 320u idi.
  * `FulguriteTraceLayer` iz genişliği `0.08u - 0.18u` olarak ayarlanmıştı.
  * 1920x1080 ekranda bu izler **0.6 piksele** (sub-pixel) denk geliyordu.
  * YouTube'un ve OBS'in video kodlayıcısı (NVENC H.264 / 6000-9000 kbps), 1 pikselin altındaki bu mikro detayları "gürültü" sayarak sıkıştırma sırasında yok ediyordu (video compression artifact).
* **Uygulanan Düzeltme:**
  * İz yarıçapları akım şiddetine göre **`0.22u - 0.76u`** seviyesine (yaklaşık 3.5 kat daha dolgun) yükseltildi.
  * Şimşeğin düştüğü ilk andaki görsel patlama (`flashBoost`) süresi 0.9 saniyeden 1.2 saniyeye çıkarıldı ve baz parlaklık tablosu artırıldı.
* **Çıkartılan Ders:** Canlı yayın için grafik tasarlarken yerel ekran görüntüsü ölçüt olamaz. Video kodlayıcının (H.264/AV1) sıkıştırma algoritması ve bit-rate toleransı hesaba katılmalı; çizgiler ve ışımalar video sıkıştırmasını aşacak kalınlıkta tutulmalıdır.

---

### 2.5. Sahte/Simüle Veri Tehlikesi ve Bilimsel Dürüstlük Kuralı
* **Hata Tanımı:** Geliştirme aşamasında API kesildiğinde arayüzün boş kalmaması için arka planda sessizce sentetik/mock veri çalıştıran mekanizmalar kalmıştı. Bu durum gerçek bilimsel gözlem amacına gölge düşürüyordu.
* **Kök Neden:** Kullanıcıya her an hareketli bir ekran sunma güdüsü ile bilimsel dürüstlük ilkesi arasındaki çatışma.
* **Uygulanan Düzeltme:**
  * Proje anayasası (`AGENTS.md`) yazılarak en tepesine **"Gerçek veri yoksa LIVE yazma"** ve **"0% Tolerans ile sahte veriyi engelle"** kuralları kazındı.
  * `seed-`, `synth-`, `scenario-` ön ekli tüm veriler canlı filtrede engellendi.
  * Kesinti durumunda sistem sessizce simülasyona geçmek yerine ekrana `STALE / OFFLINE` uyarısı basacak şekilde yapılandırıldı.
* **Çıkartılan Ders:** Bir gözlem platformunun en büyük sermayesi izleyicinin güvenidir. Sahte veri sunmaktansa veri yokluğunu dürüstçe itiraf etmek her zaman daha değerlidir.

---

### 2.6. Canlı Chat Komutları, Unicode ve Türkçe Dotted 'İ' Edge-Case'i
* **Hata Tanımı:** Seyirciler YouTube chatinde `!turkey` yazdığında kameranın dönmemesi, `KİCK & YT` rozetinde Türkçe 'İ' harfinin yabancı izleyicilerde font bozulmasına yol açması.
* **Kök Neden:** 
  * JavaScript'te `'TURKEY'.toLowerCase()` fonksiyonu Türkçe işletim sistemi ortamında `türkey` veya noktasız `ı` gibi beklenmeyen karakter dönüşümleri yapabilir.
  * HTML rozetinde `KİCK` (U+0130) kullanılması.
* **Uygulanan Düzeltme:**
  * Bağımsız `YouTubeChatBridge.cjs` soket köprüsü kuruldu.
  * Ülke arama motoruna İngilizce ve Türkçe eş anlamlılar (alias) matrisi entegre edildi (`turkey`, `türkiye`, `tr`, `usa`, `abd` hepsi aynı ISO koduna bağlandı).
  * Tüm UI etiketleri uluslararası standart ASCII İngilizceye çevrildi.
* **Çıkartılan Ders:** Küresel canlı yayınlarda metin işleme daima dile özgü olmayan (locale-agnostic) UTF-8/ASCII kurallarıyla yapılmalı, girdi ayrıştırma katmanında katı regex yerine zengin eş anlamlılar tablosu kullanılmalıdır.

---

### 2.7. Canlı Yayını Bozmadan Sıcak Kod Güncellemesi (Hot Reload)
* **Hata Tanımı:** Canlı yayın sırasında bir hata düzeltilirken dev sunucusunu kapatmak, OBS'in yakaladığı `localhost:3005` ekranının donmasına, siyah ekrana düşmesine veya yayının kopmasına yol açıyordu.
* **Uygulanan Düzeltme:**
  * Vite'ın HMR (Hot Module Replacement) mimarisi korundu.
  * Kod değişiklikleri yalnızca modüler TypeScript dosyaları üzerinde yapıldı, dev sunucusu asla `kill` edilmedi.
  * OBS penceresi açıkken tarayıcı arkada sessizce kendini yeniledi ve yayın tek bir kare bile kaybetmeden devam etti.
* **Çıkartılan Ders:** 7/24 operasyonlarda "durdur-başlat" geliştirme refleksi terk edilmeli; her değişiklik sıcak takas (in-place hot patch) olarak tasarlanmalıdır.

---

## 3. Mimari Başarılar ve İnovasyonlar

| Bileşen | Başarılan İnovasyon | Sağladığı Avantaj |
| :--- | :--- | :--- |
| **Unified Lightning Hub** | GOES-16/18 uyduları, EUMETSAT MTG ve Blitzortung RF verisini 1200ms ve 18km eşiğinde birleştiren O(N) deduplication. | Mükerrer vuruşlar elendi, optik uydu enerjisi ile yer akımı tek olayda harmanlandı. |
| **Stochastic Presentation Queue** | Saniyede yüzlerce gelen uydu paketini 1.5 saniyelik Poisson dağılımıyla zamana yayan dairesel tampon. | Anlık veri patlamalarında (burst) ekran donması ve ani yığılmalar engellendi. |
| **Fulgurite Trace Buffer** | 500.000 vuruşluk 24 saatlik persistans, GLSL vertex shader horizon culling ve 48-step yarılanma matrisi. | 24 saatlik tüm küresel yıldırım geçmişi 60 FPS'te tek bir draw call ile çizildi. |
| **Meteorological Honeycomb Radar** | 512 hücrelik InstancedMesh, 7 meteorolojik şiddet sınıfı (Isolated -> Extreme Outbreak) ve medoid kilitli fırtına footprint'i. | Dünya üzerindeki fırtına hücreleri bilimsel hassasiyetle parıldayan neon peteklere dönüştü. |
| **Procedural 3D Audio Engine** | Web Audio API ile Brownian noise, ion plasma sizzle, resonant sub-bass ve Doppler etkili 3D uzamsal akustik. | Sıfır ses dosyası yükleme derdi olmadan, tamamen prosedürel ve akım şiddetine (kA) göre şekillenen gök gürültüsü üretildi. |

---

## 4. Gelecek Projeler İçin Altın Kurallar (Golden Rules)

1. **Ölçmeden Optimize Etme, Varsayma Empirik Kanıt Göster:**
   "Kod çalışıyor" demek ile "Canlı yayında GPU belleği stabil" demek aynı şey değildir. Bir özelliği tamamlamadan önce FPS, Draw Call, Heap Memory ve Network gecikmesi sayısal olarak doğrulanmalıdır.
2. **Kamera Otonomisi Bir Sanattır:**
   Kullanıcının veya izleyicinin ekranını kontrol eden bir kamera algoritması asla panik yapmamalıdır. Dwell süreleri, yumuşak SLERP dönüşleri ve geniş açıdan yakın plana geçiş kadansı bir sinema yönetmeni titizliğiyle ayarlanmalıdır.
3. **Piksel Ölçeğini Video Yayınına Göre Ayarla:**
   Monitörünüzdeki 4K çözünürlük izleyiciye ulaşana kadar sıkıştırma algoritmalarından geçer. Yayına giden sahnede çizgiler her zaman 1.5x - 2x daha kalın, kontrast ise %20 daha yüksek olmalıdır.
4. **Veri Hattı ile Çizim Döngüsünü Birbirine Kilitleme:**
   Ağdan veri 10 Hz'de gelebilir, SSE 1 saniye duraksayabilir; ancak WebGL çizim döngüsü her koşulda 60 FPS bağımsız dönmeye devam etmelidir.
5. **Kalıcı Hafızayı (Documentation) Güncel Tut:**
   `AGENTS.md`, sunucu IP'leri, SSH komutları ve mimari sınırlar her zaman güncel tutulmalıdır. Bu sayede oturumlar kapansa veya yeni bir ajan/mühendis dahil olsa bile sistem sıfır bilgi kaybıyla çalışmayı sürdürür.

---
*Bu rapor, Aethelion Lightning Globe projesinin gelecekteki bakım, sürüm güncellemeleri ve referans mimarisi için kalıcı bir kılavuzdur.*
