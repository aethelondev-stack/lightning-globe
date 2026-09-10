# ARCHITECTURE — Lightning Globe

## 1. Pipeline

Provider
  -> Transport
  -> Adapter
  -> Normalize
  -> Validate
  -> Deduplicate
  -> Event Store
  -> Spatial/Temporal Cluster Engine
  -> Activity Scorer
  -> Presentation Director
  -> Camera Director + Effect Director
  -> Globe/UI

## 2. Provider adapter

Her veri sağlayıcısı ayrı adapter olmalıdır.

Interface örneği:

LightningProvider:
- connect/fetch
- disconnect
- health
- capabilities

Adapter:
- parseRaw
- normalize
- validate

Renderer provider bilmemelidir.

## 3. Transport

Mümkünse:
- WebSocket,
- SSE,
- streaming feed

kullanılabilir.

Yoksa kontrollü polling.

Polling:
- configurable interval,
- request timeout,
- retry/backoff,
- last successful timestamp

tutmalıdır.

## 4. Domain event store

Store:
- recent events
- selected event
- active cluster
- last update
- data health

Event history bounded olmalıdır.

## 5. Clustering

İlk sürüm için zaman + coğrafi mesafe temelli basit algoritma yeterlidir.

Örnek yaklaşım:
1. son N dakikalık olayları al;
2. yakın olayları Haversine distance ile ilişkilendir;
3. zaman penceresi içinde bağlantıları oluştur;
4. connected components / DBSCAN benzeri clustering uygula;
5. centroid ve bounding radius hesapla.

Daha gelişmiş meteorolojik model ilk sürümde gerekli değildir.

## 6. Haversine

Mesafe hesaplamaları Dünya üzerinde düz Öklid koordinatıyla yapılmamalıdır.

Latitude/longitude -> spherical distance.

Dateline crossing ve kutuplara yakın noktaları test et.

## 7. Cluster centroid

Basit arithmetic mean longitude hatalı olabilir.

Dateline crossing için spherical/vector averaging tercih et.

## 8. Activity scoring

Scorer pure function olmalıdır.

Input:
- cluster
- current time
- configuration

Output:
- score
- presentationClass
- reasons

Reasons debug panelinde gösterilebilir.

## 9. Presentation Director

Sorumluluk:
- yeni cluster'ları değerlendirir;
- queue oluşturur;
- cooldown uygular;
- user override'ını gözetir;
- active presentation'ı yönetir.

Renderer'dan bağımsız olmalıdır.

## 10. Camera Director

Input:
CameraIntent:
- target lat/lon
- framing class
- duration
- easing
- hold
- return policy

Output:
renderer camera commands.

Camera Director doğrudan provider event bilmemelidir; domain intent tüketmelidir.

## 11. Effect Director

Effect:
- type
- position
- createdAt
- duration
- intensity
- metadata

Lifecycle:
spawn -> update -> expire -> dispose.

## 12. UI

UI state:
- live status
- selected event
- selected cluster
- controls

3D scene state ile ayrılmalıdır.

## 13. Suggested project structure

src/
  app/
  config/
  domain/
    lightning/
    clustering/
    presentation/
    camera/
  data/
    providers/
    adapters/
    transport/
  rendering/
    globe/
    lightning/
    effects/
    camera/
  state/
  ui/
  utils/
  tests/

Mevcut proje farklıysa körlemesine yeniden düzenleme yapma.

## 14. Dependency policy

Three.js veya mevcut 3D engine varsa kullan.

Yeni:
- state manager,
- animation library,
- clustering library,
- map library

eklemeden önce gerçekten gerekli olup olmadığını değerlendir.

## 15. Data flow invariant

Aynı LightningEvent nesnesi:
provider raw -> normalized domain -> renderer

şeklinde doğrudan taşınmamalıdır.

Her boundary'de açık contract bulunmalıdır.
